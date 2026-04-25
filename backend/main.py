from fastapi import FastAPI, Request
from openai import OpenAI
from datetime import datetime
from contextvars import ContextVar
import io
import re
import os
import time
import asyncio
import base64
import difflib


from litellm import completion
from dotenv import load_dotenv

load_dotenv()
client = OpenAI()

# ---------------- CONFIG ----------------
LLM_MODE = os.getenv("LLM_MODE", "openai")
USE_LLM = os.getenv("USE_LLM", "true").lower() == "true"
USE_MOCK = os.getenv("USE_MOCK", "false").lower() == "true"
SCROLL_TEST = os.getenv("SCROLL", "false").lower() == "true"

MODEL_OPENAI = os.getenv("MODEL_OPENAI", "gpt-4o-mini")
MODEL_CLAUDE = os.getenv("MODEL_CLAUDE", MODEL_OPENAI)

TRACE_LEVEL = int(os.getenv("TRACE_LEVEL", "1"))
TRACE_TARGETS = os.getenv("TRACE_TARGETS", "").split(",")
print("TRACE_LEVEL:", TRACE_LEVEL)
print("TRACE_TARGETS:", TRACE_TARGETS)


def now_iso():
    return datetime.utcnow().isoformat() + "Z"


trace_id_var: ContextVar[str] = ContextVar("trace_id", default="unknown")


def trace_start(func_name: str):
    if TRACE_LEVEL < 4:
        return None
    trace_id = trace_id_var.get()
    if "*" in TRACE_TARGETS or func_name in TRACE_TARGETS:
        print(f"[{now_iso()}][BE][FUNC][{trace_id}] → {func_name}")
    return time.time()


def trace_end(func_name: str, start):
    if TRACE_LEVEL < 4 or start is None:
        return
    trace_id = trace_id_var.get()
    if "*" in TRACE_TARGETS or func_name in TRACE_TARGETS:
        duration = (time.time() - start) * 1000
        print(f"[{now_iso()}][BE][FUNC][{trace_id}] ← {func_name} {duration:.0f}ms")


if TRACE_LEVEL >= 1:
    print(f"[{now_iso()}][{trace_id_var.get()}] LLM_MODE:", LLM_MODE)
if TRACE_LEVEL >= 1:
    print(f"[{now_iso()}][{trace_id_var.get()}] USE_LLM:", USE_LLM)
if TRACE_LEVEL >= 1:
    print(f"[{now_iso()}][{trace_id_var.get()}] USE_MOCK:", USE_MOCK)
if TRACE_LEVEL >= 1:
    print(f"[{now_iso()}][{trace_id_var.get()}] SCROLL_TEST:", SCROLL_TEST)

app = FastAPI()

if TRACE_LEVEL >= 1:
    print(f"[{now_iso()}][{trace_id_var.get()}] 🚨 LLM BACKEND RUNNING")


# ---------------- USER PROFILE ----------------
USER_PROFILE = {
    "name": "Deepak",
    "age": 63,
    "condition": "prediabetic",
    "a1c": 6.0,
    "ldl": 100,
    "goal": "reduce glucose spikes",
    "diet": "vegetarian",
    "phenotype": "post-meal spiker",
}

COMMON_CORRECTIONS = {
    "excercise": "exercise",
    "excersise": "exercise",
    "glocose": "glucose",
    "suger": "sugar",
    "colestrol": "cholesterol",
    "bp": "blood pressure",  # you already handle this, but safe
}

QUESTION_STARTS = ("what", "how", "which", "best")


# ---------------- SCROLL TEST ----------------
def long_block(title: str) -> str:
    return "\n".join(
        [
            f"{i+1}. {title} detail explaining behavior, impact, and optimization pattern."
            for i in range(40)
        ]
    )


def scroll_test_response() -> str:
    return f"""## Likely Cause
{long_block("Likely Cause")}

## What To Do
{long_block("What To Do")}

## Next Step
{long_block("Next Step")}
"""


# ---------------- WHISPER HALLUCINATION LIST ----------------
# Maintainable — add entries as observed in production
WHISPER_HALLUCINATIONS = {
    "",
    "thank you.",
    "thank you",
    "thanks for watching.",
    "thanks for watching",
    "you",
    "you.",
    ".",
    "...",
    "bye.",
    "bye",
    "goodbye.",
    "goodbye",
}


def is_hallucination(text: str) -> bool:
    return text.strip().lower() in WHISPER_HALLUCINATIONS


# ---------------- TRIGGER REMOVAL ----------------
# Matches "go improveme" or "go improve me" at the END of the transcript only.
# Case-insensitive. Allows optional trailing punctuation. One pass only.
TRIGGER_PATTERN = re.compile(
    r"\s*(go\s+improve\s*me|इम्प्रूव\s*मी)\s*[.!?]?\s*$", re.IGNORECASE
)


def has_trigger(text: str) -> bool:
    return bool(TRIGGER_PATTERN.search(text))


def remove_trigger(text: str) -> str:
    return TRIGGER_PATTERN.sub("", text).strip()


# ---------------- VALIDATION ----------------
def validate_voice_query(raw_transcript: str) -> tuple:
    """
    Validates Whisper transcript. Returns (error_msg | None, cleaned_query).
    Order: A → B → C → D exactly per spec.
    """
    t0 = trace_start("validate_voice_query")
    try:
        raw = (raw_transcript or "").strip()

        # Case A: null, empty, or Whisper hallucination
        if not raw or is_hallucination(raw):
            return "Could not understand. Please try again.", ""

        # Trigger removal (before B/C/D checks)
        trigger_found = has_trigger(raw)
        cleaned = remove_trigger(raw)

        # Case B: transcript contained only the trigger phrase
        if trigger_found and not cleaned:
            return "Please say your question or meal before Go ImproveMe.", ""

        # Case C: no word with 3 or more characters
        words = re.findall(r"\w+", cleaned)
        if len(cleaned.strip()) < 3:
            return "Please say a complete question or meal.", cleaned

        # Case D: only whitespace or punctuation
        if not re.sub(r"[^\w]", "", cleaned).strip():
            return "Could not understand. Please try again.", cleaned

        return None, cleaned
    finally:
        trace_end("validate_voice_query", t0)


# ---------------- KEYWORD MAP ----------------
KEYWORD_MAP = {
    "glucose": {
        "primary": [
            "glucose",
            "blood glucose",
            "sugar",
            "blood sugar",
            "bg",
            "diabetes",
        ],
        "medical": [
            "a1c",
            "hba1c",
            "insulin",
            "glycemic",
            "hypoglycemia",
            "hyperglycemia",
        ],
        "food": ["carb", "carbs", "dessert", "sweet", "juice", "soda"],
        "context": ["fasting", "postprandial", "after meal", "post meal"],
    },
    "bp": {
        "primary": ["blood pressure", "bp", "pressure", "hypertension", "hypotension"],
        "medical": ["systolic", "diastolic"],
        "lifestyle": ["salt", "sodium"],
        "symptoms": ["dizziness", "headache"],
    },
    "cholesterol": {
        "primary": ["cholesterol", "chol", "ldl", "hdl", "lipid", "triglyceride", "tg"],
        "medical": ["statin", "plaque"],
        "food": ["fat", "saturated", "trans fat"],
    },
    "lifestyle": {
        "diet": ["diet", "food", "meal", "eat", "nutrition"],
        "activity": ["exercise", "workout", "walk", "steps"],
        "recovery": ["sleep", "stress", "meditation"],
        "body": ["weight", "fitness"],
        "habits": ["lifestyle", "habit", "routine"],
    },
}


# ---------------- NORMALIZE ----------------
def normalize(q: str) -> str:
    t0 = trace_start("normalize")
    try:
        q = q.lower().strip()
        q = q.replace("-", " ")
        q = re.sub(r"\bbp\b", "blood pressure", q)
        q = re.sub(r"\bbg\b", "blood glucose", q)
        q = re.sub(r"\bblood sugar\b", "glucose", q)
        return q
    finally:
        trace_end("normalize", t0)


# ---------------- MEAL TEXT CLEANING ----------------
_MEAL_TRIGGER = re.compile(
    r"\b(i\s+(just\s+)?(ate|had|eaten|consumed)|my meal was"
    r"|for\s+(breakfast|lunch|dinner)|today|this morning|just now)\b",
    re.IGNORECASE,
)

_MEAL_FILLERS = [
    r"\bi just had\b",
    r"\bi just ate\b",
    r"\bi had\b",
    r"\bi ate\b",
    r"\bi consumed\b",
    r"\bmy meal was\b",
    r"\bfor breakfast\b",
    r"\bfor lunch\b",
    r"\bfor dinner\b",
    r"\btoday\b",
    r"\bthis morning\b",
    r"\bjust now\b",
]


def is_meal_sentence(q: str) -> bool:
    return bool(_MEAL_TRIGGER.search(q))


def clean_meal_text(q: str) -> str:
    t0 = trace_start("clean_meal_text")
    try:
        result = q.lower()
        for phrase in _MEAL_FILLERS:
            result = re.sub(phrase, "", result, flags=re.IGNORECASE)
        result = re.sub(r"\band\b", ",", result)
        result = re.sub(r",\s*,", ",", result)
        result = re.sub(r"\s+", " ", result).strip(" ,")
        return result
    finally:
        trace_end("clean_meal_text", t0)


# ---------------- CONTEXT ----------------
def detect_context(q: str) -> dict:
    t0 = trace_start("detect_context")
    try:
        return {
            "after_meal": any(x in q for x in ["after meal", "post meal"]),
            "high": any(x in q for x in ["high", "spike", "elevated"]),
            "low": any(x in q for x in ["low", "drop"]),
        }
    finally:
        trace_end("detect_context", t0)


# ---------------- INTENT ----------------

VALID_INTENTS = {"lifestyle", "glucose", "cholesterol", "blood_pressure", "unknown"}

model_name = MODEL_OPENAI if LLM_MODE == "openai" else MODEL_CLAUDE


def classify_intent_llm(query: str) -> str:
    t0 = trace_start("classify_intent_llm")
    try:
        prompt = f"""Classify the user query into ONE of these intents:
- lifestyle
- glucose
- cholesterol
- blood_pressure
- unknown

If the query is unclear, meaningless, or unrelated to health, return "unknown".

Return ONLY the intent. No explanation.

Query: "{query}"
"""
        try:
            response = completion(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=5,
            )
            return response["choices"][0]["message"]["content"].strip().lower()
        except Exception as e:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] LLM intent error:", e)
            return "unknown"
    finally:
        trace_end("classify_intent_llm", t0)


def is_food_list(q: str) -> bool:
    parts = [p.strip() for p in q.split(",") if p.strip()]
    return len(parts) >= 2 and all(len(p) > 1 for p in parts)


FOOD_WORDS = {
    "rice",
    "dal",
    "roti",
    "bread",
    "egg",
    "eggs",
    "chicken",
    "fish",
    "paneer",
    "tofu",
    "beans",
    "lentils",
    "salad",
    "coffee",
    "tea",
    "oats",
    "banana",
    "apple",
    "coke",
    "pizza",
    "milk",
    "yogurt",
}


def is_single_food_phrase(q: str) -> bool:
    words = q.lower().split()
    if not (1 <= len(words) <= 3):
        return False
    food_hits = sum(1 for w in words if w in FOOD_WORDS)
    return food_hits >= 1 and food_hits >= len(words) / 2


def is_question(q: str) -> bool:
    return any(w in q.lower().split() for w in ["what", "why", "how", "when", "where"])


def is_pairing_query(q: str) -> bool:
    t0 = trace_start("is_pairing_query")
    try:
        s = q.lower().strip()

        # 1) must be a question-like query
        is_question = "?" in s or any(s.startswith(w) for w in QUESTION_STARTS)

        # 2) must contain "with <something>"
        m = re.search(r"\bwith\s+([a-z][a-z\s\-]+)\b", s)
        if not m:
            return False

        target = m.group(1).strip()

        # 3) simple guards (avoid non-food contexts)
        if any(x in s for x in ["with friends", "with family"]):
            return False

        if any(x in s for x in ["with life", "with stress", "with time"]):
            return False

        # 4) lightweight length guard (avoid long abstract questions)
        if len(s.split()) > 8:
            return False

        return is_question and bool(target)
    finally:
        trace_end("is_pairing_query", t0)


def detect_intent(q: str) -> str:
    t0 = trace_start("detect_intent")
    try:
        s = q.lower()

        # 🔥 DOMAIN INTENTS FIRST
        if any(
            x in s for x in ["statin", "metformin", "medicine", "medication", "drug"]
        ):
            return "medication"

        if "bp" in s or "blood pressure" in s:
            return "bp"

        if "sugar" in s or "glucose" in s:
            return "glucose"

        if any(x in s for x in ["cholesterol", "hdl", "ldl"]):
            return "cholesterol"

        if is_food_list(q) or is_single_food_phrase(q):
            return "lifestyle"

        text = q.lower()
        scores = {}

        for category, groups in KEYWORD_MAP.items():
            score = 0
            for group_name, keywords in groups.items():
                for kw in keywords:
                    if re.search(rf"\b{re.escape(kw)}\b", text):
                        if group_name == "primary":
                            score += 3
                        elif group_name == "medical":
                            score += 2
                        else:
                            score += 1
            if score > 0:
                scores[category] = score

        if scores:
            return max(scores, key=scores.get)

        q = text.lower().strip()

        if any(
            w in q
            for w in [
                # General lifestyle / food
                "healthy",
                "breakfast",
                "lunch",
                "dinner",
                "food",
                "diet",
                "eat",
                "ideas",
                # Definition / education
                "what is",
                "define",
                "meaning",
                "explain",
                # Metabolic health
                "blood sugar",
                "a1c",
                # Insulin
                "insulin",
                "insulin resistance",
                "insulin sensitivity",
                # Glucose behavior
                "spike",
                "spikes",
                "crash",
                "response",
                "responder",
                # Glucotype
                "glucotype",
                "glucose type",
                "type of glucose",
            ]
        ):
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] KEYWORD_MATCH:", q)
            return "lifestyle"

        if is_question(q):
            return "unknown"

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] FALLING_TO_LLM:", q)
        if USE_LLM:
            intent = classify_intent_llm(q)
            if intent not in VALID_INTENTS:
                return "unknown"
            if TRACE_LEVEL >= 1:
                print(
                    f"[{now_iso()}][{trace_id_var.get()}] LLM_INTENT_USED:",
                    q,
                    "→",
                    intent,
                )
            return intent

        return "lifestyle"
    finally:
        trace_end("detect_intent", t0)


# ---------------- SCORE ----------------
def compute_score(intent: str, q: str) -> int:
    t0 = trace_start("compute_score")
    try:
        score = 50

        if intent == "unknown":
            return 40

        if intent == "glucose":
            if any(x in q for x in ["fiber", "vegetable"]):
                score += 20
            if any(x in q for x in ["sugar", "dessert"]):
                score -= 20

        elif intent == "bp":
            if "salt" in q:
                score -= 15
            if any(x in q for x in ["walk", "exercise"]):
                score += 15

        elif intent == "cholesterol":
            if any(x in q for x in ["fiber", "oats"]):
                score += 20
            if "fat" in q:
                score -= 10

        elif intent == "lifestyle":
            if any(x in q for x in ["exercise", "walk"]):
                score += 10
            if any(x in q for x in ["junk", "fried"]):
                score -= 10

        return max(0, min(score, 100))
    finally:
        trace_end("compute_score", t0)


# ---------------- MOCK ----------------
def mock_response(intent: str) -> str:
    if intent == "glucose":
        return """## Likely Cause
Glucose spike likely due to high carbs without fiber.

## What To Do
Walk for 10–15 minutes and hydrate.

## Next Step
Lead meals with fiber, then protein, then carbs."""

    if intent == "bp":
        return """## Likely Cause
Elevated blood pressure may be driven by sodium or low activity.

## What To Do
Take a short walk and reduce salt intake.

## Next Step
Increase potassium-rich foods and hydration."""

    if intent == "cholesterol":
        return """## Likely Cause
Cholesterol imbalance may be linked to low soluble fiber.

## What To Do
Add oats, vegetables, and healthy fats.

## Next Step
Maintain consistent fiber intake daily."""

    if intent == "lifestyle":
        return """## Likely Cause
Lifestyle habits may not be aligned with optimal health.

## What To Do
Focus on balanced meals, movement, and recovery.

## Next Step
Improve one habit today: meal, walk, or sleep."""

    return """## Insight
I can help with lifestyle, glucose, BP, and cholesterol.

## Next Step
Try asking about food, exercise, or health markers."""


# ---------------- PROMPT ----------------
def build_prompt(q: str, ctx: dict) -> str:
    t0 = trace_start("build_prompt")
    try:
        result = f"""
You are a lifestyle health assistant.

User Profile:
- Age: {USER_PROFILE['age']}
- Condition: {USER_PROFILE['condition']} (A1C {USER_PROFILE['a1c']})
- LDL: {USER_PROFILE['ldl']}
- Goal: {USER_PROFILE['goal']}
- Diet: {USER_PROFILE['diet']}
- Phenotype: {USER_PROFILE['phenotype']}

User query: "{q}"

Context:
- After meal: {ctx["after_meal"]}
- High: {ctx["high"]}
- Low: {ctx["low"]}

Instructions:
- Be practical and easy to follow
- Use simple everyday language
- Do NOT assume user condition unless explicitly stated in the query
- Avoid clinical numbers (no grams, mg, frequencies)
- Keep response readable in under 5 seconds
- Max 3 bullets in What To Do
- No numbered lists (use • only)
- No long explanations
- No Meal Score section
- No Try This Week section
- Use short directive phrases (not full sentences)
- Avoid filler words (consider, try to, aim to)
- Avoid repeating ideas across sections
- Start Insight with direct cause (no explanation)
- Do NOT use words like: important, helpful, beneficial
- Do NOT mention conditions unless user explicitly states them
- Keep Insight under 10 words if possible

Respond ONLY in this exact format:

## Insight
1–2 short lines summarizing the key issue or context.

## What To Do
• First action (specific, short)
• Second action (specific, short)
• Third action (specific, short, optional)

## Expected Outcome
One short line on what improves.

Rules:
- No Meal Score section
- No Try This Week section
- No numbered bullets (use • only)
- Max 3 bullets in What To Do
- No long paragraphs
"""
        return result
    finally:
        trace_end("build_prompt", t0)


# ---------------- LITE PROMPT ----------------
def build_lite_prompt(q: str) -> str:
    t0 = trace_start("build_lite_prompt")
    try:
        result = f"""
You are a calm, practical health coach.

User asked:
"{q}"

Respond in EXACTLY 3 short sentences.

Rules:
- No headings
- No markdown
- No bullet points
- No jargon
- Keep it simple and natural
- Sound like a real person guiding someone in daily life
- Do not sound textbook or clinical
- Keep each sentence short and clear
- Prefer one clear action over multiple options
- Avoid generic advice like "stay healthy" or "regular checkups"
- Be specific and confident in what to do
- Do not list multiple unrelated suggestions
- Avoid soft language like "try", "consider", "you can also"
- When suggesting an action, include a simple reason why it works in one short clause
- Avoid repeating the same reassurance phrase; vary wording or omit reassurance if not needed
- Prefer concrete, simple mechanisms over generic benefits (e.g., fluid release, slower absorption, using up sugar)

Structure guidance:

- If the user is asking what to do → start directly with the action
- If the user is asking what something is → start with a simple explanation
- If the user is worried or made a mistake → start with reassurance

Then:
- Include a simple next step if helpful
- End with calm forward guidance

Tone:
- Calm
- Supportive
- Practical
- Human

Examples:

User: What can I do quickly to reduce blood pressure?
Answer: Take a few slow deep breaths and go for a short walk to bring it down. Blood pressure rises with stress and activity. It usually settles once your body relaxes.

User: What is blood pressure?
Answer: Blood pressure is how hard your blood pushes as it moves through your body. You can check it to see if it's in a healthy range. Keeping it steady helps protect your heart.

User: I ate too many carbs, what should I do?
Answer: Don't worry, this happens and your body can handle it. Drink some water and take a short walk to steady things. Just get back to balanced meals next time.

Now answer the user's question in that style.
"""
        return result
    finally:
        trace_end("build_lite_prompt", t0)


# ---------------- EXTRACT ----------------
def extract_text(res):
    try:
        if isinstance(res, dict):
            return res["choices"][0]["message"]["content"]
        return res.choices[0].message.content
    except Exception as e:
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] EXTRACT ERROR:", e)
        return str(res)


# ---------------- CALL LLM ----------------
def call_llm(prompt: str) -> str:
    model = MODEL_OPENAI if LLM_MODE == "openai" else MODEL_CLAUDE
    res = completion(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return extract_text(res)


# ---------------- LITE VALIDATOR ----------------
def validate_lite_response(text: str) -> tuple:
    t0 = trace_start("validate_lite_response")
    try:
        if not text:
            return False, "empty"

        # Rule 1: Sentence count
        sentences = [s.strip() for s in text.split(".") if s.strip()]
        if len(sentences) < 1 or len(sentences) > 4:
            return False, "sentence_count"

        # Rule 2: No structured formatting
        forbidden = ["##", "* ", "\n- ", "\n1)", "\n2)", "\n3)"]
        if any(f in text for f in forbidden):
            return False, "format"

        # Rule 3: Concise length
        if len(text.strip()) > 350:
            return False, "too_long"

        # Rule 4: Basic jargon filter
        jargon_words = ["mmhg", "glycemic"]
        if any(j in text.lower() for j in jargon_words):
            return False, "jargon"

        return True, "ok"
    finally:
        trace_end("validate_lite_response", t0)


# ---------------- LLM ----------------
def llm_response(q: str, ctx: dict, lite: bool) -> str:
    t0_func = trace_start("llm_response")
    try:
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] RAW QUERY:", q)
        if is_meal_sentence(q):
            q = clean_meal_text(q)
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] CLEANED QUERY:", q)

        if lite:
            prompt = build_lite_prompt(q)

            if TRACE_LEVEL >= 2:
                print(f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] → call_llm")
            t0 = time.time()
            text = call_llm(prompt)
            if TRACE_LEVEL >= 2:
                print(
                    f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] ← call_llm {(time.time()-t0)*1000:.0f}ms"
                )

            is_valid, reason = validate_lite_response(text)

            if is_valid:
                return text

            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] VALIDATION FAILED:", reason)

            retry_prompt = (
                prompt
                + "\n\nRewrite the answer simpler, shorter, and more conversational."
            )
            if TRACE_LEVEL >= 2:
                print(f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] → call_llm retry")
            t0 = time.time()
            text_retry = call_llm(retry_prompt)
            if TRACE_LEVEL >= 2:
                print(
                    f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] ← call_llm retry {(time.time()-t0)*1000:.0f}ms"
                )

            is_valid_retry, _ = validate_lite_response(text_retry)

            if is_valid_retry:
                return text_retry

            return text

        else:
            prompt = build_prompt(q, ctx)
            if TRACE_LEVEL >= 2:
                print(f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] → call_llm")
            t0 = time.time()
            result = call_llm(prompt)
            if TRACE_LEVEL >= 2:
                print(
                    f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] ← call_llm {(time.time()-t0)*1000:.0f}ms"
                )
            return result
    finally:
        trace_end("llm_response", t0_func)


# ---------------- FORMAT ----------------
def enforce_format(text: str) -> str:
    t0 = trace_start("enforce_format")
    try:
        if all(
            x in text for x in ["## Insight", "## What To Do", "## Expected Outcome"]
        ):
            return text

        return f"""## Insight
{text}

## What To Do
• Ask your question more clearly
• Include food, symptom, or goal

## Expected Outcome
More accurate and useful guidance
"""
    finally:
        trace_end("enforce_format", t0)


# ---------------- TTS ----------------
def generate_tts(text: str):
    t0 = trace_start("generate_tts")
    try:
        try:
            speech = client.audio.speech.create(
                model="gpt-4o-mini-tts", voice="alloy", input=text
            )
            audio_bytes = speech.read()
            return base64.b64encode(audio_bytes).decode("utf-8")
        except Exception as e:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] TTS ERROR:", e)
            return None
    finally:
        trace_end("generate_tts", t0)


# ---------------- LITE FALLBACK ----------------
def lite_fallback_response() -> dict:
    return {
        "text": """I didn't fully understand that.

Try something like:
• How to control sugar spikes?
• What should I eat with ice cream?
• Best post meal walk timing
""",
        "score": 0,
        "intent": "unknown",
    }


def medication_response() -> dict:
    return {
        "text": """## Insight
Medication is used when lifestyle alone is not enough.

## What To Do
• Improve food quality and meal timing
• Stay active daily
• Track key health numbers

## Expected Outcome
Better control and reduced need for medication over time""",
        "intent": "medication",
        "score": 50,
    }


# ---------------- BUILD RESPONSE ----------------
async def build_response(query: str, lite: bool):
    t0_func = trace_start("build_response")
    try:
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] LITE MODE:", lite)

        if not query:
            return {"text": "Empty query", "score": 0}

        # ✅ normalize FIRST
        q = correct_spelling(query)
        q = normalize(q)

        # ✅ pairing override
        if is_pairing_query(q):
            return {**build_pairing_response(q), "score": 50, "intent": "lifestyle"}

        ctx = detect_context(q)
        intent = detect_intent(q)

        score = compute_score(intent, q)
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] SCORE:", score)

        if intent == "unknown":
            q = correct_with_llm(q)
            intent = detect_intent(q)

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] --- REQUEST ---")
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] QUERY:", q)
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] INTENT:", intent)

        # ✅ medication shortcut
        if intent == "medication":
            return medication_response()

        # ✅ fallback (safe now)
        if intent in ("unknown", "general"):
            if lite:
                return lite_fallback_response()
            return {
                "text": """## Insight
I can help with:
- meals
- glucose
- blood pressure
- cholesterol

## Try This
Say something like:
- "rice dal paneer"
- "my sugar is high after meal"
- "how to reduce BP"
""",
                "score": 0,
            }

        if SCROLL_TEST:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] 🔥 SCROLL TEST MODE")
            return {"text": scroll_test_response(), "score": score, "intent": intent}

        if USE_MOCK:
            return {"text": mock_response(intent), "score": score, "intent": intent}

        if USE_LLM:
            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(llm_response, q, ctx, lite), timeout=15
                )
                return {
                    "text": result if lite else enforce_format(result),
                    "score": score,
                    "intent": intent,
                }

            except asyncio.TimeoutError:
                if TRACE_LEVEL >= 1:
                    print(f"[{now_iso()}][{trace_id_var.get()}] LLM TIMEOUT")
                return {
                    "text": "LLM timed out. Try again.",
                    "score": score,
                    "intent": intent,
                }

            except Exception as e:
                if TRACE_LEVEL >= 1:
                    print(f"[{now_iso()}][{trace_id_var.get()}] LLM ERROR:", e)
                return {
                    "text": mock_response(intent),
                    "score": score,
                    "intent": intent,
                    "error": str(e),
                }

        return {
            "text": """## Insight
Fallback response active.

## Next Step
Try asking about lifestyle, BP, glucose, or cholesterol.""",
            "score": score,
            "intent": intent,
        }
    finally:
        trace_end("build_response", t0_func)


def correct_spelling(text: str) -> str:
    t0 = trace_start("correct_spelling")
    try:
        words = text.split()
        corrected = []

        for w in words:
            lw = w.lower()

            # direct correction
            if lw in COMMON_CORRECTIONS:
                corrected.append(COMMON_CORRECTIONS[lw])
                continue

            # fuzzy match (optional but useful)
            match = difflib.get_close_matches(
                lw, COMMON_CORRECTIONS.keys(), n=1, cutoff=0.85
            )
            if match:
                corrected.append(COMMON_CORRECTIONS[match[0]])
            else:
                corrected.append(w)

        return " ".join(corrected)
    finally:
        trace_end("correct_spelling", t0)


def correct_with_llm(text: str) -> str:
    t0 = trace_start("correct_with_llm")
    try:
        try:
            res = completion(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "Correct spelling only. Do not change meaning. Return only corrected sentence.",
                    },
                    {"role": "user", "content": text},
                ],
            )
            return extract_text(res).strip()
        except:
            return text
    finally:
        trace_end("correct_with_llm", t0)


def extract_target_food(q: str) -> str:
    q = q.lower()
    match = re.search(r"(?:with|for)\s+(.+)", q)
    if not match:
        return ""
    return match.group(1).replace("?", "").strip()


def build_pairing_response(q: str) -> dict:
    t0 = trace_start("build_pairing_response")
    try:
        food = extract_target_food(q)

        if not food:
            return lite_fallback_response()

        return {
            "text": get_pairing_advice(food),
            "intent": "lifestyle",
            "score": 0,
        }
    finally:
        trace_end("build_pairing_response", t0)


def get_pairing_advice(food: str) -> str:
    food = food.lower()

    if "turmeric" in food:
        return """Turmeric works best with black pepper.

Combine with:
• Black pepper (improves absorption)
• Healthy fat (milk, ghee)
• Warm liquids (tea)

This improves effectiveness."""

    if "fries" in food:
        return """Fries are high in refined carbs.

Add:
• Protein (chicken, paneer)
• Fiber (salad, vegetables)
• Optional: vinegar or lemon

This helps reduce glucose spikes."""

    if "ice cream" in food:
        return """Ice cream is high in sugar.

Add:
• Nuts or yogurt (fat/protein)
• Fruit or chia (fiber)
• A short walk after eating

This helps stabilize glucose."""

    return f"""For {food}:

Add protein and fiber to balance it.
A short walk after eating also helps."""


# ---------------- NORMALIZE ENDPOINT ----------------
from pydantic import BaseModel
from typing import List


class NormalizeRequest(BaseModel):
    items: List[str]


@app.post("/normalize")
async def normalize_food_items(req: NormalizeRequest):
    """
    Normalize food item names: fix spelling, standardize names.
    Quantities and units are preserved. Items are not split or merged.
    Falls back to original items on any failure.
    """
    t0_func = trace_start("normalize_food_items")
    try:
        original = req.items
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] NORMALIZE RAW:", original)

        if not original:
            return {"items": original}

        prompt = "\n".join(
            [
                "Normalize the following food items:",
                "- Fix spelling mistakes",
                '- Standardize names (e.g. "chxicken" → "chicken")',
                "- DO NOT change quantities or units",
                "- DO NOT split or merge items",
                "Return ONLY a JSON array of corrected items.",
                "",
                f"Input: {original}",
                "Output:",
            ]
        )

        try:
            res = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: completion(
                        model=MODEL_OPENAI,
                        messages=[{"role": "user", "content": prompt}],
                        temperature=0,
                        max_tokens=256,
                    )
                ),
                timeout=10,
            )
            text = extract_text(res).strip()

            match = re.search(r"\[[\s\S]*\]", text)
            if not match:
                raise ValueError("No JSON array in response")

            parsed = __import__("json").loads(match.group(0))

            if not isinstance(parsed, list):
                raise ValueError("Response is not a list")

            if len(parsed) != len(original):
                raise ValueError(
                    f"Length mismatch: got {len(parsed)}, expected {len(original)}"
                )

            result = [str(item) for item in parsed]
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] NORMALIZE OUTPUT:", result)
            return {"items": result}

        except Exception as e:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] NORMALIZE ERROR:", e)
            return {"items": original}
    finally:
        trace_end("normalize_food_items", t0_func)


# ---------------- QUERY ENDPOINT (voice + keyboard) ----------------
@app.post("/query")
async def handle_query(request: Request):
    """
    Single endpoint for both voice and keyboard input.

    Voice path:   multipart/form-data with audio_file field
                  Runs Whisper → validate (A→B→C→D) → LLM → TTS → returns audio

    Keyboard path: application/json with {query, voice: false}
                   Runs LLM only → audio is always null
    """

    start = time.time()
    trace_id = request.headers.get("x-trace-id", "unknown")
    trace_id_var.set(trace_id)
    content_type = request.headers.get("content-type", "")

    if TRACE_LEVEL >= 2:
        print(f"[{now_iso()}][BE][API][{trace_id}] → /query")

    # ── VOICE PATH ──────────────────────────────────────────────────────────
    if "multipart/form-data" in content_type:
        form = await request.form()
        lite = form.get("lite") == "true"
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] VOICE LITE:", lite)
        audio_file = form.get("audio_file")

        if audio_file is None:
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        audio_bytes = await audio_file.read()
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] --- VOICE REQUEST ---")
        if TRACE_LEVEL >= 1:
            print(
                f"[{now_iso()}][{trace_id_var.get()}] File: {audio_file.filename}, Size: {len(audio_bytes)} bytes"
            )

        if len(audio_bytes) == 0:
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if len(audio_bytes) > 25 * 1024 * 1024:
            return {
                "status": "error",
                "message": "Audio file too large.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        # Whisper transcription
        audio_io = io.BytesIO(audio_bytes)
        filename = (audio_file.filename or "").lower()
        ext = filename.split(".")[-1] if "." in filename else "m4a"
        audio_io.name = audio_file.filename or f"audio.{ext}"

        try:
            transcript_obj = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: client.audio.transcriptions.create(
                        model="gpt-4o-mini-transcribe", file=audio_io
                    )
                ),
                timeout=10,
            )
            raw_transcript = (transcript_obj.text or "").strip()
        except asyncio.TimeoutError:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] WHISPER TIMEOUT")
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] WHISPER RAW:", raw_transcript)

        error_msg, cleaned_query = validate_voice_query(raw_transcript)

        if error_msg:
            if TRACE_LEVEL >= 1:
                print(
                    f"[{now_iso()}][{trace_id_var.get()}] VALIDATION FAILED:", error_msg
                )
            return {
                "status": "error",
                "message": error_msg,
                "cleaned_query": cleaned_query,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] CLEANED QUERY:", cleaned_query)

        result = await build_response(cleaned_query, lite)
        text = result.get("text", "")
        if not text:
            text = "Something went wrong. Please try again."
        score = result.get("score", 0)

        # Backend selects TTS text — frontend never trims or selects
        tts_text = text
        try:
            audio = await asyncio.wait_for(
                asyncio.to_thread(generate_tts, tts_text), timeout=15
            )
        except asyncio.TimeoutError:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] TTS TIMEOUT")
            audio = None

        duration_ms = (time.time() - start) * 1000
        if TRACE_LEVEL >= 2:
            print(f"[{now_iso()}][BE][API][{trace_id}] ← /query {duration_ms:.0f}ms")

        return {
            "status": "success",
            "message": text,
            "cleaned_query": cleaned_query,
            "tts_text": tts_text if audio else None,
            "audio": audio,
            "score": score,
        }

    # ── KEYBOARD PATH ────────────────────────────────────────────────────────
    else:
        data = await request.json()
        query = (data.get("query") or "").strip()
        lite = data.get("lite", False)

        voice = bool(data.get("voice", False))

        if voice:
            if TRACE_LEVEL >= 1:
                print(
                    f"[{now_iso()}][{trace_id_var.get()}] WARNING: /query keyboard path received voice:true — treating as keyboard"
                )

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] --- KEYBOARD REQUEST ---")
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] QUERY: {query}")

        if not query:
            return {
                "status": "error",
                "message": "Please enter a question.",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if len(query) > 500:
            return {
                "status": "error",
                "message": "Query too long.",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if len(query.split()) <= 1:
            return {
                "status": "success",
                "message": "Please say a full sentence like 'my sugar is high after meal'",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        result = await build_response(query, lite)
        text = result.get("text", "")
        score = result.get("score", 0)

        duration_ms = (time.time() - start) * 1000
        if TRACE_LEVEL >= 2:
            print(f"[{now_iso()}][BE][API][{trace_id}] ← /query {duration_ms:.0f}ms")

        # audio is always null for keyboard — spec constraint
        return {
            "status": "success",
            "message": text,
            "cleaned_query": None,
            "tts_text": None,
            "audio": None,
            "score": score,
            "intent": result.get("intent", "general"),
        }
