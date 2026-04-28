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

from intervention_engine import get_intervention
from context_patterns import detect_context_pattern
from lever_mapping import CONTEXT_LEVERS, LEVER_ACTIONS, DEFAULT_LEVERS
from typing import Optional

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
DEBUG = os.getenv("DEBUG", "false").lower() == "true"

print("TRACE_LEVEL:", TRACE_LEVEL)
print("TRACE_TARGETS:", TRACE_TARGETS)
print("DEBUGE:", DEBUG)


def now_iso():
    return datetime.utcnow().isoformat() + "Z"


trace_id_var: ContextVar[str] = ContextVar("trace_id", default="unknown")


class TraceAccumulator:
    def __init__(self, trace_id: str):
        self.trace_id = trace_id
        self.steps: list = []

    def log(self, stage: str, data: dict):
        self.steps.append({"stage": stage, "ts": now_iso(), "data": data})

    def to_dict(self) -> dict:
        return {"trace_id": self.trace_id, "steps": self.steps}


trace_obj_var: ContextVar = ContextVar("trace_obj", default=None)


def _inject_trace(resp: dict) -> dict:
    if not DEBUG:
        return resp
    acc = trace_obj_var.get(None)
    if acc:
        resp["_trace"] = acc.to_dict()
    return resp


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
            "glycemia",
            "diabetes",
            "diabetic",
            "prediabetes",
            "prediabetic",
            "pre-diabetic",
            "pre diabetes",
        ],
        "medical": [
            "a1c",
            "hba1c",
            "hemoglobin a1c",
            "insulin",
            "glycemic",
            "hyperglycemia",
            "hypoglycemia",
            "hypo",
        ],
        "food": ["carb", "carbs", "dessert", "sweet", "juice", "soda"],
        "timing": [
            "fasting",
            "postprandial",
            "post-prandial",
            "after meal",
            "post meal",
        ],
    },
    "bp": {
        "primary": [
            "blood pressure",
            "bp",
            "pressure",
            "hypertension",
            "hypertensive",
            "hypotension",
        ],
        "medical": ["systolic", "diastolic", "pulse pressure"],
        "lifestyle": ["salt", "sodium"],
        "symptoms": ["dizziness", "headache"],
    },
    "cholesterol": {
        "primary": [
            "cholesterol",
            "chol",
            "ldl",
            "hdl",
            "lipid",
            "lipids",
            "triglyceride",
            "triglycerides",
            "tg",
        ],
        "medical": [
            "statin",
            "plaque",
            "lipid variability",
        ],
        "food": ["fat", "saturated", "saturated fat", "trans fat"],
    },
    "lifestyle": {
        "diet": ["diet", "food", "meal", "eat", "nutrition"],
        "activity": ["exercise", "workout", "walk", "steps"],
        "recovery": ["sleep", "stress", "meditation"],
        "body": ["weight", "fitness"],
        "habits": ["lifestyle", "habit", "routine"],
    },
}

# ---------------- CONTEXT MAP ----------------
CONTEXT_MAP = {
    "after_meal": [
        "after meal",
        "post meal",
        "after lunch",
        "after dinner",
        "after breakfast",
        "post lunch",
        "post dinner",
        "post breakfast",
        "after eating",
        "after food",
        "just ate",
        "had lunch",
        "had dinner",
        "had breakfast",
        "postprandial",
        "post-prandial",
    ],
    "high": [
        "high",
        "spike",
        "spikes",
        "surge",
        "surges",
        "up",
        "went up",
        "shot up",
        "elevated",
        "increase",
        "increased",
        "rising",
        "hyperglycemia",
        "hypertensive",
        "hypertension",
        "uncontrolled",
    ],
    "low": [
        "low",
        "drop",
        "drops",
        "dropped",
        "crash",
        "crashes",
        "dip",
        "dips",
        "valley",
        "valleys",
        "hypo",
        "hypoglycemia",
        "hypotension",
        "decrease",
        "decreased",
        "reduced",
    ],
    "unstable": [
        "fluctuating",
        "fluctuation",
        "variability",
        "volatile",
        "yo-yo",
        "yo yo",
        "yoyo",
        "swing",
        "swings",
        "labile",
        "erratic",
        "brittle",
        "unstable",
        "reactive",
        "reactivity",
        "paroxysmal",
    ],
}

STATE_MAP = {
    "prediabetic": ("glucose", "education"),
    "diabetic": ("glucose", "education"),
    "hyperglycemia": ("glucose", "intervention"),
    "hypoglycemia": ("glucose", "intervention"),
    "hypo": ("glucose", "intervention"),
    "hypertension": ("bp", "education"),
    "hypotension": ("bp", "intervention"),
    "high ldl": ("cholesterol", "intervention"),
    "low hdl": ("cholesterol", "intervention"),
}

ACTION_REGISTRY = {
    "walk_10min_now": {
        "display": "Take a 10-minute walk now",
        "keywords": ["walk", "10", "minute"],
        "priority": 1,
    },
    "avoid_simple_carbs_now": {
        "display": "Avoid simple carbs right now",
        "keywords": ["avoid", "carbs"],
        "priority": 1,
    },
    "add_protein_next_meal": {
        "display": "Add protein to your next meal",
        "keywords": ["protein", "meal"],
        "priority": 2,
    },
    "eat_earlier_today": {
        "display": "Eat earlier today",
        "keywords": ["eat", "earlier"],
        "priority": 2,
    },
    "do_breathing_5min": {
        "display": "Do 5 minutes of deep breathing",
        "keywords": ["breathing", "minutes"],
        "priority": 1,
    },
    "check_glucose_again": {
        "display": "Check your glucose again",
        "keywords": ["check", "glucose"],
        "priority": 1,
    },
}


def has_any(s: str, words: list) -> bool:
    return any(w in s for w in words)


def flatten_keyword_groups(groups: dict) -> list:
    words = []
    for values in groups.values():
        words.extend(values)
    return words


# ---------------- INTENT MAP ----------------
INTENT_MAP = {
    "question": [
        "what",
        "why",
        "how",
        "when",
        "where",
        "does",
        "do",
        "is",
        "are",
        "can",
        "should",
        "could",
        "would",
        "will",
    ],
    "guidance": [
        "how to",
        "ways to",
        "help me",
        "guide",
        "recommend",
        "suggest",
    ],
    "medication": [
        "statin",
        "metformin",
        "medicine",
        "medication",
        "drug",
    ],
}

# ---------------- LEVER KEYWORDS ----------------
LEVER_KEYWORDS = {
    "food": ["eat", "meal", "diet", "carbs", "carb", "fiber", "protein", "food"],
    "movement": ["walk", "exercise", "move", "movement", "activity", "active", "steps"],
    "timing": ["after", "before", "when", "timing", "fasting", "gap", "delay"],
    "recovery": ["stress", "sleep", "rest", "breathing", "relax"],
    "monitoring": ["check", "measure", "track", "monitor", "reading", "level"],
    "enhancers": ["vinegar", "cinnamon", "garlic", "turmeric"],
}

# ---------------- SUB-LEVER KEYWORDS ----------------
# IMPORTANT: Order = most specific → least specific
SUB_LEVER_KEYWORDS = {
    # --- FOOD (specific first) ---
    "pairing": [
        "pair carbs with",
        "carbs with nuts",
        "combine carbs with",
        "add nuts to carbs",
        "pairing",
    ],
    "fiber_first": [
        "fiber first",
        "eat fiber",
        "salad before",
        "chia",
        "flax",
        "fiber",
    ],
    "protein_first": [
        "protein first",
        "eat protein first",
        "egg first",
        "chicken first",
        "protein",
    ],
    "carb_control": ["reduce carbs", "low carb", "high carb", "carbs", "carb"],
    # --- MOVEMENT ---
    "post_meal_walk": [
        "walk after meal",
        "walk after meals",
        "after meal walk",
        "walk after eating",
        "after eating walk",
    ],
    "brisk_walk": ["brisk walk", "fast walk", "walk fast"],
    "light_activity": ["light activity", "gentle movement", "stretch", "move lightly"],
    # --- TIMING ---
    "delay_meal": [
        "delay next meal",
        "delay my next meal",  # ← ADD THIS
        "delay meal",
        "wait before eating",
        "postpone meal",
        "skip meal",
    ],
    "meal_spacing": [
        "gap between meals",
        "meal gap",
        "spacing between meals",
        "how long between meals",
    ],
    "early_dinner": [
        "early dinner",
        "eat dinner early",
        "dinner early",
        "when should i eat dinner",
        "dinner time",
    ],
    # --- RECOVERY ---
    "breathing": ["deep breathing", "breathing exercise", "deep breath", "breathing"],
    "sleep": ["sleep", "sleep quality"],
    "stress_control": ["stress", "anxiety", "anxious", "stress control"],
    # --- MONITORING ---
    "check_again": [
        "check again",
        "check sugar again",
        "recheck",
        "measure again",
        r"check.*again",
    ],
    "track_pattern": [
        "track glucose",
        "track pattern",
        "log glucose",
        "pattern",
        "track",
    ],
    "pre_post_compare": [
        "before and after meal",
        "pre and post meal",
        "compare before after",
        "compare",
    ],
    # --- ENHANCERS ---
    "vinegar": ["vinegar", "apple cider vinegar"],
    "cinnamon": ["cinnamon"],
}

# ---------------- SUB-LEVER → LEVER MAP ----------------
_SUB_LEVER_TO_LEVER = {
    "pairing": "food",
    "fiber_first": "food",
    "protein_first": "food",
    "carb_control": "food",
    "post_meal_walk": "movement",
    "brisk_walk": "movement",
    "light_activity": "movement",
    "delay_meal": "timing",
    "meal_spacing": "timing",
    "early_dinner": "timing",
    "breathing": "recovery",
    "sleep": "recovery",
    "stress_control": "recovery",
    "check_again": "monitoring",
    "track_pattern": "monitoring",
    "pre_post_compare": "monitoring",
    "vinegar": "enhancers",
    "cinnamon": "enhancers",
}

# ---------------- DOMAIN CONSTANTS ----------------
DOMAINS = {
    "GLUCOSE": "glucose",
    "BP": "bp",
    "CHOLESTEROL": "cholesterol",
    "LIFESTYLE": "lifestyle",
}


# ---------------- NORMALIZE ----------------
def normalize(q: str) -> str:
    t0 = trace_start("normalize")
    try:
        q = q.lower().strip()
        q = q.replace("-", " ")
        q = re.sub(r"\bbp\b", "blood pressure", q)
        q = re.sub(r"\bbg\b", "glucose", q)
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
        s = q.lower().strip()
        return {
            "after_meal": has_any(s, CONTEXT_MAP["after_meal"]),
            "high": has_any(s, CONTEXT_MAP["high"]),
            "low": has_any(s, CONTEXT_MAP["low"]),
            "unstable": has_any(s, CONTEXT_MAP["unstable"]),
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


# ---------------- SCORE ----------------
def compute_score(intent: str, q: str) -> int:
    t0 = trace_start("compute_score")
    try:
        score = 50

        if intent == "unknown":
            return 40

        if intent == DOMAINS["GLUCOSE"]:
            if any(x in q for x in ["fiber", "vegetable"]):
                score += 20
            if any(x in q for x in ["sugar", "dessert"]):
                score -= 20

        elif intent == DOMAINS["BP"]:
            if "salt" in q:
                score -= 15
            if any(x in q for x in ["walk", "exercise"]):
                score += 15

        elif intent == DOMAINS["CHOLESTEROL"]:
            if any(x in q for x in ["fiber", "oats"]):
                score += 20
            if "fat" in q:
                score -= 10

        elif intent == DOMAINS["LIFESTYLE"]:
            if any(x in q for x in ["exercise", "walk"]):
                score += 10
            if any(x in q for x in ["junk", "fried"]):
                score -= 10

        return max(0, min(score, 100))
    finally:
        trace_end("compute_score", t0)


# ---------------- INTENT ROUTING ----------------
def _compute_intent_flags(q: str) -> dict:
    s = q.lower().strip()
    first_word = s.split()[0].rstrip("?.,!") if s.split() else ""
    return {
        "guidance": has_any(s, INTENT_MAP["guidance"]),
        "question": (first_word in INTENT_MAP["question"]) or ("?" in q),
    }


def detect_sub_lever(q: str) -> Optional[str]:
    s = q.lower()
    for sub, phrases in SUB_LEVER_KEYWORDS.items():
        for phrase in phrases:
            if "*" in phrase:
                if re.search(phrase, s):
                    return sub
            elif phrase in s:
                return sub
    return None


def detect_lever(q: str, sub_lever: Optional[str]) -> str:
    if sub_lever:
        return _SUB_LEVER_TO_LEVER[sub_lever]
    s = q.lower()
    for lever, keywords in LEVER_KEYWORDS.items():
        if has_any(s, keywords):
            return lever
    return "lifestyle"  # safe fallback


def detect_condition(q: str) -> str:
    s = q.lower().strip()

    best_domain = None
    best_score = 0

    for domain, groups in KEYWORD_MAP.items():
        score = 0

        for group_name, group in groups.items():
            for kw in group:
                if re.search(rf"\b{re.escape(kw)}\b", s):
                    if group_name == "primary":
                        score += 3
                    elif group_name == "medical":
                        score += 2
                    else:
                        score += 1

        if score > best_score:
            best_score = score
            best_domain = domain

    # ✅ valid match
    if best_score >= 1 and best_domain:
        return best_domain

    # ✅ single-word fallback (safe)
    if len(s.split()) == 1:
        for domain, groups in KEYWORD_MAP.items():
            for group in groups.values():
                for kw in group:
                    if s == kw:
                        return domain

    # ✅ never return None
    return DOMAINS["LIFESTYLE"]


def classify_need(context: dict) -> str:
    if context.get("high") or context.get("low") or context.get("unstable"):
        return "intervention"
    return "education"


HEALTH_DOMAINS = {DOMAINS["GLUCOSE"], DOMAINS["BP"], DOMAINS["CHOLESTEROL"]}


def detect_need_v2(q: str, context: dict, intent: dict, domain: str) -> str:
    """
    Pure decision layer: depends only on intent flags, context signals, and domain.
    No keyword lists. Replaces detect_need once validated.
    intent must contain: {"question": bool, "guidance": bool}
    """
    if intent.get("guidance"):
        return "guidance"

    if intent.get("question"):
        return "education"

    if domain in HEALTH_DOMAINS and (
        context.get("high") or context.get("low") or context.get("unstable")
    ):
        return "intervention"

    return "education"


def detect_intervention(need: str) -> list:
    if need == "prevention":
        return ["nutrition", "exercise"]
    return [need]


def map_tool(need: str, lite: bool) -> str:
    return "llm_lite" if lite else "llm_full"


def build_intent(q: str, lite: bool, context: dict) -> dict:
    domain = detect_condition(q)
    flags = _compute_intent_flags(q)
    need = detect_need_v2(q, context, flags, domain)

    sub_lever = detect_sub_lever(q)
    lever = detect_lever(q, sub_lever)

    # 🔥 FIX 1: fallback lever from keywords
    if lever is None:
        lever = fallback_lever_from_query(q)

    # 🔥 FIX 2: default to lifestyle (never None)
    if lever is None:
        lever = "lifestyle"

    # 🔥 HARD GUARANTEES
    if domain not in DOMAINS.values():
        domain = DOMAINS["LIFESTYLE"]

    if need not in ["education", "guidance", "intervention"]:
        need = "education"

    return {
        "domain": domain,
        "need": need,
        "lever": lever,
        "sub_lever": sub_lever,
        "intervention": detect_intervention(need),
        "tool": map_tool(need, lite),
    }


def fallback_lever_from_query(q: str) -> str:
    q = q.lower()

    if any(x in q for x in ["fiber", "fibre", "protein", "carb", "fat", "eat"]):
        return "food"

    if any(x in q for x in ["walk", "exercise", "movement", "steps"]):
        return "movement"

    if any(x in q for x in ["meal", "dinner", "fasting", "gap", "timing"]):
        return "timing"

    if any(x in q for x in ["stress", "sleep", "breathing", "recovery"]):
        return "recovery"

    if any(x in q for x in ["check", "track", "monitor", "pattern"]):
        return "monitoring"

    if any(x in q for x in ["vinegar", "cinnamon", "supplement"]):
        return "enhancers"

    return None


def is_meaningful_query(q: str, domain: str, need: str) -> bool:
    # ✅ If we understood intent → it's meaningful
    if domain != DOMAINS["LIFESTYLE"]:
        return True

    if need != "unknown":
        return True

    # fallback: reject obvious junk only
    words = q.strip().split()
    return len(words) >= 2


def unclear_query_response() -> dict:
    return {
        "text": "Please ask a clear question like 'How do I reduce blood sugar after meals?'",
        "score": 0,
        "intent": {"domain": "lifestyle", "need": "education"},
    }


# ---------------- MOCK ----------------
def mock_response(intent: str) -> str:
    if intent == DOMAINS["GLUCOSE"]:
        return """## Insight
Glucose spike likely due to high carbs without fiber or a post-meal activity gap.

## Expected Outcome
Steady glucose within 1–2 hours with movement and fiber-led meals."""

    if intent == DOMAINS["BP"]:
        return """## Insight
Elevated blood pressure is often driven by sodium intake, stress, or low activity.

## Expected Outcome
Readings improve with consistent movement, lower salt, and stress reduction."""

    if intent == DOMAINS["CHOLESTEROL"]:
        return """## Insight
Cholesterol imbalance is commonly linked to low soluble fiber and saturated fat intake.

## Expected Outcome
LDL levels improve with consistent fiber, healthy fats, and regular activity."""

    if intent == DOMAINS["LIFESTYLE"]:
        return """## Insight
Lifestyle habits may not be aligned with your current health goals.

## Expected Outcome
One consistent habit change — meals, movement, or sleep — creates measurable progress."""

    return """## Insight
I can help with lifestyle, glucose, BP, and cholesterol.

## Next Step
Try asking about food, exercise, or health markers."""


# ---------------- PROMPT ----------------
def build_prompt(q: str, ctx: dict) -> str:
    t0 = trace_start("build_prompt")
    try:
        result = f"""
You are a lifestyle health assistant. Your ONLY job is to explain the situation — actions are handled separately by the system and will be shown to the user automatically.

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
- Explain the situation and expected outcome ONLY
- DO NOT list actions, bullets, or tell the user what to do — that is shown separately
- DO NOT use "Do this now", "What To Do", or any action bullets
- Use simple everyday language
- Do NOT assume user condition unless explicitly stated
- Avoid clinical numbers (no grams, mg, frequencies)
- Keep response readable in under 5 seconds
- No Meal Score section, No Try This Week section
- Avoid filler words (consider, try to, aim to)
- Start Insight with direct cause (no explanation)
- Do NOT use words like: important, helpful, beneficial
- Keep Insight under 10 words if possible

Respond ONLY in this exact format:

## Insight
1–2 short lines summarizing the key issue or context.

## Expected Outcome
One short line on what improves.

Rules:
- No What To Do section
- No bullet points for actions
- No numbered lists
- No long paragraphs
"""
        return result
    finally:
        trace_end("build_prompt", t0)


# ---------------- LITE PROMPT ----------------
def build_lite_prompt(q: str, context_name: str = None, top_action: str = None) -> str:
    t0 = trace_start("build_lite_prompt")
    try:
        if context_name == "behavior_gap":
            action_line = f'The one action to take right now: {top_action}.' if top_action else ""
            result = f"""
You are a decisive health coach speaking to someone who knows what to do but is not doing it.

User said:
"{q}"

{action_line}

Respond in EXACTLY 1–2 sentences.

Rules:
- Be direct, not gentle
- State the action explicitly — do not suggest or imply it
- No soft language: no "try", "start by", "consider", "you might want to"
- No explanation of why — just what to do and a short sharp reason
- No headings, no bullets, no markdown
- End the response after the second sentence

Example tone:
"Take a 10-minute walk right now — your body clears sugar fastest with movement. That's your one move."
"""
            return result

        result = f"""
You are a calm, practical health coach. Your ONLY job is to explain the situation in plain language — actions are shown separately to the user by the system.

User asked:
"{q}"

Respond in EXACTLY 2–3 short sentences explaining the situation.

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


# ---------------- LITE ENFORCEMENT ----------------
def strip_actions_from_text(text: str) -> str:
    """Remove bullet lines, numbered action lists, and 'Do this now' blocks."""
    # Remove "Do this now:" and everything after it
    text = re.sub(r'Do this now:.*', '', text, flags=re.IGNORECASE | re.DOTALL)
    # Remove bullet lines (•, -, *) at start of any line
    text = re.sub(r'^\s*[-•*]\s+', '', text, flags=re.MULTILINE)
    # Remove bullet lines (•, -, *) after a newline (belt-and-suspenders)
    text = re.sub(r'(?:^|\n)\s*[-•*]\s+[^\n]*', '', text, flags=re.MULTILINE)
    # Remove numbered list lines (1. 2. 3.)
    text = re.sub(r'(?:^|\n)\s*\d+\.\s+[^\n]*', '', text, flags=re.MULTILINE)
    # Collapse excess blank lines
    text = re.sub(r'\n{2,}', '\n', text)
    return text.strip()


def limit_sentences(text: str, max_sentences: int = 3) -> str:
    """Cap text to max_sentences by splitting on sentence-ending punctuation."""
    sentences = re.split(r'(?<=[.!?]) +', text.strip())
    return ' '.join(sentences[:max_sentences]).strip()


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

        # Rule 2: No structured formatting or action content
        forbidden = ["##", "* ", "\n- ", "\n1)", "\n2)", "\n3)", "• ", "Do this now"]
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
def llm_response(q: str, ctx: dict, lite: bool, context_name: str = None, top_action: str = None) -> str:
    t0_func = trace_start("llm_response")
    try:
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] RAW QUERY:", q)
        if is_meal_sentence(q):
            q = clean_meal_text(q)
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] CLEANED QUERY:", q)

        if lite:
            prompt = build_lite_prompt(q, context_name=context_name, top_action=top_action)

            if TRACE_LEVEL >= 2:
                print(f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] → call_llm")
            t0 = time.time()
            text = call_llm(prompt)
            if TRACE_LEVEL >= 2:
                print(
                    f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] ← call_llm {(time.time()-t0)*1000:.0f}ms"
                )

            # Deterministic enforcement — strip actions regardless of LLM output
            text = strip_actions_from_text(text)
            text = limit_sentences(text, max_sentences=3)

            is_valid, reason = validate_lite_response(text)

            if is_valid:
                return text

            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] VALIDATION FAILED:", reason)

            retry_prompt = (
                prompt
                + "\n\nRewrite the answer simpler, shorter, and more conversational. No bullets or lists."
            )
            if TRACE_LEVEL >= 2:
                print(f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] → call_llm retry")
            t0 = time.time()
            text_retry = call_llm(retry_prompt)
            if TRACE_LEVEL >= 2:
                print(
                    f"[{now_iso()}][BE][LLM][{trace_id_var.get()}] ← call_llm retry {(time.time()-t0)*1000:.0f}ms"
                )

            # Enforce on retry too
            text_retry = strip_actions_from_text(text_retry)
            text_retry = limit_sentences(text_retry, max_sentences=3)

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
        if "## Insight" in text and "## Expected Outcome" in text:
            return text

        return f"""## Insight
{text}

## Expected Outcome
Try rephrasing your question for more specific guidance.
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
        "intent": {"domain": "lifestyle", "need": "education"},
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
        "intent": {"domain": "lifestyle", "need": "education"},
        "score": 50,
    }


# ---------------- STRUCTURED RESPONSE ----------------

# Maps each intervention action ID to its lever category
_ACTION_LEVER = {
    "walk_10min_now": "movement",
    "take_a_10min_walk": "movement",
    "take_a_brisk_walk": "movement",
    "walk_after_meals": "movement",
    "walk_30min_daily": "movement",
    "consistent_activity": "movement",
    "consistent_light_activity": "movement",
    "light_resistance_training": "movement",
    "avoid_heavy_lifting": "movement",
    "light_movement": "movement",
    "regular_exercise": "movement",
    "drink_water_now": "recovery",
    "slow_deep_breathing": "recovery",
    "sit_and_rest_now": "recovery",
    "sit_quietly_5min": "recovery",
    "avoid_stimulants": "recovery",
    "stress_management": "recovery",
    "manage_stress": "recovery",
    "fiber_first": "food",
    "next_meal_add_protein_and_fiber": "food",
    "avoid_simple_carbs_now": "food",
    "reduce_refined_carbs": "food",
    "reduce_sodium_now": "food",
    "reduce_sodium": "food",
    "reduce_salt_today": "food",
    "potassium_rich_foods": "food",
    "avoid_processed_food": "food",
    "avoid_saturated_fat_today": "food",
    "add_soluble_fiber_to_meal": "food",
    "soluble_fiber_daily": "food",
    "limit_saturated_fat": "food",
    "oats_daily": "food",
    "healthy_fats": "food",
    "increase_vegetables": "food",
    "low_gi_foods": "food",
    "balanced_plate": "food",
    "balanced_diet": "food",
    "fiber_protein_meal": "food",
    "reduce_simple_carbs": "food",
    "whole_foods": "food",
    "portion_control": "food",
    "next_meal_add_protein_and_fiber": "food",
    "avoid_heavy_food_now": "food",
    "check_your_last_meal": "monitoring",
    "check_bp_in_30min": "monitoring",
    "check_bp_again_in_30min": "monitoring",
    "track_bg_pattern": "monitoring",
    "track_bp_daily": "monitoring",
    "track_cgm_patterns": "monitoring",
    "correlate_with_meals": "monitoring",
    "share_with_doctor": "monitoring",
    "track_lipids": "monitoring",
    "track_response": "monitoring",
    "pre_post_compare": "monitoring",
    "understand_glucose_spikes": "education",
    "learn_glycemic_index": "education",
    "understand_bp_range": "education",
    "identify_triggers": "education",
    "understand_ldl_hdl": "education",
    "lifestyle_vs_medication": "education",
    "understand_condition": "education",
    "track_metrics": "education",
    "lifestyle_focus": "education",
    "consult_doctor": "education",
    "lifestyle_alongside_medication": "education",
    "light_activity": "movement",
    "light_stretching": "movement",
    "consistent_movement": "movement",
    "regular_activity": "movement",
    # lever_mapping.py action IDs
    "eat_earlier_dinner": "timing",
    "allow_meal_gap": "timing",
    "delay_next_meal": "timing",
    "check_again_in_30min": "monitoring",
    "check_glucose_again": "monitoring",
    "pre_post_meal_compare": "monitoring",
    "add_vinegar_to_meal": "enhancers",
    "add_cinnamon_to_diet": "enhancers",
    "add_garlic_daily": "enhancers",
    "add_protein_next_meal": "food",
    "do_breathing_5min": "recovery",
    # fiber lever action IDs
    "add_fiber_before_meal": "fiber",
    "fiber_first": "fiber",
    "eat_vegetables_first": "fiber",
    # protein lever action IDs
    "eat_protein_first": "protein",
    "choose_high_protein": "protein",
    # lever_mapping.py movement extras
    "sit_and_rest_now": "recovery",
    "track_bg_pattern": "monitoring",
}


def build_structured_response(intent: dict, ctx: dict) -> dict:
    """Deterministic: intent + ctx → top 3 actions (each from a different lever)."""
    domain = intent.get("domain", "lifestyle")
    need = intent.get("need", "education")
    lever = intent.get("lever", "food")
    sub_lever = intent.get("sub_lever")
    context_name = intent.get("context_name")

    # ── Context-driven path ────────────────────────────────────────────────
    ordered_levers = (
        CONTEXT_LEVERS[context_name]
        if context_name and context_name in CONTEXT_LEVERS
        else DEFAULT_LEVERS
    )
    top_actions: list = []
    levers_used: list = []
    for lv in ordered_levers:
        if lv in LEVER_ACTIONS and lv not in levers_used:
            levers_used.append(lv)
            top_actions.append(LEVER_ACTIONS[lv][0])
        if len(top_actions) == 3:
            break

    # ── Supplement from intervention engine if context gave fewer than 3 ──
    if len(top_actions) < 3:
        interventions = intent.get("interventions", [])
        seen_set = set(levers_used)
        for action in interventions:
            action_lever = _ACTION_LEVER.get(action, lever)
            if action_lever == "education":
                continue
            if action_lever not in seen_set and action not in top_actions:
                seen_set.add(action_lever)
                levers_used.append(action_lever)
                top_actions.append(action)
            if len(top_actions) == 3:
                break

    # Lite mode: single high-impact action to reduce cognitive load
    if intent.get("tool") == "llm_lite":
        top_actions = top_actions[:1]
        levers_used = levers_used[:1]

    return {
        "domain": domain,
        "need": need,
        "lever": lever,
        "sub_lever": sub_lever,
        "context_name": context_name,
        "top_actions": top_actions,
        "levers": levers_used,
        "context": ctx,
    }


def format_chat_response(structured: dict, llm_text: str) -> str:
    """LLM output is the chat response; structured actions are the source of truth."""
    return llm_text


def _action_label(action_id: str) -> str:
    """Human-readable label for an action ID, using ACTION_REGISTRY when available."""
    meta = ACTION_REGISTRY.get(action_id)
    if meta:
        return meta["display"]
    return action_id.replace("_", " ").title()


def format_screen_response(structured: dict) -> dict:
    """JSON payload for screen UI rendering."""
    domain = structured["domain"]
    titles = {
        "glucose": "Glucose Control",
        "bp": "Blood Pressure",
        "cholesterol": "Cholesterol",
        "lifestyle": "Lifestyle",
    }
    top_actions = structured["top_actions"]
    return {
        "title": titles.get(domain, "Health"),
        "domain": domain,
        "need": structured["need"],
        "lever": structured["lever"],
        "sub_lever": structured["sub_lever"],
        "top_actions": top_actions,
        "top_action_labels": [_action_label(a) for a in top_actions],
        "levers": structured["levers"],
        "context": {
            "after_meal": structured["context"].get("after_meal", False),
            "high": structured["context"].get("high", False),
            "low": structured["context"].get("low", False),
            "unstable": structured["context"].get("unstable", False),
        },
    }


def normalize_action(a: str) -> str:
    return a.lower().replace("_", " ")


def enforce_actions_in_text(text: str, actions: list[str]) -> str:
    text_lower = text.lower()
    missing = []

    for action_id in actions:
        meta = ACTION_REGISTRY.get(action_id, {})
        keywords = meta.get("keywords", [])

        if not any(k in text_lower for k in keywords):
            missing.append(action_id)

    if not missing:
        return text

    forced_block = "\n\nDo this now:\n"

    for action_id in missing:
        meta = ACTION_REGISTRY.get(action_id)
        display = meta["display"] if meta else action_id.replace("_", " ")
        forced_block += f"- {display}\n"

    return text + forced_block


def _enriched_response(text: str, score: int, intent: dict, ctx: dict) -> dict:
    """Attach structured + chat + screen to every response dict."""
    structured = build_structured_response(intent, ctx)
    return {
        "text": text,
        "chat": format_chat_response(structured, text),
        "screen": format_screen_response(structured),
        "structured": structured,
        "score": score,
        "intent": intent,
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

        # pairing fast-path
        if is_pairing_query(q):
            return {
                **build_pairing_response(q),
                "score": 50,
                "intent": {
                    "domain": DOMAINS["LIFESTYLE"],
                    "need": "education",
                    "tool": "llm_lite",
                },
            }

        # ✅ normalization for matching
        q_norm = q.lower().replace("-", " ")

        # ✅ STATE SYNONYMS (real-world language)
        STATE_SYNONYMS = {
            "prediabetes": "prediabetic",
            "diabetes": "diabetic",
            "high sugar": "hyperglycemia",
            "low sugar": "hypoglycemia",
        }

        for k, v in STATE_SYNONYMS.items():
            if k in q_norm:
                q_norm = q_norm.replace(k, v)

        tokens = set(q_norm.split())
        ctx = detect_context(q)

        # PRIMARY context source — locked here, never overwritten downstream
        ctx_pattern = detect_context_pattern(q)
        context_name = ctx_pattern.get("context")  # None if no pattern matched
        if TRACE_LEVEL >= 1 and ctx_pattern:
            print(f"[{now_iso()}][{trace_id_var.get()}] CTX_PATTERN:", ctx_pattern)

        # ✅ STATE DETECTION
        state_hit = None
        for key in STATE_MAP:
            key_tokens = set(key.split())
            if key_tokens.issubset(tokens):
                state_hit = STATE_MAP[key]
                break

        # ✅ INTENT BUILD
        if state_hit:
            domain, need = state_hit
            intent = {
                "domain": domain,
                "need": need,
                "tool": "llm_lite" if lite else "llm_full",
                "source": "state_map",
            }
            confidence = 0.95
        else:
            intent = build_intent(q, lite, ctx)
            domain = intent.get("domain")
            need = intent.get("need")

            # ✅ basic confidence scoring
            if len(tokens) <= 2:
                confidence = 0.6
            elif "?" in q:
                confidence = 0.9
            else:
                confidence = 0.8

            # boost for identified health domain — short queries like "sugar crash" are valid
            if domain in HEALTH_DOMAINS:
                confidence = max(confidence, 0.8)

        # ✅ Domain override — only when classifier fell back to lifestyle
        if ctx_pattern.get("domain") and domain == DOMAINS["LIFESTYLE"]:
            domain = ctx_pattern["domain"]
            intent["domain"] = domain

        # Lock context_name — single assignment, never modified after this point
        intent["context_name"] = context_name

        # ── Behavior gap override: user knows but isn't acting → force intervention ──
        if re.search(r"\b(i know|should).*(but i (don'?t|do not))\b", q, re.I):
            intent["need"] = "intervention"
            intent["context_name"] = "behavior_gap"
            context_name = "behavior_gap"
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] BEHAVIOR_GAP detected → need=intervention context=behavior_gap")

        # ✅ FALLBACK SAFETY
        if not domain or not need:
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] INTENT_FALLBACK → unclear")
            return unclear_query_response()

        # ✅ LOW CONFIDENCE → clarify (not reject)
        if confidence < 0.7:
            if TRACE_LEVEL >= 1:
                print(
                    f"[{now_iso()}][{trace_id_var.get()}] LOW_CONFIDENCE: {q!r} conf={confidence:.2f}"
                )
            return {
                "text": "Do you want to understand this or improve it?",
                "score": 0,
                "intent": intent,
            }

        # ✅ MEANINGFUL CHECK
        if not is_meaningful_query(q, domain, need):
            if TRACE_LEVEL >= 1:
                print(f"[{now_iso()}][{trace_id_var.get()}] UNCLEAR_QUERY: {q}")
            return {
                "text": "Can you clarify what you want to know? (understand / manage / foods / numbers)",
                "score": 0,
                "intent": intent,
            }

        condition_key = domain
        q_lower = q.lower().strip()

        # context label
        if "after" in q_lower and any(
            x in q_lower for x in ["lunch", "dinner", "breakfast", "meal"]
        ):
            context_label = "post_meal"
        elif any(x in q_lower for x in ["fasting", "morning"]):
            context_label = "fasting"
        elif any(x in q_lower for x in ["high", "190", "180", "200"]):
            context_label = "high_reading"
        else:
            context_label = "general"

        # Trace mismatch: pattern context vs keyword classifier (classify is secondary)
        if context_name and context_name != context_label and TRACE_LEVEL >= 1:
            print(
                f"[{now_iso()}][{trace_id_var.get()}] CONTEXT_MISMATCH: detected={context_name!r} classify={context_label!r}"
            )

        if TRACE_LEVEL >= 1:
            print(
                f"[{now_iso()}][{trace_id_var.get()}] CLASSIFY: domain={domain} need={need} context={context_name or context_label}"
            )

        # Deterministic interventions — pattern context wins over legacy engine
        if context_name and context_name in CONTEXT_LEVERS:
            interventions = [
                LEVER_ACTIONS[lv][0]
                for lv in CONTEXT_LEVERS[context_name]
                if lv in LEVER_ACTIONS
            ][:3]
        else:
            interventions = get_intervention(domain, need, ctx)
        intent["interventions"] = interventions
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] INTERVENTIONS:", interventions)

        score = compute_score(condition_key, q)

        _exec_path = (
            "scroll_test"
            if SCROLL_TEST
            else "mock" if USE_MOCK else "llm" if USE_LLM else "fallback"
        )

        _acc = trace_obj_var.get(None)
        if _acc:
            _acc.log(
                "lever_select",
                {"path": _exec_path, "tool": intent.get("tool", "llm_full")},
            )

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] SCORE:", score)
            print(f"[{now_iso()}][{trace_id_var.get()}] QUERY:", q)
            print(f"[{now_iso()}][{trace_id_var.get()}] INTENT:", intent)

        # SCROLL TEST
        if SCROLL_TEST:
            return _enriched_response(scroll_test_response(), score, intent, ctx)

        # MOCK
        if USE_MOCK:
            _health = (DOMAINS["GLUCOSE"], DOMAINS["BP"], DOMAINS["CHOLESTEROL"])
            mock_key = (
                condition_key if condition_key in _health else DOMAINS["LIFESTYLE"]
            )
            return _enriched_response(mock_response(mock_key), score, intent, ctx)

        # LLM
        if USE_LLM:
            use_lite = intent.get("tool") == "llm_lite"

            if TRACE_LEVEL >= 1:
                print(
                    f"[{now_iso()}][{trace_id_var.get()}] LLM_MODE: {'lite' if use_lite else 'full'}"
                    f" context_name={context_name!r} interventions={interventions}"
                )

            top_action_label = _action_label(interventions[0]) if interventions else None

            try:
                result = await asyncio.wait_for(
                    asyncio.to_thread(llm_response, q, ctx, use_lite, context_name, top_action_label),
                    timeout=15,
                )
                text = result if use_lite else enforce_format(result)
                return _enriched_response(text, score, intent, ctx)

            except asyncio.TimeoutError:
                return _enriched_response(
                    "LLM timed out. Try again.", score, intent, ctx
                )

            except Exception as e:
                mock_key = (
                    condition_key
                    if condition_key
                    in (DOMAINS["GLUCOSE"], DOMAINS["BP"], DOMAINS["CHOLESTEROL"])
                    else DOMAINS["LIFESTYLE"]
                )
                resp = _enriched_response(mock_response(mock_key), score, intent, ctx)
                resp["error"] = str(e)
                return resp

        # fallback
        return _enriched_response(
            """## Insight
Ask about glucose, blood pressure, cholesterol, or lifestyle habits.

## Expected Outcome
You'll receive a clear explanation and specific actions to take.""",
            score,
            intent,
            ctx,
        )

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
            "intent": {"domain": DOMAINS["LIFESTYLE"], "need": "education"},
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

    if DEBUG:
        _acc = TraceAccumulator(trace_id)
        trace_obj_var.set(_acc)
        _acc.log("api_entry", {"content_type": content_type.split(";")[0].strip()})

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
            return _inject_trace(
                {
                    "status": "error",
                    "message": "Could not understand. Please try again.",
                    "cleaned_query": "",
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

        audio_bytes = await audio_file.read()
        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] --- VOICE REQUEST ---")
        if TRACE_LEVEL >= 1:
            print(
                f"[{now_iso()}][{trace_id_var.get()}] File: {audio_file.filename}, Size: {len(audio_bytes)} bytes"
            )

        if len(audio_bytes) == 0:
            return _inject_trace(
                {
                    "status": "error",
                    "message": "Could not understand. Please try again.",
                    "cleaned_query": "",
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

        if len(audio_bytes) > 25 * 1024 * 1024:
            return _inject_trace(
                {
                    "status": "error",
                    "message": "Audio file too large.",
                    "cleaned_query": "",
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

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
            return _inject_trace(
                {
                    "status": "error",
                    "message": "Could not understand. Please try again.",
                    "cleaned_query": "",
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

        if TRACE_LEVEL >= 1:
            print(f"[{now_iso()}][{trace_id_var.get()}] WHISPER RAW:", raw_transcript)

        error_msg, cleaned_query = validate_voice_query(raw_transcript)

        if error_msg:
            if TRACE_LEVEL >= 1:
                print(
                    f"[{now_iso()}][{trace_id_var.get()}] VALIDATION FAILED:", error_msg
                )
            return _inject_trace(
                {
                    "status": "error",
                    "message": error_msg,
                    "cleaned_query": cleaned_query,
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

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

        return _inject_trace(
            {
                "status": "success",
                "message": text,
                "cleaned_query": cleaned_query,
                "tts_text": tts_text if audio else None,
                "audio": audio,
                "score": score,
            }
        )

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
            return _inject_trace(
                {
                    "status": "error",
                    "message": "Please enter a question.",
                    "cleaned_query": None,
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

        if len(query) > 500:
            return _inject_trace(
                {
                    "status": "error",
                    "message": "Query too long.",
                    "cleaned_query": None,
                    "tts_text": None,
                    "audio": None,
                    "score": 0,
                }
            )

        # Allow valid single-word health terms like "prediabetic", "diabetes", "ldl", "hdl", "bp"
        if len(query.split()) <= 1:
            q_check = normalize(correct_spelling(query)).lower().strip()

            single_word_allowed = False

            # Check STATE_MAP
            if q_check in STATE_MAP:
                single_word_allowed = True

            # Check KEYWORD_MAP
            for domain, groups in KEYWORD_MAP.items():
                for group in groups.values():
                    if q_check in group:
                        single_word_allowed = True
                        break
                if single_word_allowed:
                    break

            if not single_word_allowed:
                return _inject_trace(
                    {
                        "status": "success",
                        "message": "Please say a full sentence like 'my sugar is high after meal'",
                        "cleaned_query": None,
                        "tts_text": None,
                        "audio": None,
                        "score": 0,
                    }
                )

        try:
            result = await build_response(query, lite)
        except Exception as e:
            print(f"[FATAL][{trace_id_var.get()}] {str(e)}")
            raise

        text = result.get("text", "")
        score = result.get("score", 0)

        duration_ms = (time.time() - start) * 1000
        if TRACE_LEVEL >= 2:
            print(f"[{now_iso()}][BE][API][{trace_id}] ← /query {duration_ms:.0f}ms")

        # audio is always null for keyboard — spec constraint
        intent = result.get("intent")

        if not isinstance(intent, dict):
            print(f"[WARN] Invalid intent structure: {intent}")
            intent = {
                "domain": "lifestyle",
                "need": "education",
                "lever": None,
                "sub_lever": None,
            }

        return _inject_trace(
            {
                "status": "success",
                # ✅ SINGLE SOURCE OF TRUTH
                "text": text,
                "chat": result.get("chat", text),
                # ❌ REMOVE "message" (or keep temporarily for backward compatibility)
                # "message": text,
                "cleaned_query": None,
                "tts_text": None,
                "audio": None,
                "score": score,
                "domain": intent.get("domain"),
                "need": intent.get("need"),
                "lever": intent.get("lever"),
                "sub_lever": intent.get("sub_lever"),
                "intent": intent,
                # unified pipeline outputs
                "screen": result.get("screen", {}),
                "structured": result.get("structured", {}),
            }
        )
