from fastapi import FastAPI, Request, UploadFile, File
from openai import OpenAI
import io
import re
import os
import time
import asyncio
import base64
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
    "phenotype": "post-meal spiker"
}


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
        top = max(scores, key=scores.get)
        return top

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


# ---------------- MAIN ----------------
async def build_response(query: str):
    if not query:
        return {"text": "Empty query", "score": 0}

    q = normalize(query)
    ctx = detect_context(q)
    intent = detect_intent(q)

    print("\n--- REQUEST ---")
    print("QUERY:", q)
    print("INTENT:", intent)

    score = compute_score(intent, q)
    print("SCORE:", score)

    if SCROLL_TEST:
        print("🔥 SCROLL TEST MODE")
        return {"text": scroll_test_response(), "score": score}

    if USE_MOCK:
        return {"text": mock_response(intent), "score": score}

    if USE_LLM:
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(llm_response, q, ctx),
                timeout=15
            )
            return {"text": enforce_format(result), "score": score}

        except asyncio.TimeoutError:
            print("LLM TIMEOUT")
            return {"text": "LLM timed out. Try again.", "score": score}

        except Exception as e:
            print("LLM ERROR:", e)
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


# ---------------- API ----------------
@app.post("/query")
async def handle_query(request: Request):
    start = time.time()

    data = await request.json()
    query = (data.get("query") or "").strip()

    if len(query.split()) <= 1:
        return {
            "status": "success",
            "message": "Please say a full sentence like 'my sugar is high after meal'",
            "score": 0,
            "audio": None,
            "error": None,
        }

    if len(query) > 500:
        return {
            "status": "success",
            "message": "Query too long",
            "score": 0,
            "audio": None,
            "error": None,
        }

    result = await build_response(query)

    text = result.get("text", "")
    audio = generate_tts(text)

    response = {
        "status": "success",
        "message": text,
        "score": result.get("score"),
        "audio": audio,
        "error": result.get("error"),
    }

    print("⏱️", round(time.time() - start, 2), "sec\n")
    return response


@app.post("/transcribe")
async def transcribe(file: UploadFile = File(...)):
    try:
        print("Received file:", file.filename)
        print("Content-Type:", file.content_type)

        audio_bytes = await file.read()
        print("Audio size (bytes):", len(audio_bytes))

        if len(audio_bytes) == 0:
            return {"text": "Empty audio received"}

        if len(audio_bytes) > 10 * 1024 * 1024:
            return {"text": "Audio too large"}

        audio_file = io.BytesIO(audio_bytes)

        filename = (file.filename or "").lower()
        ext = "caf" if filename.endswith(".caf") else "m4a"
        audio_file.name = file.filename or f"audio.{ext}"

        transcript = await asyncio.wait_for(
            asyncio.to_thread(
                lambda: client.audio.transcriptions.create(
                    model="gpt-4o-mini-transcribe",
                    file=audio_file
                )
            ),
            timeout=15
        )

        print("TRANSCRIPT:", transcript.text)

        return {"text": transcript.text}

    except Exception as e:
        print("TRANSCRIBE ERROR:", e)
        return {
            "text": "Transcription failed",
            "error": str(e)
        }