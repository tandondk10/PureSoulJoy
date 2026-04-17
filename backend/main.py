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

FOOD_DB = {
    "beans": {"fiber": 8, "carbs": 20, "fat": 1},
    "rice": {"fiber": 1, "carbs": 30, "fat": 0},
    "vegetable": {"fiber": 5, "carbs": 5, "fat": 0},
    "lentils": {"fiber": 8, "carbs": 20, "fat": 1},
    "paneer": {"fiber": 0, "carbs": 2, "fat": 20},
    "oats": {"fiber": 10, "carbs": 27, "fat": 5},
    "bread": {"fiber": 1, "carbs": 30, "fat": 0},
}

QUANTITY_MODIFIERS = {
    "little": 0.7,
    "small": 0.7,
    "more": 1.3,
    "large": 1.5,
}

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


# ---------------- CONTEXT ----------------
def detect_context(q: str) -> dict:
    q = q.lower()

    after = "after" in q or "post" in q
    meal = "meal" in q or "food" in q or "eat" in q

    return {
        "after_meal": after and meal,
        "high": any(x in q for x in ["high", "spike", "elevated"]),
        "low": any(x in q for x in ["low", "drop"]),
    }


# ---------------- INTENT ----------------
def detect_intent(q: str) -> str:
    text = q.lower()
    scores = {}

    for category, groups in KEYWORD_MAP.items():
        score = 0
        for group_name, keywords in groups.items():
            for kw in keywords:
                if kw in text:  # 🔥 simpler + better for phrases
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

    # 🔥 fallback layer (critical)
    if "cholesterol" in text or "ldl" in text:
        return "cholesterol"
    if "blood pressure" in text or "bp" in text:
        return "bp"
    if "sugar" in text or "glucose" in text:
        return "glucose"

    return "unknown"


def detect_mode(meal_data: dict, intent: str, q: str) -> str:

    recognized = meal_data.get("recognized", [])
    unknown = meal_data.get("unknown", [])

    if len(recognized) > 0:
        return "meal"

    if len(unknown) > 0 and intent == "unknown":
        return "meal"

    if intent == "unknown" and any(x in q for x in ["eat", "ate", "meal", "food"]):
        return "meal"

    return "chat"


def extract_meal_items(q: str) -> dict:
    food_words = {
        "rice",
        "dal",
        "roti",
        "paneer",
        "salad",
        "bread",
        "pasta",
        "lentil",
        "lentils",
        "bean",
        "beans",
        "vegetable",
        "vegetables",
        "fruit",
        "fruits",
        "oats",
        "egg",
        "eggs",
        "milk",
        "yogurt",
        "chicken",
    }
    STOPWORDS = {
        "how",
        "is",
        "my",
        "today",
        "what",
        "should",
        "i",
        "to",
        "the",
        "a",
        "an",
        "and",
        "or",
    }

    CONTEXT_WORDS = {"after", "before", "meal", "spike", "fasting"}
    INTENT_MODIFIERS = {"high", "low"}

    FOOD_SYNONYMS = {
        "rajma": "beans",
        "chawal": "rice",
        "chana": "beans",
        "sabzi": "vegetable",
        "bhindi": "vegetable",
        "paratha": "bread",
        "dal": "beans",
        "sambar": "beans",
        "lentils": "beans",
        "dal": "beans",
        "idli": "rice",
        "dosa": "rice",
    }

    words = re.findall(r"[a-zA-Z]+", q.lower())
    words = [FOOD_SYNONYMS.get(w, w) for w in words]

    recognized = []
    unknown = []
    context = []

    for w in words:
        if w in STOPWORDS:
            continue
        elif w in food_words:
            recognized.append(w)
        elif w in CONTEXT_WORDS:
            context.append(w)
        else:
            unknown.append(w)

    quantity_factor = 1.0
    for w in words:
        if w in QUANTITY_MODIFIERS:
            quantity_factor = QUANTITY_MODIFIERS[w]

    return {
        "recognized": list(dict.fromkeys(recognized)),
        "unknown": list(dict.fromkeys(unknown)),
        "context": list(dict.fromkeys(context)),
        "quantity": quantity_factor,
    }


def save_unknown_foods(items):
    with open("unknown_foods.log", "a") as f:
        for item in set(items):  # remove duplicates per request
            f.write(item + "\n")


# ---------------- SCORE ----------------
def compute_meal_score(meal_items, unknown_items, ctx):

    total_fiber = 0
    total_carbs = 0

    breakdown = []

    for item in meal_items:
        if item in FOOD_DB:
            fiber = FOOD_DB[item]["fiber"]
            carbs = FOOD_DB[item]["carbs"]

            total_fiber += fiber
            total_carbs += carbs

    score = 50

    # Fiber boost
    fiber_points = total_fiber * 2
    score += fiber_points
    breakdown.append(f"+ Fiber +{int(fiber_points)}")

    # Carb penalty
    if USER_PROFILE["phenotype"] == "post-meal spiker":
        carb_penalty = total_carbs * 0.3
    else:
        carb_penalty = total_carbs * 0.2

    total_carbs *= ctx.get("quantity", 1.0)

    score -= carb_penalty
    breakdown.append(f"- Carbs -{int(carb_penalty)}")

    # Meal balance
    has_carbs = any(x in meal_items for x in ["rice", "bread", "pasta"])
    has_fiber = any(x in meal_items for x in ["vegetable", "beans", "lentils"])
    has_protein = any(
        x in meal_items
        for x in ["beans", "lentils", "yogurt", "paneer", "milk", "eggs"]
    )

    if has_fiber and has_protein and has_carbs:
        score += 10
        breakdown.append("+ Balanced meal +10")
    elif has_carbs and not (has_fiber or has_protein):
        score -= 15
        breakdown.append("- No fiber/protein -15")
    elif has_carbs and has_fiber:
        score += 5
        breakdown.append("+ Fiber with carbs +5")

    # Context penalty (reduced — more correct)
    if ctx.get("after_meal") and ctx.get("high"):
        score -= 10
        breakdown.append("- Spike detected -10")

    # Unknown penalty
    unknown_penalty = len(unknown_items) * 5
    if unknown_penalty > 0:
        score -= unknown_penalty
        breakdown.append(f"- Unknown items -{unknown_penalty}")

    score = int(max(0, min(score, 100)))

    return score, breakdown


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
- Personalize recommendations based on the profile
- Max 3 actionable steps
- Be specific (minutes, portions)
- Adjust intensity:
    * Prediabetic → moderate
    * Diabetic → strict
    * Healthy → flexible

Respond ONLY in this exact format:

## Meal Score
...

## What To Do
1) ...
2) ...
3) ...

## Try This Week
+ ...

## Expected Outcome
...
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


# ---------------- LLM ----------------
def llm_response(q: str, ctx: dict) -> str:
    prompt = build_prompt(q, ctx)
    model = MODEL_OPENAI if LLM_MODE == "openai" else MODEL_CLAUDE

    res = completion(
        model=model,
        messages=[{"role": "user", "content": prompt}],
    )

    return extract_text(res)


# ---------------- FORMAT ----------------
def enforce_format(text: str) -> str:
    if "## Meal Score" in text:
        return text

    return f"""## Insight
{text}

## Next Step
Try asking again with more detail.
"""


# ---------------- TTS ----------------
def generate_tts(text):
    try:
        from openai import OpenAI
        import base64

        client = OpenAI()

        response = client.audio.speech.create(
            model="gpt-4o-mini-tts", voice="alloy", input=text
        )

        return base64.b64encode(response.content).decode("utf-8")

    except Exception as e:
        print("🔥 TTS ERROR:", str(e))
        return None  # ✅ NEVER crash backend


# ---------------- BUILD RESPONSE ----------------
async def build_response(query: str):
    if not query:
        return {
            "text": "Empty query",
            "score": 0,
            "score_breakdown": [],
            "intent": "unknown",
            "mode": "chat",
            "meal_items": [],
            "unknown_items": [],
        }

    q = correct_spelling(query)
    q = normalize(q)

    meal_data = extract_meal_items(q)
    meal_items = meal_data["recognized"]
    unknown_items = meal_data["unknown"]

    intent = detect_intent(q)
    print("🔥 QUERY:", cleaned_query)
    print("🔥 INTENT AFTER DETECT:", intent)

    if intent == "unknown" and len(q.split()) > 2:
        q = normalize(correct_with_llm(q))
        meal_data = extract_meal_items(q)
        meal_items = meal_data["recognized"]
        unknown_items = meal_data["unknown"]
        intent = detect_intent(q)
        print("🔥 QUERY2:", cleaned_query)
        print("🔥 INTENT AFTER DETECT2:", intent)

    ctx = detect_context(q)

    if unknown_items:
        print("NEW FOOD DETECTED:", unknown_items)
        save_unknown_foods(unknown_items)

    # FINAL MODE DECISION (single source of truth)

    mode = detect_mode(meal_data, intent, q)

    score, breakdown = compute_meal_score(meal_items, unknown_items, ctx)

    confidence = "high" if len(meal_items) > 0 and len(unknown_items) == 0 else "low"

    print("SCORE:", score)

    print(
        "FINAL:",
        {
            "q": q,
            "meal_items": meal_items,
            "unknown_items": unknown_items,
            "intent": intent,
            "mode": mode,
            "score": score,
            "score_breakdown": breakdown,
        },
    )
    # 🔥 FAST PATH FOR SIMPLE MEALS (ADD HERE)
    if (
        mode == "meal"
        and len(meal_items) <= 2
        and len(unknown_items) == 0
        and "rice" in meal_items
        and not any(x in meal_items for x in ["beans", "lentils", "yogurt"])
    ):
        action = (
            "Walk 15–20 minutes immediately"
            if ctx["high"]
            else "Walk 10–15 minutes after meal"
        )

        return {
            "text": f"""## Meal Score
    {score}

    ## What To Do
    1) Add fiber (vegetables or salad before this)
    2) Add protein (lentils, yogurt)
    3) {action}

    ## Try This Week
    + Pair carbs with fiber + protein

    ## Expected Outcome
    Lower glucose spikes and better balance""",
            "score": score,
            "score_breakdown": breakdown,
            "intent": intent,
            "mode": mode,
            "meal_items": meal_items,
            "unknown_items": unknown_items,
            "confidence": confidence,
        }

    if intent == "unknown" and mode == "chat":
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
            "score_breakdown": [],
            "intent": "unknown",
            "mode": "chat",
            "meal_items": meal_data["recognized"],
            "unknown_items": meal_data["unknown"],
        }

    if SCROLL_TEST:
        print("🔥 SCROLL TEST MODE")
        return {
            "text": scroll_test_response(),
            "score": score,
            "score_breakdown": breakdown,
            "intent": intent,
            "mode": mode,
            "meal_items": meal_data["recognized"],
            "unknown_items": meal_data["unknown"],
        }

    if USE_MOCK:
        return {
            "text": mock_response(intent),
            "score": score,
            "score_breakdown": breakdown,
            "intent": intent,
            "mode": mode,
            "meal_items": meal_data["recognized"],
            "unknown_items": meal_data["unknown"],
        }

    if USE_LLM:
        try:
            # ✅ STRUCTURE INPUT (this is your big upgrade)
            if meal_items or unknown_items:
                structured_meal = " ".join(meal_items + unknown_items)
                q_for_llm = f"""
                Meal items: {structured_meal}

                Computed Meal Score: {score}
                Score Breakdown:
                {chr(10).join(breakdown)}

                User context:
                - after meal: {ctx['after_meal']}
                - glucose high: {ctx['high']}
                - glucose low: {ctx['low']}
                """
            else:
                q_for_llm = q

            # ✅ SINGLE CLEAN CALL
            result = await asyncio.wait_for(
                asyncio.to_thread(llm_response, q_for_llm, ctx), timeout=15
            )

            return {
                "text": enforce_format(result),
                "score": score,
                "score_breakdown": breakdown,
                "intent": intent,
                "mode": mode,
                "meal_items": meal_data["recognized"],
                "unknown_items": meal_data["unknown"],
            }

        except asyncio.TimeoutError:
            print("LLM TIMEOUT")
            return {
                "text": "LLM timed out. Try again.",
                "score": score,
                "score_breakdown": breakdown,
                "intent": intent,
                "mode": mode,
                "meal_items": meal_data["recognized"],
                "unknown_items": meal_data["unknown"],
            }

        except Exception as e:
            print("LLM ERROR:", e)
            return {
                "text": mock_response(intent),
                "score": score,
                "score_breakdown": breakdown,
                "error": str(e),
                "intent": intent,
                "mode": mode,
                "meal_items": meal_data["recognized"],
                "unknown_items": meal_data["unknown"],
            }

    return {
        "text": """## Insight
    Fallback response active.

    ## Next Step
    Try asking about lifestyle, BP, glucose, or cholesterol.""",
        "score": score,
        "score_breakdown": breakdown,
        "intent": intent,
        "mode": mode,
        "meal_items": meal_data["recognized"],
        "unknown_items": meal_data["unknown"],
    }


def correct_spelling(text: str) -> str:
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


def extract_meal_items_simple(query: str) -> dict:
    foods = ["rice", "dal", "beans", "paneer", "roti", "bread", "milk"]

    q = query.lower()

    recognized = [f for f in foods if f in q]

    words = q.split()
    unknown = [w for w in words if w not in recognized]

    return {"recognized": recognized, "unknown": unknown}


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
    mode = "chat"
    result = {}
    start = time.time()
    content_type = request.headers.get("content-type", "")

    # ── VOICE PATH ──────────────────────────────────────────────────────────
    if "multipart/form-data" in content_type:
        form = await request.form()
        audio_file = form.get("audio_file")

        if audio_file is None:
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
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
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
            }

        if len(audio_bytes) > 25 * 1024 * 1024:
            return {
                "status": "error",
                "message": "Audio file too large.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
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
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
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
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
            }

        print("CLEANED QUERY:", cleaned_query)

        # ─── DETECT ─────────────────────────

        meal_data = extract_meal_items_simple(cleaned_query)

        intent = detect_intent(cleaned_query)

        mode = detect_mode(meal_data, intent, cleaned_query)

        # 🔥 override (temporary but powerful)
        q_lower = cleaned_query.lower()
        if "blood pressure" in q_lower:
            intent = "bp"
            mode = "chat"

        print("🔥 INTENT:", intent)
        print("🔥 MODE:", mode)
        print("🔥 MEAL DATA:", meal_data)

        # ─── ROUTING ────────────────────────
        result = None

        if mode == "meal":
            result = process_meal(cleaned_query)

        elif intent == "bp":
            result = {
                "message": "Your blood pressure may be elevated due to stress, salt, sleep, or hydration. Let’s break it down.",
                "score": 30,
                "score_breakdown": [],
                "meal_items": [],
                "unknown_items": [],
                "intent": intent,
                "mode": mode,
            }

        # 🔥 safety net
        if result is None:
            print("❌ FALLBACK TRIGGERED")
            result = {
                "message": "I understand your question. Let me guide you.",
                "score": 0,
                "score_breakdown": [],
                "meal_items": [],
                "unknown_items": [],
                "intent": intent,
                "mode": mode,
            }

        print("🔥 RESULT:", result)
        audio_base64 = None

        meal_items = result.get("meal_items", [])
        unknown_items = result.get("unknown_items", [])

        text = result.get("message", "")
        score = result.get("score", 0)
        intent = result.get("intent", "unknown")
        mode = result.get("mode", "chat")
        breakdown = result.get("score_breakdown", [])

        if not text:
            text = "Something went wrong. Please try again."

        # Backend selects TTS text — frontend never trims or selects
        tts_text = text
        audio = None

        try:
            raw_audio = await asyncio.wait_for(
                asyncio.to_thread(generate_tts, tts_text), timeout=15
            )

            import base64

            audio = base64.b64encode(raw_audio).decode("utf-8") if raw_audio else None

            print("🎧 AUDIO GENERATED:", bool(audio))

        except Exception as e:
            print("🔥 TTS ERROR:", e)
            audio = None

        return {
            "status": "success",
            "message": text,
            "cleaned_query": cleaned_query,
            "tts_text": text if audio else None,
            "audio": audio,
            "score": score,
            "score_breakdown": breakdown,
            "intent": intent,
            "mode": mode,
            "meal_items": meal_items,
            "unknown_items": unknown_items,
        }

    # ── KEYBOARD PATH ────────────────────────────────────────────────────────
    else:
        data = await request.json()
        query = (data.get("query") or "").strip()
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
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
            }

        if len(query) > 500:
            return {
                "status": "error",
                "message": "Query too long.",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": [],
                "unknown_items": [],
            }

        meal_data = extract_meal_items(query.lower())
        meal_items = meal_data["recognized"]
        unknown_items = meal_data["unknown"]

        intent = detect_intent(query.lower())

        if len(query.split()) <= 1 and intent == "unknown" and len(meal_items) == 0:
            return {
                "status": "success",
                "message": "Please say a full sentence like 'my sugar is high after meal'",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
                "score_breakdown": [],
                "intent": "unknown",
                "mode": "chat",
                "meal_items": meal_items,
                "unknown_items": unknown_items,
            }

        result = await build_response(query)
        text = result.get("text", "")
        score = result.get("score", 0)
        intent = result.get("intent", "unknown")
        mode = result.get("mode", "chat")
        meal_items = result.get("meal_items", [])
        unknown_items = result.get("unknown_items", [])

        print("⏱️", round(time.time() - start, 2), "sec\n")

        # audio is always null for keyboard — spec constraint

        print("DEBUG INTENT:", intent)
        print("DEBUG MODE:", mode)
        print("DEBUG RESULT:", result)

        safe_result = result if isinstance(result, dict) else {}

        text = safe_result.get("message", "Something went wrong. Please try again.")

        q_lower = (cleaned_query or "").lower()

        if "blood pressure" in q_lower:
            intent = "bp"
            mode = "chat"
            print("🔥 INTENT AFTER OVERRIDE:", intent)

        return {
            "status": "success" if safe_result else "error",
            "message": text,
            "cleaned_query": cleaned_query,
            "tts_text": text,
            "audio": None,
            "score": safe_result.get("score", 0),
            "score_breakdown": safe_result.get("score_breakdown", []),
            "intent": intent or "unknown",
            "mode": mode or "chat",
            "meal_items": meal_items if "meal_items" in locals() else [],
            "unknown_items": unknown_items if "unknown_items" in locals() else [],
        }
