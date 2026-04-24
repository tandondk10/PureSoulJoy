from fastapi import FastAPI, Request
from openai import OpenAI
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

print("LLM_MODE:", LLM_MODE)
print("USE_LLM:", USE_LLM)
print("USE_MOCK:", USE_MOCK)
print("SCROLL_TEST:", SCROLL_TEST)

app = FastAPI()

print("🚨 LLM BACKEND RUNNING")


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
    raw = (raw_transcript or "").strip()

<<<<<<< Updated upstream
    # Case A: null, empty, or Whisper hallucination
    if not raw or is_hallucination(raw):
        return "Could not understand. Please try again.", ""
=======
        # Case A: null, empty, or Whisper hallucination
        if not raw or is_hallucination(raw):
            result = ("Could not understand. Please try again.", "")
            print(f"{tid} BE L3 validate_voice_query RESULT case=A error={result[0]!r}")
            return result
>>>>>>> Stashed changes

    # Trigger removal (before B/C/D checks)
    trigger_found = has_trigger(raw)
    cleaned = remove_trigger(raw)

<<<<<<< Updated upstream
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
=======
        # Case B: transcript contained only the trigger phrase
        if trigger_found and not cleaned:
            result = ("Please say your question or meal before Go ImproveMe.", "")
            print(f"{tid} BE L3 validate_voice_query RESULT case=B error={result[0]!r}")
            return result

        # Case C: no word with 3 or more characters
        if len(cleaned.strip()) < 3:
            result = ("Please say a complete question or meal.", cleaned)
            print(f"{tid} BE L3 validate_voice_query RESULT case=C error={result[0]!r}")
            return result

        # Case D: only whitespace or punctuation
        if not re.sub(r"[^\w]", "", cleaned).strip():
            result = ("Could not understand. Please try again.", cleaned)
            print(f"{tid} BE L3 validate_voice_query RESULT case=D error={result[0]!r}")
            return result

        result = (None, cleaned)
        print(f"{tid} BE L3 validate_voice_query RESULT case=OK cleaned={cleaned!r}")
        return result
>>>>>>> Stashed changes


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
    q = q.lower().strip()
    q = q.replace("-", " ")
    q = re.sub(r"\bbp\b", "blood pressure", q)
    q = re.sub(r"\bbg\b", "blood glucose", q)
    q = re.sub(r"\bblood sugar\b", "glucose", q)
    return q


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
    result = q.lower()
    for phrase in _MEAL_FILLERS:
        result = re.sub(phrase, "", result, flags=re.IGNORECASE)
    result = re.sub(r"\band\b", ",", result)
    result = re.sub(r",\s*,", ",", result)
    result = re.sub(r"\s+", " ", result).strip(" ,")
    return result


# ---------------- CONTEXT ----------------
<<<<<<< Updated upstream
def detect_context(q: str) -> dict:
    return {
        "after_meal": any(x in q for x in ["after meal", "post meal"]),
        "high": any(x in q for x in ["high", "spike", "elevated"]),
        "low": any(x in q for x in ["low", "drop"]),
    }
=======
def detect_context(tid: str, q: str) -> dict:
    with trace_block(tid, 4, "BE"):
        result = {
            "after_meal": any(x in q for x in ["after meal", "post meal"]),
            "high": any(x in q for x in ["high", "spike", "elevated"]),
            "low": any(x in q for x in ["low", "drop"]),
        }
        print(f"{tid} BE L4 detect_context RESULT {result}")
        return result
>>>>>>> Stashed changes


# ---------------- INTENT ----------------

VALID_INTENTS = {"lifestyle", "glucose", "cholesterol", "blood_pressure", "unknown"}

model_name = MODEL_OPENAI if LLM_MODE == "openai" else MODEL_CLAUDE


def classify_intent_llm(query: str) -> str:
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
<<<<<<< Updated upstream
    try:
        response = completion(
            model=model_name,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=5,
        )
        intent = response["choices"][0]["message"]["content"].strip().lower()
        return intent
    except Exception as e:
        print("LLM intent error:", e)
        return "unknown"
=======
        try:
            response = completion(
                model=model_name,
                messages=[{"role": "user", "content": prompt}],
                temperature=0,
                max_tokens=5,
            )
            result = response["choices"][0]["message"]["content"].strip().lower()
            print(f"{tid} LLM L4 classify_intent_llm RESULT {result}")
            return result
        except Exception as e:
            print(f"{tid} LLM L1 classify_intent_llm ERROR {e}")
            result = "unknown"
            print(f"{tid} LLM L4 classify_intent_llm RESULT {result} (fallback)")
            return result
>>>>>>> Stashed changes


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


def detect_intent(q: str) -> str:

<<<<<<< Updated upstream
    s = q.lower()

    # 🔥 DOMAIN INTENTS FIRST

    if any(x in s for x in ["statin", "metformin", "medicine", "medication", "drug"]):
        return "medication"

    if "bp" in s or "blood pressure" in s:
        return "bp"

    if "sugar" in s or "glucose" in s:
        return "glucose"

    if any(x in s for x in ["cholesterol", "hdl", "ldl"]):
        return "cholesterol"

    if is_food_list(q) or is_single_food_phrase(q):
        return "lifestyle"
=======
        def _return(intent: str, method: str) -> str:
            print(f"{tid} BE L4 detect_intent RESULT {intent} via={method}")
            return intent

        # 🔥 DOMAIN INTENTS FIRST
        if any(x in s for x in ["statin", "metformin", "medicine", "medication", "drug"]):
            return _return("medication", "keyword")

        if "bp" in s or "blood pressure" in s:
            return _return("bp", "keyword")

        if "sugar" in s or "glucose" in s:
            return _return("glucose", "keyword")

        if any(x in s for x in ["cholesterol", "hdl", "ldl"]):
            return _return("cholesterol", "keyword")

        if is_food_list(q) or is_single_food_phrase(q):
            return _return("lifestyle", "food_signal")

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
            return _return(max(scores, key=scores.get), "keyword_score")

        q = text.lower().strip()

        if any(
            w in q
            for w in [
                "healthy", "breakfast", "lunch", "dinner", "food", "diet", "eat", "ideas",
                "what is", "define", "meaning", "explain",
                "blood sugar", "a1c",
                "insulin", "insulin resistance", "insulin sensitivity",
                "spike", "spikes", "crash", "response", "responder",
                "glucotype", "glucose type", "type of glucose",
            ]
        ):
            return _return("lifestyle", "extended_keyword")

        if is_question(q):
            return _return("unknown", "question_guard")

        if USE_LLM:
            intent = classify_intent_llm(tid, q)
            if intent not in VALID_INTENTS:
                return _return("unknown", "llm_invalid")
            return _return(intent, "llm")

        return _return("lifestyle", "default")
>>>>>>> Stashed changes

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
        print("KEYWORD_MATCH:", q)
        return "lifestyle"

    if is_question(q):
        return "unknown"

    print("FALLING_TO_LLM:", q)
    if USE_LLM:
        intent = classify_intent_llm(q)
        if intent not in VALID_INTENTS:
            return "unknown"
        print("LLM_INTENT_USED:", q, "→", intent)
        return intent

    return "lifestyle"


# ---------------- SCORE ----------------
def compute_score(intent: str, q: str) -> int:
    score = 50

<<<<<<< Updated upstream
    if intent == "unknown":
        return 40
=======
        if intent == "unknown":
            print(f"{tid} BE L4 compute_score RESULT 40")
            return 40
>>>>>>> Stashed changes

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

<<<<<<< Updated upstream
    return max(0, min(score, 100))
=======
        result = max(0, min(score, 100))
        print(f"{tid} BE L4 compute_score RESULT {result}")
        return result
>>>>>>> Stashed changes


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
    return f"""
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


# ---------------- LITE PROMPT ----------------
def build_lite_prompt(q: str) -> str:
    return f"""
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


# ---------------- EXTRACT ----------------
def extract_text(res):
    try:
        if isinstance(res, dict):
            return res["choices"][0]["message"]["content"]
        return res.choices[0].message.content
    except Exception as e:
        print("EXTRACT ERROR:", e)
        return str(res)


# ---------------- CALL LLM ----------------
<<<<<<< Updated upstream
def call_llm(prompt: str) -> str:
    model = MODEL_OPENAI if LLM_MODE == "openai" else MODEL_CLAUDE
    res = completion(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )
    return extract_text(res)


# ---------------- LITE VALIDATOR ----------------
def validate_lite_response(text: str) -> tuple:
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


# ---------------- LLM ----------------
def llm_response(q: str, ctx: dict, lite: bool) -> str:
    print("RAW QUERY:", q)
    if is_meal_sentence(q):
        q = clean_meal_text(q)
        print("CLEANED QUERY:", q)

    if lite:
        prompt = build_lite_prompt(q)

        text = call_llm(prompt)
        is_valid, reason = validate_lite_response(text)

        if is_valid:
            return text

        print("VALIDATION FAILED:", reason)

        retry_prompt = (
            prompt + "\n\nRewrite the answer simpler, shorter, and more conversational."
        )
        text_retry = call_llm(retry_prompt)
        is_valid_retry, _ = validate_lite_response(text_retry)

        if is_valid_retry:
            return text_retry

        return text

    else:
        prompt = build_prompt(q, ctx)
        return call_llm(prompt)


# ---------------- FORMAT ----------------
def enforce_format(text: str) -> str:
    if all(x in text for x in ["## Insight", "## What To Do", "## Expected Outcome"]):
        return text

    return f"""## Insight
=======
def call_llm(tid: str, prompt: str) -> str:
    with trace_block(tid, 4, "LLM"):
        model = MODEL_OPENAI if LLM_MODE == "openai" else MODEL_CLAUDE
        res = completion(
            model=model,
            messages=[{"role": "user", "content": prompt}],
        )
        result = extract_text(res)
        print(f"{tid} LLM L4 call_llm RESULT len={len(result)}")
        return result


# ---------------- LITE VALIDATOR ----------------
def validate_lite_response(tid: str, text: str) -> tuple:
    with trace_block(tid, 4, "BE"):
        def _return(valid: bool, reason: str) -> tuple:
            print(f"{tid} BE L4 validate_lite_response RESULT valid={valid} reason={reason}")
            return valid, reason

        if not text:
            return _return(False, "empty")

        sentences = [s.strip() for s in text.split(".") if s.strip()]
        if len(sentences) < 1 or len(sentences) > 4:
            return _return(False, "sentence_count")

        forbidden = ["##", "* ", "\n- ", "\n1)", "\n2)", "\n3)"]
        if any(f in text for f in forbidden):
            return _return(False, "format")

        if len(text.strip()) > 350:
            return _return(False, "too_long")

        jargon_words = ["mmhg", "glycemic"]
        if any(j in text.lower() for j in jargon_words):
            return _return(False, "jargon")

        return _return(True, "ok")


# ---------------- LLM ----------------
def llm_response(tid: str, q: str, ctx: dict, lite: bool) -> str:
    with trace_block(tid, 3, "BE"):
        if is_meal_sentence(q):
            q = clean_meal_text(q)
            print(f"{tid} BE L3 llm_response CLEANED_QUERY {q!r}")

        if lite:
            prompt = build_lite_prompt(q)
            text = call_llm(tid, prompt)
            is_valid, reason = validate_lite_response(tid, text)

            if is_valid:
                print(f"{tid} BE L3 llm_response RESULT attempt=1 len={len(text)}")
                return text

            retry_prompt = prompt + "\n\nRewrite the answer simpler, shorter, and more conversational."
            text_retry = call_llm(tid, retry_prompt)
            is_valid_retry, _ = validate_lite_response(tid, text_retry)

            if is_valid_retry:
                print(f"{tid} BE L3 llm_response RESULT attempt=2 len={len(text_retry)}")
                return text_retry

            print(f"{tid} BE L3 llm_response RESULT attempt=1_fallback len={len(text)}")
            return text

        else:
            prompt = build_prompt(q, ctx)
            result = call_llm(tid, prompt)
            print(f"{tid} BE L3 llm_response RESULT mode=detailed len={len(result)}")
            return result


# ---------------- FORMAT ----------------
def enforce_format(tid: str, text: str) -> str:
    with trace_block(tid, 4, "BE"):
        if all(x in text for x in ["## Insight", "## What To Do", "## Expected Outcome"]):
            print(f"{tid} BE L4 enforce_format RESULT pass")
            return text

        result = f"""## Insight
>>>>>>> Stashed changes
{text}

## What To Do
• Ask your question more clearly
• Include food, symptom, or goal

## Expected Outcome
More accurate and useful guidance
"""
        print(f"{tid} BE L4 enforce_format RESULT wrapped")
        return result


# ---------------- TTS ----------------
<<<<<<< Updated upstream
def generate_tts(text: str):
    try:
        speech = client.audio.speech.create(
            model="gpt-4o-mini-tts", voice="alloy", input=text
        )
        audio_bytes = speech.read()
        return base64.b64encode(audio_bytes).decode("utf-8")

    except Exception as e:
        print("TTS ERROR:", e)
        return None
=======
def generate_tts(tid: str, text: str):
    with trace_block(tid, 4, "BE"):
        try:
            speech = client.audio.speech.create(
                model="gpt-4o-mini-tts", voice="alloy", input=text
            )
            audio_bytes = speech.read()
            result = base64.b64encode(audio_bytes).decode("utf-8")
            print(f"{tid} BE L4 generate_tts RESULT bytes={len(audio_bytes)}")
            return result

        except Exception as e:
            print(f"{tid} BE L1 generate_tts ERROR {e}")
            print(f"{tid} BE L4 generate_tts RESULT None")
            return None
>>>>>>> Stashed changes


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
<<<<<<< Updated upstream
async def build_response(query: str, lite: bool):
    print("LITE MODE:", lite)

    if not query:
        return {"text": "Empty query", "score": 0}

    # ✅ normalize FIRST
    q = correct_spelling(query)
    q = normalize(q)

    # ✅ pairing override
    if is_pairing_query(q):
        return {
            **build_pairing_response(q),
            "score": 50,
            "intent": "lifestyle",
        }

    ctx = detect_context(q)
    intent = detect_intent(q)

    score = compute_score(intent, q)
    print("SCORE:", score)

    if intent == "unknown":
        q = correct_with_llm(q)
        intent = detect_intent(q)

    print("\n--- REQUEST ---")
    print("QUERY:", q)
    print("INTENT:", intent)

    # ✅ medication shortcut
    if intent == "medication":
        return medication_response()

    # ✅ fallback (safe now)
    if intent in ("unknown", "general"):
        if lite:
            return lite_fallback_response()
        return {
            "text": """## Insight
=======
async def build_response(tid: str, query: str, lite: bool):
    with trace_block(tid, 3, "BE"):
        if not query:
            print(f"{tid} BE L3 build_response RESULT empty_query")
            return {"text": "Empty query", "score": 0}

        q = correct_spelling(tid, query)
        q = normalize(q)

        if is_pairing_query(q):
            result = {**build_pairing_response(q), "score": 50, "intent": "lifestyle"}
            print(f"{tid} BE L3 build_response RESULT pairing")
            return result

        ctx = detect_context(tid, q)
        intent = detect_intent(tid, q)
        score = compute_score(tid, intent, q)

        print(f"{tid} BE L3 build_response DOMAIN {intent}")
        print(f"{tid} BE L3 build_response ENRICH {ctx}")

        if intent == "unknown":
            q = correct_with_llm(tid, q)
            intent = detect_intent(tid, q)
            print(f"{tid} BE L3 build_response DOMAIN_CORRECTED {intent}")

        if intent == "medication":
            print(f"{tid} BE L3 build_response RESULT medication_shortcut")
            return medication_response()

        if intent in ("unknown", "general"):
            if lite:
                print(f"{tid} BE L3 build_response RESULT lite_fallback")
                return lite_fallback_response()
            print(f"{tid} BE L3 build_response RESULT unknown_fallback")
            return {
                "text": """## Insight
>>>>>>> Stashed changes
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
        print("🔥 SCROLL TEST MODE")
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

<<<<<<< Updated upstream
        except asyncio.TimeoutError:
            print("LLM TIMEOUT")
            return {
                "text": "LLM timed out. Try again.",
                "score": score,
                "intent": intent,
            }

        except Exception as e:
            print("LLM ERROR:", e)
            return {
                "text": mock_response(intent),
                "score": score,
                "intent": intent,
                "error": str(e),
            }

    return {
        "text": """## Insight
=======
        if SCROLL_TEST:
            print(f"{tid} BE L3 build_response RESULT scroll_test")
            return {"text": scroll_test_response(), "score": score, "intent": intent}

        if USE_MOCK:
            print(f"{tid} BE L3 build_response RESULT mock intent={intent}")
            return {"text": mock_response(intent), "score": score, "intent": intent}

        if USE_LLM:
            try:
                llm_text = await asyncio.wait_for(
                    asyncio.to_thread(llm_response, tid, q, ctx, lite), timeout=15
                )
                result = {
                    "text": llm_text if lite else enforce_format(tid, llm_text),
                    "score": score,
                    "intent": intent,
                }
                print(f"{tid} BE L3 build_response RESULT llm intent={intent} score={score}")
                return result

            except asyncio.TimeoutError:
                print(f"{tid} BE L1 build_response ERROR llm_timeout")
                print(f"{tid} BE L3 build_response RESULT timeout")
                return {"text": "LLM timed out. Try again.", "score": score, "intent": intent}

            except Exception as e:
                print(f"{tid} BE L1 build_response ERROR {e}")
                print(f"{tid} BE L3 build_response RESULT llm_error_mock")
                return {"text": mock_response(intent), "score": score, "intent": intent, "error": str(e)}

        print(f"{tid} BE L3 build_response RESULT no_llm_fallback")
        return {
            "text": """## Insight
>>>>>>> Stashed changes
Fallback response active.

## Next Step
Try asking about lifestyle, BP, glucose, or cholesterol.""",
        "score": score,
        "intent": intent,
    }


def correct_spelling(text: str) -> str:
    words = text.split()
    corrected = []

<<<<<<< Updated upstream
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


def correct_with_llm(text: str) -> str:
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
=======
        for w in words:
            lw = w.lower()
            if lw in COMMON_CORRECTIONS:
                corrected.append(COMMON_CORRECTIONS[lw])
                continue
            match = difflib.get_close_matches(lw, COMMON_CORRECTIONS.keys(), n=1, cutoff=0.85)
            if match:
                corrected.append(COMMON_CORRECTIONS[match[0]])
            else:
                corrected.append(w)

        result = " ".join(corrected)
        print(f"{tid} BE L4 correct_spelling RESULT {result!r}")
        return result


def correct_with_llm(tid: str, text: str) -> str:
    with trace_block(tid, 4, "LLM"):
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
            result = extract_text(res).strip()
            print(f"{tid} LLM L4 correct_with_llm RESULT {result!r}")
            return result
        except Exception as e:
            print(f"{tid} LLM L1 correct_with_llm ERROR {e}")
            print(f"{tid} LLM L4 correct_with_llm RESULT {text!r} (passthrough)")
            return text
>>>>>>> Stashed changes


def extract_target_food(q: str) -> str:
    q = q.lower()
    match = re.search(r"(?:with|for)\s+(.+)", q)
    if not match:
        return ""
    return match.group(1).replace("?", "").strip()


def build_pairing_response(q: str) -> dict:
    food = extract_target_food(q)

    if not food:
        return lite_fallback_response()

    return {
        "text": get_pairing_advice(food),
        "intent": "lifestyle",
        "score": 0,
    }


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
    original = req.items
    print("NORMALIZE RAW:", original)

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
        print("NORMALIZE OUTPUT:", result)
        return {"items": result}

    except Exception as e:
        print("NORMALIZE ERROR:", e)
        return {"items": original}


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
    content_type = request.headers.get("content-type", "")

    # ── VOICE PATH ──────────────────────────────────────────────────────────
    if "multipart/form-data" in content_type:
        form = await request.form()
        lite = form.get("lite") == "true"
        print("VOICE LITE:", lite)
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
        print(f"\n--- VOICE REQUEST ---")
        print(f"File: {audio_file.filename}, Size: {len(audio_bytes)} bytes")

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
            print("WHISPER TIMEOUT")
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        print("WHISPER RAW:", raw_transcript)

        error_msg, cleaned_query = validate_voice_query(raw_transcript)

        if error_msg:
            print("VALIDATION FAILED:", error_msg)
            return {
                "status": "error",
                "message": error_msg,
                "cleaned_query": cleaned_query,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        print("CLEANED QUERY:", cleaned_query)

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
            print("TTS TIMEOUT")
            audio = None

        print("⏱️", round(time.time() - start, 2), "sec\n")

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
            print(
                "WARNING: /query keyboard path received voice:true — treating as keyboard"
            )

        print(f"\n--- KEYBOARD REQUEST ---")
        print(f"QUERY: {query}")

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

        print("⏱️", round(time.time() - start, 2), "sec\n")

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
