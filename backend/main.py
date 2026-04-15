from fastapi import FastAPI, Request
from openai import OpenAI
import io
import re
import os
import time
import asyncio
import base64
import difflib
import json   # ✅ ADDED


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
    "name": "   ",
    "age": 63,
    "condition": "prediabetic",
    "a1c": 6.0,
    "ldl": 100,
    "goal": "reduce glucose spikes",
    "diet": "vegetarian",
    "phenotype": "post-meal spiker"
}

COMMON_CORRECTIONS = {
    "excercise": "exercise",
    "excersise": "exercise",
    "glocose": "glucose",
    "suger": "sugar",
    "colestrol": "cholesterol",
    "bp": "blood pressure",  # you already handle this, but safe
}

def log_trace(trace_id: str, step: str, data=None):
    print(f"[{trace_id}] {step}", data if data else "")

# ---------------- SCROLL TEST ----------------
def long_block(title: str) -> str:
    return "\n".join([
        f"{i+1}. {title} detail explaining behavior, impact, and optimization pattern."
        for i in range(40)
    ])


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
    r'\s*(go\s+improve\s*me|इम्प्रूव\s*मी)\s*[.!?]?\s*$',
    re.IGNORECASE
)


def has_trigger(text: str) -> bool:
    return bool(TRIGGER_PATTERN.search(text))


def remove_trigger(text: str) -> str:
    return TRIGGER_PATTERN.sub('', text).strip()


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
    words = re.findall(r'\w+', cleaned)
    if len(cleaned.strip()) < 3:
        return "Please say a complete question or meal.", cleaned

    # Case D: only whitespace or punctuation
    if not re.sub(r'[^\w]', '', cleaned).strip():
        return "Could not understand. Please try again.", cleaned

    return None, cleaned


# ---------------- KEYWORD MAP ----------------
KEYWORD_MAP = {
    "glucose": {
        "primary": ["glucose", "blood glucose", "sugar", "blood sugar", "bg", "diabetes"],
        "medical": ["a1c", "hba1c", "insulin", "glycemic", "hypoglycemia", "hyperglycemia"],
        "food": ["carb", "carbs", "dessert", "sweet", "juice", "soda"],
        "context": ["fasting", "postprandial", "after meal", "post meal"]
    },

    "bp": {
        "primary": ["blood pressure", "bp", "pressure", "hypertension", "hypotension"],
        "medical": ["systolic", "diastolic"],
        "lifestyle": ["salt", "sodium"],
        "symptoms": ["dizziness", "headache"]
    },

    "cholesterol": {
        "primary": ["cholesterol", "chol", "ldl", "hdl", "lipid", "triglyceride", "tg"],
        "medical": ["statin", "plaque"],
        "food": ["fat", "saturated", "trans fat"]
    },

    "lifestyle": {
        "diet": ["diet", "food", "meal", "eat", "nutrition"],
        "activity": ["exercise", "workout", "walk", "steps"],
        "recovery": ["sleep", "stress", "meditation"],
        "body": ["weight", "fitness"],
        "habits": ["lifestyle", "habit", "routine"]
    }
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
    return {
        "after_meal": any(x in q for x in ["after meal", "post meal"]),
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

    return "unknown"


# ---------------- SCORE ----------------
def compute_score(intent: str, q: str) -> int:
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
def build_prompt(q: str, ctx: dict, user_profile=None) -> str:
    profile = user_profile or USER_PROFILE   # 👈 ADD HERE

    return f"""
You are a lifestyle health assistant.

User Profile:
- Age: {profile.get('age')}
- Condition: {profile.get(profile.get("condition", 'unknown'))} (A1C {profile.get('a1c', 'NA')})
- LDL: {profile.get('ldl', 'NA')}
- Goal: {profile.get('goal', 'improve health')}
- Diet: {profile.get('diet', 'NA')}
- Phenotype: {profile.get('phenotype', 'general')}

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
def generate_tts(text: str):
    try:
        speech = client.audio.speech.create(
            model="gpt-4o-mini-tts",
            voice="alloy",
            input=text
        )
        audio_bytes = speech.read()
        return base64.b64encode(audio_bytes).decode("utf-8")

    except Exception as e:
        print("TTS ERROR:", e)
        return None


# ---------------- BUILD RESPONSE ----------------
async def build_response(query: str, user_profile=None, trace_id="NO_TRACE"):
    if not query:
        return {"text": "Empty query", "score": 0}

    q = correct_spelling(query)
    q = normalize(q)
    log_trace(trace_id, "NORMALIZED_QUERY", q)   # ✅ ADDED

    ctx = detect_context(q)
    intent = detect_intent(q)

    log_trace(trace_id, "INTENT", intent)        # ✅ ADDED
    log_trace(trace_id, "CONTEXT", ctx)          # ✅ ADDED

    score = compute_score(intent, q)
    log_trace(trace_id, "SCORE", score)          # ✅ ADDED

    if intent == "unknown":
        q = correct_with_llm(q)
        intent = detect_intent(q)
        log_trace(trace_id, "INTENT_AFTER_CORRECTION", intent)  # ✅ ADDED

    print("\n--- REQUEST ---")
    print("QUERY:", q)
    print("INTENT:", intent)

    if intent == "unknown":
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
        "score": 0
        }

    if SCROLL_TEST:
        print("🔥 SCROLL TEST MODE")
        return {"text": scroll_test_response(), "score": score}

    if USE_MOCK:
        return {"text": mock_response(intent), "score": score}

    if USE_LLM:
        try:
            log_trace(trace_id, "LLM_CALL_START")
            result = await asyncio.wait_for(
                asyncio.to_thread(llm_response, q, ctx),
                timeout=15
            )
            log_trace(trace_id, "LLM_CALL_DONE")
            return {"text": enforce_format(result), "score": score}

        except asyncio.TimeoutError:
            log_trace(trace_id, "LLM_TIMEOUT")   # ✅ FIXED
            return {"text": "LLM timed out. Try again.", "score": score}

        except Exception as e:
            log_trace(trace_id, "LLM_ERROR", str(e))   # ✅ FIXED
            return {
                "text": mock_response(intent),
                "score": score,
                "error": str(e)
            }

    return {
        "text": """## Insight
Fallback response active.

## Next Step
Try asking about lifestyle, BP, glucose, or cholesterol.""",
        "score": score
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
        match = difflib.get_close_matches(lw, COMMON_CORRECTIONS.keys(), n=1, cutoff=0.85)
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
                    "content": "Correct spelling only. Do not change meaning. Return only corrected sentence."
                },
                {
                    "role": "user",
                    "content": text
                }
            ],
        )
        return extract_text(res).strip()
    except:
        return text
    
    

# ---------------- QUERY ENDPOINT (voice + keyboard) ----------------
@app.post("/query")
async def handle_query(request: Request):
    start_total = time.time()
    content_type = request.headers.get("content-type", "")

    # ── VOICE PATH ──────────────────────────────────────────────────────────
    if "multipart/form-data" in content_type:
        form = await request.form()
        trace_id = form.get("traceId", "NO_TRACE")

        log_trace(trace_id, "REQUEST_RECEIVED")
        log_trace(trace_id, "INPUT_TYPE", "voice")

        audio_file = form.get("audio_file")
        user_profile_raw = form.get("user_profile")

        try:
            user_profile = json.loads(user_profile_raw) if user_profile_raw else None
        except:
            user_profile = None

        if audio_file is None:
            log_trace(trace_id, "INPUT_VALIDATION_FAILED")
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        audio_bytes = await audio_file.read()
        log_trace(trace_id, "AUDIO_SIZE", len(audio_bytes))

        if len(audio_bytes) == 0:
            log_trace(trace_id, "EMPTY_AUDIO")
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if len(audio_bytes) > 25 * 1024 * 1024:
            log_trace(trace_id, "AUDIO_TOO_LARGE")
            return {
                "status": "error",
                "message": "Audio file too large.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        # ── TRANSCRIPTION ─────────────────────────────
        log_trace(trace_id, "TRANSCRIPTION_START")

        audio_io = io.BytesIO(audio_bytes)
        filename = (audio_file.filename or "").lower()
        ext = filename.split(".")[-1] if "." in filename else "m4a"
        audio_io.name = audio_file.filename or f"audio.{ext}"

        try:
            transcript_obj = await asyncio.wait_for(
                asyncio.to_thread(
                    lambda: client.audio.transcriptions.create(
                        model="gpt-4o-mini-transcribe",
                        file=audio_io
                    )
                ),
                timeout=10
            )
            raw_transcript = (transcript_obj.text or "").strip()
            log_trace(trace_id, "TRANSCRIPTION_DONE", raw_transcript)
        except asyncio.TimeoutError:
            log_trace(trace_id, "TRANSCRIPTION_TIMEOUT")
            return {
                "status": "error",
                "message": "Could not understand. Please try again.",
                "cleaned_query": "",
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        error_msg, cleaned_query = validate_voice_query(raw_transcript)
        log_trace(trace_id, "QUERY_CLEANED", cleaned_query)

        if error_msg:
            log_trace(trace_id, "VALIDATION_FAILED", error_msg)
            return {
                "status": "error",
                "message": error_msg,
                "cleaned_query": cleaned_query,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        # ── LLM CALL ─────────────────────────────
        log_trace(trace_id, "LLM_CALL_START")
        start_llm = time.time()

        result = await build_response(cleaned_query, user_profile, trace_id)

        llm_latency = int((time.time() - start_llm) * 1000)
        log_trace(trace_id, "LLM_RESPONSE_RECEIVED")
        log_trace(trace_id, "LLM_LATENCY_MS", llm_latency)

        text = result.get("text", "") or "Something went wrong. Please try again."
        score = result.get("score", 0)
        log_trace(trace_id, "FINAL_RESPONSE_PREVIEW", text[:100])
        

        # ── AUDIO GENERATION ─────────────────────
        tts_text = text
        audio = None

        log_trace(trace_id, "AUDIO_GENERATION_START")
        start_audio = time.time()   # ✅ ADD THIS LINE

        try:
            audio = await asyncio.wait_for(
                asyncio.to_thread(generate_tts, tts_text),
                timeout=15
            )
        except asyncio.TimeoutError:
            log_trace(trace_id, "AUDIO_TIMEOUT")

        audio_latency = int((time.time() - start_audio) * 1000)   # now safe
        log_trace(trace_id, "AUDIO_GENERATION_DONE")
        log_trace(trace_id, "AUDIO_LATENCY_MS", audio_latency)

        total_ms = int((time.time() - start_total) * 1000)
        log_trace(trace_id, "TOTAL_BACKEND_MS", total_ms)
        log_trace(trace_id, "RESPONSE_SENT")
        
        print("🚨 DEBUG TTS TEXT LENGTH:", len(tts_text) if tts_text else "None")
        print("🚨 DEBUG AUDIO VALUE:", "YES" if audio else "NO")
        print("🚨 DEBUG AUDIO TYPE:", type(audio))

        return {
            "message": text,
            "audio": audio,          # 🔥 THIS MUST CHANGE
            "tts_text": tts_text,
            "cleaned_query": cleaned_query,
            "status": "success"
        }

    # ── KEYBOARD PATH ────────────────────────────────────────────────────────
    else:
        data = await request.json()
        trace_id = data.get("traceId", "NO_TRACE")
        query = (data.get("query") or "").strip()
        log_trace(trace_id, "REQUEST_RECEIVED")
        log_trace(trace_id, "INPUT_TYPE", "text")
        log_trace(trace_id, "QUERY", query)
        log_trace(trace_id, "QUERY_CLEANED", query)

        if not query:
            log_trace(trace_id, "EMPTY_QUERY")
            return {
                "status": "error",
                "message": "Please enter a question.",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        if len(query) > 500:
            log_trace(trace_id, "QUERY_TOO_LONG")
            return {
                "status": "error",
                "message": "Query too long.",
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": 0,
            }

        # ── LLM CALL ─────────────────────────────
        log_trace(trace_id, "LLM_CALL_START")
        start_llm = time.time()

        result = await build_response(query, None, trace_id)

        llm_latency = int((time.time() - start_llm) * 1000)
        log_trace(trace_id, "LLM_RESPONSE_RECEIVED")
        log_trace(trace_id, "LLM_LATENCY_MS", llm_latency)

        text = result.get("text", "")
        score = result.get("score", 0)
        tts_text = None
        audio = None
        
        log_trace(trace_id, "FINAL_RESPONSE_PREVIEW", text[:100])

        total_ms = int((time.time() - start_total) * 1000)
        log_trace(trace_id, "TOTAL_BACKEND_MS", total_ms)
        log_trace(trace_id, "RESPONSE_SENT")

        print("🚨 DEBUG TTS TEXT LENGTH:", len(tts_text) if tts_text else "None")
        print("🚨 DEBUG AUDIO VALUE:", "YES" if audio else "NO")
        print("🚨 DEBUG AUDIO TYPE:", type(audio))

        return {
            "status": "success",
            "message": text,
            "cleaned_query": None,
            "tts_text": None,
            "audio": audio,
            "score": score,
        }