import csv
import re
import requests
import os
from typing import List, Optional, Tuple
import time
import functools
from services.usda_service import search_usda, get_usda_food_details
from services.usda_service import call_usda
from services.usda_service import resolve_usda


SEED_FOOD_ITEMS = [
    {
        "name": "Pizza",
        "carbs_g": 30,
        "protein_g": 11,
        "fat_g": 10,
        "sat_fat_g": 5,
        "fiber_g": 2,
        "calories": 266,
    },
    {
        "name": "Rice",
        "carbs_g": 28,
        "protein_g": 2.7,
        "fat_g": 0.3,
        "sat_fat_g": 0.1,
        "fiber_g": 0.4,
        "calories": 130,
    },
    {
        "name": "Chicken",
        "carbs_g": 0,
        "protein_g": 27,
        "fat_g": 3.6,
        "sat_fat_g": 1,
        "fiber_g": 0,
        "calories": 165,
    },
    {
        "name": "Salad",
        "carbs_g": 3.5,
        "protein_g": 1.5,
        "fat_g": 0.2,
        "sat_fat_g": 0,
        "fiber_g": 2,
        "calories": 20,
    },
    {
        "name": "Burger",
        "carbs_g": 24,
        "protein_g": 17,
        "fat_g": 14,
        "sat_fat_g": 5,
        "fiber_g": 1,
        "calories": 295,
    },
    {
        "name": "Banana",
        "carbs_g": 23,
        "protein_g": 1.1,
        "fat_g": 0.3,
        "sat_fat_g": 0.1,
        "fiber_g": 2.6,
        "calories": 89,
    },
    {
        "name": "Apple",
        "carbs_g": 14,
        "protein_g": 0.3,
        "fat_g": 0.2,
        "sat_fat_g": 0,
        "fiber_g": 2.4,
        "calories": 52,
    },
    {
        "name": "Bread",
        "carbs_g": 13,
        "protein_g": 2.7,
        "fat_g": 1,
        "sat_fat_g": 0.2,
        "fiber_g": 0.6,
        "calories": 79,
    },
    {
        "name": "Egg",
        "carbs_g": 0.6,
        "protein_g": 6,
        "fat_g": 5,
        "sat_fat_g": 1.6,
        "fiber_g": 0,
        "calories": 68,
    },
    {
        "name": "Yogurt",
        "carbs_g": 3.6,
        "protein_g": 10,
        "fat_g": 0.4,
        "sat_fat_g": 0.1,
        "fiber_g": 0,
        "calories": 59,
    },
    {
        "name": "Pasta",
        "carbs_g": 25,
        "protein_g": 5,
        "fat_g": 1,
        "sat_fat_g": 0.2,
        "fiber_g": 1.8,
        "calories": 131,
    },
    {
        "name": "Oatmeal",
        "carbs_g": 27,
        "protein_g": 5,
        "fat_g": 3,
        "sat_fat_g": 0.5,
        "fiber_g": 4,
        "calories": 158,
    },
    {
        "name": "Butter",
        "carbs_g": 0,
        "protein_g": 0.1,
        "fat_g": 81,
        "sat_fat_g": 51,
        "fiber_g": 0,
        "calories": 717,
    },
    {
        "name": "Cheese",
        "carbs_g": 1.3,
        "protein_g": 25,
        "fat_g": 33,
        "sat_fat_g": 21,
        "fiber_g": 0,
        "calories": 402,
    },
    {
        "name": "Milk",
        "carbs_g": 4.8,
        "protein_g": 3.4,
        "fat_g": 3.3,
        "sat_fat_g": 1.9,
        "fiber_g": 0,
        "calories": 61,
    },
    {
        "name": "Salmon",
        "carbs_g": 0,
        "protein_g": 20,
        "fat_g": 13,
        "sat_fat_g": 3,
        "fiber_g": 0,
        "calories": 208,
    },
    {
        "name": "Broccoli",
        "carbs_g": 7,
        "protein_g": 2.8,
        "fat_g": 0.4,
        "sat_fat_g": 0,
        "fiber_g": 2.6,
        "calories": 34,
    },
    {
        "name": "Potato",
        "carbs_g": 17,
        "protein_g": 2,
        "fat_g": 0.1,
        "sat_fat_g": 0,
        "fiber_g": 2.2,
        "calories": 77,
    },
    {
        "name": "Almonds",
        "carbs_g": 22,
        "protein_g": 21,
        "fat_g": 49,
        "sat_fat_g": 3.7,
        "fiber_g": 12.5,
        "calories": 579,
    },
    {
        "name": "Orange",
        "carbs_g": 12,
        "protein_g": 0.9,
        "fat_g": 0.1,
        "sat_fat_g": 0,
        "fiber_g": 2.4,
        "calories": 47,
    },
]

FOOD_CORRECTIONS = {
    "back eye beans": "black-eyed peas",
    "black eye beans": "black-eyed peas",
    "black eyed beans": "black-eyed peas",
    "black eye peas": "black-eyed peas",
    "kidney beans red": "red kidney beans",
}

USDA_SYNONYMS = {
    "black eyed peas": ["cowpeas", "blackeye beans"],
    "kidney beans": ["red kidney beans"],
}
# food_engine.py



def trace(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()

        print(f"\n🔍 [TRACE_ENTER] {func.__name__}")
        print(f"   args={args} kwargs={kwargs}")

        result = func(*args, **kwargs)

        end = time.time()

        print(f"✅ [TRACE_EXIT] {func.__name__} ({(end-start)*1000:.2f} ms)")
        print(f"   result={result}")

        return result

    return wrapper

def expand_query(query):
    base = query.lower()

    if base in USDA_SYNONYMS:
        return [base] + USDA_SYNONYMS[base]

    return [base]

def normalize_food_text(text: str) -> str:
    t = text.lower().strip()

    if t in FOOD_CORRECTIONS:
        corrected = FOOD_CORRECTIONS[t]
        print(f"[FOOD_CORRECTION] {t} → {corrected}")
        return corrected

    return text

@trace
def get_nutrition(food, trace_id=None):
    print("🔥 USING NEW GET_NUTRITION")

    # 1. Try internal DB
    data = FOOD_DATA.get(food)
    if data:
        return data

    # 2. Try USDA
    resolved = resolve_usda(food, trace_id)

    if resolved and "nutrients" in resolved:
        nutrients = resolved["nutrients"]

        parsed = extract_usda_nutrients(nutrients)

        return {
            **parsed,
            "soluble_fiber_g": 0.0,
            "_source": "usda"
        }

    # 3. Fallback (IMPORTANT)
    return {
        "carbs_g": 0,
        "protein_g": 0,
        "fat_g": 0,
        "sat_fat_g": 0,
        "fiber_g": 0,
        "calories": 0,
        "_source": "unknown"
    }

def resolve_food(food, trace_id=None):

    # 1. Try internal DB
    internal = detect_food(food)
    if internal:
        return internal

    # 2. USDA fallback
    fdc_id = search_usda(food, trace_id)

    if not fdc_id:
        return None

    return get_usda_food_details(fdc_id, trace_id)

@trace
def canonicalize_food_name(n: str) -> str:
    n = n.lower().strip()

    # 🔥 LEGUME NORMALIZATION (CRITICAL)
    if "garbanzo" in n or "chickpea" in n:
        return "chickpeas (cooked)"

    if "black eye" in n or "black-eyed" in n or "cowpea" in n:
        return "black-eyed peas (cooked)"

    if "rajma" in n:
        return "kidney beans (cooked)"

    if "chana" in n:
        return "chickpeas (cooked)"

    if "peruvian beans" in n or "mayocoba" in n:
        return "yellow beans (cooked)"   # fallback best match

    # default
    return n

def normalize_food_input(raw_tokens):
    # join tokens into one phrase
    joined = " ".join(raw_tokens).lower().strip()

    # canonical mapping
    canonical = canonicalize_food_name(joined)

    return [canonical]

def empty_nutrition():

    return {

        "carbs_g": 0.0,
        "protein_g": 0.0,
        "fat_g": 0.0,
        "sat_fat_g": 0.0,
        "fiber_g": 0.0,
        "soluble_fiber_g": 0.0,
        "calories": 0.0,
        "_source": "unknown",
    }
    
def extract_usda_nutrients(nutrients: list) -> dict:
    result = {
        "carbs_g": 0.0,
        "protein_g": 0.0,
        "fat_g": 0.0,
        "sat_fat_g": 0.0,
        "fiber_g": 0.0,
        "calories": 0.0,
    }

    for n in nutrients:
        name = (
            n.get("nutrientName")
            or (n.get("nutrient") or {}).get("name")
            or ""
        ).lower()

        value = n.get("value") if "value" in n else n.get("amount", 0)

        # 🔥 ORDER MATTERS
        if "carbohydrate" in name:
            result["carbs_g"] = float(value)
        elif "protein" in name:
            result["protein_g"] = float(value)
        elif "saturated" in name:
            result["sat_fat_g"] = float(value)
        elif "lipid" in name or "fat" in name:
            result["fat_g"] = float(value)
        elif "fiber" in name:
            result["fiber_g"] = float(value)
        elif "energy" in name and "kcal" in name:
            result["calories"] = float(value)

    return result

def detect_domain_from_query(query: str) -> dict:
    return {}

def merge_domain_scores(query_scores: dict, food_scores: dict) -> dict:
    return food_scores

def _parse_food_data(data: list) -> dict:
    food_data = {}
    for item in data:
        name = item["name"].strip().lower()
        food_data[name] = {
            "carbs_g": float(item.get("carbs_g", 0)),
            "protein_g": float(item.get("protein_g", 0)),
            "fat_g": float(item.get("fat_g", 0)),
            "sat_fat_g": float(item.get("sat_fat_g", 0)),
            "fiber_g": float(item.get("fiber_g", 0)),
            "calories": float(item.get("calories", 0)),
        }
    return food_data


def load_food_data(api_url: str) -> dict:
    response = requests.get(api_url)
    data = response.json()
    return _parse_food_data(data)


def build_food_calories(food_data: dict) -> dict:
    food_calories = {}
    for food, n in food_data.items():
        food_calories[food] = {
            "glucose": n["carbs_g"] * 4,
            "cholesterol": n["sat_fat_g"] * 9,
        }
    return food_calories


FOOD_SYNONYMS: dict = {
    "rice": "brown rice (cooked)",
    "white rice": "brown rice (cooked)",
    "dal": "moong dal (cooked)",
    "moong": "moong dal (cooked)",
    "lentil": "red lentils (cooked)",
    "lentils": "red lentils (cooked)",
    "roti": "whole wheat tortilla",
    "chapati": "whole wheat tortilla",
    "chicken": "chicken breast (cooked)",
    "paneer": "paneer",
}

FOOD_SYNONYMS.update({
    "rajma": "kidney beans (cooked)",
    "chawal": "brown rice (cooked)",
    "sabzi": "mixed vegetables (cooked)",
})

@trace
def tokenize(query: str) -> List[str]:
    tokens = re.split(r"[\s,;]+", query.lower().strip())
    normalized = normalize_food_input(tokens)
    print("[FOOD_NORMALIZE] raw_tokens=", tokens, "normalized=", normalized)
    
    return [t for t in tokens if t]


SAFE_PARTIALS: dict = {
    "almond": "almonds",
    "egg":    "eggs (whole)",
    "oat":    "oats (rolled)",
}


PHRASE_SYNONYMS: dict = {
    "chicken curry": "chicken breast (cooked)",
    "fried rice":    "brown rice (cooked)",
    "ice cream":     "ice cream",  # captures phrase before tokenization splits it
}

PHRASE_SYNONYMS.update({
    "rajma chawal": "kidney beans (cooked)",
    "kidney beans": "kidney beans (cooked)",
    "black beans": "black beans (cooked)",
    "green beans": "green beans (cooked)",
    "black eye beans": "black-eyed peas (cooked)",
    "black eyed beans": "black-eyed peas (cooked)",
    "black eye peas": "black-eyed peas (cooked)",
    "black eyed peas": "black-eyed peas (cooked)",
})


# High-impact food/drink terms trusted for routing even when not in FOOD_DATA.
# Keep small and intentional — do NOT add macro words (fat, carbs, fiber).
CURATED_HIGH_IMPACT_FOODS: set = {
    "coke", "cola", "soda", "juice",
    "orange juice", "apple juice",
    "ice cream",
}

INTERNAL_FOOD_BEHAVIOR: dict = {
    "juice": {
        "domain": "glucose",
        "message": "Juice is a fast sugar load, so the glucose risk is high. Pair it with protein or take a 10–15 minute walk after.",
    },
    "coke": {
        "domain": "glucose",
        "message": "Coke is liquid sugar, so glucose can rise quickly. Best move: reduce the portion or walk 10–15 minutes after.",
    },
    "soda": {
        "domain": "glucose",
        "message": "Soda is a fast carb drink, so expect a quick glucose rise. Reduce the portion or pair it with protein/fiber.",
    },
    "ice cream": {
        "domain": "glucose",
        "message": "Ice cream has sugar plus fat, so the spike can be delayed. Keep the portion small and walk after if you can.",
    },
}

STOPWORDS: set = {
    # serving / connector words
    "piece", "pieces", "slice", "slices", "serving", "servings",
    "plate", "bowl", "item", "items", "with", "and", "of",
    # question words
    "how", "what", "why", "when", "where", "which", "who",
    # auxiliaries / copulas
    "do", "does", "did", "can", "could", "should", "would", "will",
    "am", "is", "are", "was", "were",
    # pronouns / determiners
    "my", "your", "our", "their", "its", "the", "a", "an", "this", "that",
    # prepositions
    "to", "for", "in", "on", "at", "by", "from", "into", "after", "before",
    # common verbs in health queries (not food)
    "lower", "reduce", "improve", "increase", "manage", "help", "get",
    # medical abbreviations / lab terms (not food)
    "a1c", "ldl", "hdl", "blood", "pressure",
    # nutrition/macro concepts (not standalone foods)
    "fat", "carbs", "carb", "fiber", "protein",
    # common health-query adjectives
    "high", "low",
    # time / context words (not food)
    "late", "night", "morning", "evening",
    # meta-level words (not food items themselves)
    "meal", "food",
}

STOPWORDS.update({
    # intent / helper verbs
    "need", "want", "control", "track", "check", "know", "tell",
    # health metrics — not food items
    "sugar", "glucose", "hba1c", "cholesterol", "triglycerides", "diabetes",
    # meta nutrition concepts
    "diet", "nutrition", "calories", "fats",
    # lifestyle context words
    "workout", "exercise",
    # adjectives
    "good", "bad", "better", "normal",
    # time
    "today", "tomorrow",
    "little", "bit", "some", "few",
})

STOPWORDS.update({
    # pronouns
    "i", "me", "we", "you",
    # meal-reporting verbs
    "ate", "eat", "eating", "eaten",
    "had", "have", "having",
    "consumed", "took",
    # vague quantity / context words
    "some", "something", "anything",
    # time words not already covered
    "yesterday", "tonight", "now", "just",
    # non-food product/query words
    "price", "cost", "calorie",
    # generic meal words not already in set
    "dish",
})

UNIT_PATTERN = re.compile(r"^\d+(\.\d+)?\s*(g|gram|grams|ml|oz|ounce|ounces|cup|cups)?$")

# Add entries ONLY after verifying the canonical key exists in FOOD_DATA.
# Run: python3 -c "from food_engine import FOOD_DATA; print('key' in FOOD_DATA)"
HIGH_FREQUENCY_CANONICALS: dict = {}


def normalize_phrases(query: str) -> Tuple[str, List[str]]:
    q = query.lower()
    extracted = []

    for phrase, canonical in PHRASE_SYNONYMS.items():
        if phrase in q:
            extracted.append(canonical)
            # DO NOT REMOVE phrase completely
            # just mark it
            q = q.replace(phrase, phrase)  # no deletion

    return q, extracted


def normalize_tokens(tokens: List[str]) -> List[str]:
    result = []
    for t in tokens:
        if t in FOOD_SYNONYMS:
            result.append(FOOD_SYNONYMS[t])
        elif t in SAFE_PARTIALS:
            result.append(SAFE_PARTIALS[t])
        elif t in HIGH_FREQUENCY_CANONICALS:
            result.append(HIGH_FREQUENCY_CANONICALS[t])
        else:
            result.append(t)
    return result


def is_noise_token(token: str) -> bool:
    t = token.strip().lower()
    if not t:
        return True
    if t in STOPWORDS:
        return True
    if t.startswith("(") and t.endswith(")"):
        return True
    if UNIT_PATTERN.match(t):
        return True
    return False


def is_food_like(token: str) -> bool:
    t = token.strip().lower()
    if is_noise_token(t):
        return False
    if len(t) <= 2:
        return False
    if t.isdigit():
        return False
    return True

def is_part_of_detected_food(token: str, foods: list) -> bool:
    t = (token or "").lower().strip()
    if not t:
        return False
    for food in foods or []:
        f = (food or "").lower()
        if t in f:
            return True
    return False

@trace
def detect_foods(query: str) -> list:
    # 🔥 STEP 1: Phrase normalization (multi-word foods)
    query, phrase_foods = normalize_phrases(query)

    # 🔥 STEP 2: Tokenize + normalize
    tokens = tokenize(query)
    normalized = normalize_tokens(tokens)

    print(f"[FOOD_NORMALIZE] raw_tokens={tokens} normalized={normalized}")

    detected = []
    unknown = []

    # 🔥 STEP 3: Match against FOOD_DATA
    for token in normalized:

        if is_noise_token(token):
            continue

        matched = False

        for food in FOOD_DATA:
            base = food.split("(")[0].strip()

            if token == food or token == base:
                detected.append(food)
                matched = True
                break

        # 🔴 Unknown tracking (DO NOT add to detected list)
        if (
            not matched
            and is_food_like(token)
            and not is_noise_token(token)
        ):
            unknown.append(token)

    # 🔥 STEP 4: Track unknowns globally (but do NOT return them)
    for u in unknown:
        UNKNOWN_FOODS.add(u)

    # 🔥 STEP 5: Merge ONLY valid foods (NO UNKNOWN LEAK)
    seen = set()
    result = []

    for item in detected + phrase_foods:
        if item not in seen:
            result.append(item)
            seen.add(item)

    return result


def score_domains(foods: list, multiplier: float = 1.0) -> dict:
    scores = {"glucose": 0.0, "cholesterol": 0.0, "lifestyle": 0.0}
    for food in foods:
        n = resolve_usda(food)
        scores["glucose"] += n.get("carbs_g", 0) * 4 * multiplier
        scores["cholesterol"] += n.get("sat_fat_g", 0) * 9 * multiplier
    return scores


CARB_KCAL_PER_G = 4
FAT_KCAL_PER_G = 9
PROTEIN_KCAL_PER_G = 4
CARB_DOMINANCE_THRESHOLD = 0.30
FAT_DOMINANCE_THRESHOLD = 0.35

DOMAIN_PRIORITY = ["glucose", "cholesterol", "bp", "lifestyle"]


def pick_domain(scores: dict) -> str:
    if not scores:
        return "glucose"
    best_score = max(scores.values())
    winners = [d for d, v in scores.items() if v == best_score]
    if len(winners) == 1:
        return winners[0]
    for domain in DOMAIN_PRIORITY:
        if domain in winners:
            return domain
    return winners[0]


def aggregate_macro_totals(foods: list) -> dict:
    totals = {"carbs_g": 0.0, "fat_g": 0.0, "protein_g": 0.0, "fiber_g": 0.0, "calories": 0.0}
    for food in foods:
        n = resolve_usda(food)
        totals["carbs_g"]  += float(n.get("carbs_g",  0) or 0)
        totals["fat_g"]    += float(n.get("fat_g",    0) or 0)
        totals["protein_g"]+= float(n.get("protein_g",0) or 0)
        totals["fiber_g"]  += float(n.get("fiber_g",  0) or 0)
        totals["calories"] += float(n.get("calories", 0) or 0)
    return totals


def compute_macro_dominance(totals: dict) -> dict:
    carbs_g   = float(totals.get("carbs_g", 0) or 0)
    fat_g     = float(totals.get("fat_g", 0) or 0)
    protein_g = float(totals.get("protein_g", 0) or 0)

    carb_cal    = carbs_g * CARB_KCAL_PER_G
    fat_cal     = fat_g   * FAT_KCAL_PER_G
    protein_cal = protein_g * PROTEIN_KCAL_PER_G

    total_cal = carb_cal + fat_cal + protein_cal

    # 🔴 EDGE CASE: no meaningful nutrition
    if total_cal <= 0:
        return {
            "dominance": "balanced",
            "carb_cal": 0.0,
            "fat_cal": 0.0,
            "protein_cal": 0.0,
            "carb_ratio": 0.0,
            "fat_ratio": 0.0,
            "protein_ratio": 0.0,
        }

    carb_ratio = carb_cal / total_cal
    fat_ratio  = fat_cal  / total_cal
    protein_ratio = protein_cal / total_cal

    # 🔥 DOMINANCE LOGIC (ordered by metabolic impact)

    # 🔥 DOMINANCE LOGIC (CORRECTED)

    # 🔥 FINAL DOMINANCE LOGIC

    glucose_flag = carb_ratio >= 0.30
    cholesterol_flag = fat_ratio >= 0.35

    if glucose_flag and cholesterol_flag:
        dominance = "mixed"
    elif glucose_flag:
        dominance = "glucose"
    elif cholesterol_flag:
        dominance = "cholesterol"
    else:
        dominance = "balanced"

    return {
        "dominance": dominance,
        "carb_cal": round(carb_cal, 2),
        "fat_cal": round(fat_cal, 2),
        "protein_cal": round(protein_cal, 2),
        "carb_ratio": round(carb_ratio, 3),
        "fat_ratio": round(fat_ratio, 3),
        "protein_ratio": round(protein_ratio, 3),
    }

def apply_macro_dominance_signal(scores: dict, dominance_info: dict) -> dict:
    adjusted = dict(scores)
    dominance = dominance_info.get("dominance", "balanced")
    if dominance == "glucose":
        adjusted["glucose"] = adjusted.get("glucose", 0) + 2
    elif dominance == "cholesterol":
        adjusted["cholesterol"] = adjusted.get("cholesterol", 0) + 2
    return adjusted


def classify_macro_confidence(macro_dominance: dict) -> str:
    dominance  = macro_dominance.get("dominance", "balanced")
    carb_ratio = float(macro_dominance.get("carb_ratio", 0.0) or 0.0)
    fat_ratio  = float(macro_dominance.get("fat_ratio",  0.0) or 0.0)

    if dominance == "balanced":
        return "low"
    if dominance == "glucose":
        margin = carb_ratio - CARB_DOMINANCE_THRESHOLD
    elif dominance == "cholesterol":
        margin = fat_ratio - FAT_DOMINANCE_THRESHOLD
    else:
        return "low"

    if margin >= 0.15:
        return "high"
    if margin >= 0.05:
        return "medium"
    return "low"


def determine_domain_from_foods_and_query(query: str, foods: list) -> dict:
    # ------------------------------------------------------------
    # 🔥 STEP 1: BASE FOOD SCORING
    # ------------------------------------------------------------
    food_scores = score_domains(foods)

    # ------------------------------------------------------------
    # 🔥 STEP 2: MACRO ANALYSIS
    # ------------------------------------------------------------
    macro_totals = aggregate_macro_totals(foods)
    dominance_info = compute_macro_dominance(macro_totals)

    # 🔥 APPLY MACRO SIGNAL (soft boost, NOT override)
    food_scores = apply_macro_dominance_signal(food_scores, dominance_info)

    # ------------------------------------------------------------
    # 🔥 STEP 3: QUERY SIGNAL (optional)
    # ------------------------------------------------------------
    query_scores = detect_domain_from_query(query)
    final_scores = merge_domain_scores(query_scores, food_scores)

    # ------------------------------------------------------------
    # 🔥 STEP 4: BASE DOMAIN FROM SCORES
    # ------------------------------------------------------------
    domain = pick_domain(final_scores)

    # ------------------------------------------------------------
    # 🔥 STEP 5: MACRO DOMINANCE (SAFE OVERRIDE)
    # ------------------------------------------------------------
    dominance = dominance_info.get("dominance", "balanced")
    confidence = classify_macro_confidence(dominance_info)

    fiber = float(macro_totals.get("fiber_g", 0) or 0)
    carbs = float(macro_totals.get("carbs_g", 0) or 0)
    fiber_ratio = fiber / carbs if carbs > 0 else 0

    carb_ratio = float(dominance_info.get("carb_ratio", 0))
    fat_ratio  = float(dominance_info.get("fat_ratio", 0))

    fiber_ratio = fiber / carbs if carbs > 0 else 0

    # 🔥 NET CARB EFFECT (better than binary fiber cancel)
    net_carb_effect = carb_ratio * (1 - min(fiber_ratio, 0.3))

    # ------------------------------------------------------------
    # 🔥 STEP 6: SAFE OVERRIDE LOGIC (WITH CONFIDENCE GATING)
    # ------------------------------------------------------------
    if confidence != "low":

        if dominance == "glucose":
            if net_carb_effect >= 0.30:
                domain = "glucose"
            elif net_carb_effect >= 0.22:
                domain = "balanced"
            else:
                domain = "lifestyle"

        elif dominance == "cholesterol":
            if fat_ratio >= 0.35:
                domain = "cholesterol"

        elif dominance == "mixed":
            if net_carb_effect >= 0.28:
                domain = "glucose"
            elif fat_ratio >= 0.38:
                domain = "cholesterol"
            else:
                domain = "lifestyle"

        elif dominance == "balanced":
            domain = "lifestyle"

    # LOW confidence → DO NOT override base score

    # ------------------------------------------------------------
    # 🔥 FINAL OUTPUT
    # ------------------------------------------------------------
    return {
        "domain": domain,
        "scores": final_scores,
        "macro_totals": macro_totals,
        "macro_dominance": dominance_info,
        "macro_confidence": confidence,
    }


def extract_grams(query: str) -> float:
    match = re.search(r"(\d+)\s*(g|grams)", query.lower())
    if match:
        return float(match.group(1))
    return 100.0


def compute_nutrition_summary(foods: list, multiplier: float = 1.0) -> dict:
    totals = {
        "carbs_g": 0.0,
        "protein_g": 0.0,
        "fat_g": 0.0,
        "sat_fat_g": 0.0,
        "fiber_g": 0.0,
        "soluble_fiber_g": 0.0,
    }
    for food in foods:
        f = FOOD_DATA.get(food)
        if not f:
            continue
        totals["carbs_g"] += f["carbs_g"] * multiplier
        totals["protein_g"] += f["protein_g"] * multiplier
        totals["fat_g"] += f["fat_g"] * multiplier
        totals["sat_fat_g"] += f["sat_fat_g"] * multiplier
        totals["fiber_g"] += f["fiber_g"] * multiplier
        totals["soluble_fiber_g"] += f.get("soluble_fiber_g", 0) * multiplier
    totals["insoluble_fiber_g"] = totals["fiber_g"] - totals["soluble_fiber_g"]
    return totals


def compute_meal_calories(foods: list, multiplier: float = 1.0) -> float:
    total = 0.0
    for food in foods:
        f = FOOD_DATA.get(food)
        if f:
            total += (
                f["carbs_g"] * 4 +
                f["protein_g"] * 4 +
                f["fat_g"] * 9
            ) * multiplier
    return total


USDA_API_KEY = os.getenv("USDA_API_KEY")
USDA_CACHE: dict = {}

def normalize_input(query: str) -> str:
    FOOD_SPELLING_CORRECTIONS = {
        "avacado": "avocado",
        "avacados": "avocados",
        "brocoli": "broccoli",
        "broccolli": "broccoli",
        "tumeric": "turmeric",
        "bannana": "banana",
    }

    q = query.lower().strip()
    q = re.sub(r"[,/;|]+", " ", q)
    q = re.sub(r"[-]+", " ", q)

    tokens = re.findall(r"\b\w+\b", q)
    corrected = [FOOD_SPELLING_CORRECTIONS.get(t, t) for t in tokens]

    return " ".join(corrected)


UNKNOWN_FOODS = set()

def normalize_usda_food_name(name: str) -> str:
    """
    🔥 Converts USDA result → your canonical FOOD_DATA format
    """
    n = name.lower().strip()

    # ------------------------------------------------------------
    # 🔥 BLACK-EYED PEAS / COWPEA NORMALIZATION (CRITICAL FIX)
    # ------------------------------------------------------------
    if "black eyed" in n or "black-eyed" in n:
        return "black-eyed peas (cooked)"

    if "cowpea" in n or "southern pea" in n:
        return "black-eyed peas (cooked)"

    # ------------------------------------------------------------
    # 🔥 OTHER BEANS
    # ------------------------------------------------------------
    if "kidney" in n:
        return "kidney beans (cooked)"

    if "chickpea" in n or "chole" in n:
        return "chickpeas (cooked)"

    if "lentil" in n:
        return "red lentils (cooked)"

    # ------------------------------------------------------------
    # 🔥 GENERIC BEAN SAFETY
    # ------------------------------------------------------------
    if "bean" in n:
        return n + " (cooked)"

    return n

def expand_usda_candidates(query: str) -> list:
    q = query.lower().strip()

    expansions = set()

    # base
    expansions.add(q)

    # cooked variants
    expansions.add(q + " cooked")

    # beans → peas
    if "beans" in q:
        expansions.add(q.replace("beans", "peas"))
        expansions.add(q.replace("beans", ""))

    # 🔥 CRITICAL DOMAIN KNOWLEDGE
    if "black" in q and ("eye" in q or "eyed" in q):
        expansions.update([
            "black eyed peas",
            "black eyed peas cooked",
            "cowpeas",
            "cowpeas cooked",
            "southern peas",
        ])

    return [e.strip() for e in expansions if e.strip()]

def try_usda_as_food(query: str) -> Optional[str]:
    candidates = expand_usda_candidates(query)

    for candidate in candidates:
        print(f"[USDA_TRY] {candidate}")

        data = call_usda(candidate)

        if data:
            canonical = normalize_usda_food_name(candidate)

            print(f"[USDA_PROMOTED] raw={candidate} → canonical={canonical}")

            USDA_CACHE[canonical] = data
            return canonical

    print(f"[USDA_FAILED_ALL] {query}")
    return None

@trace
def process_query(query: str) -> dict:
    query = normalize_input(query)

    # 🔥 STEP 1: DETECT FOODS
    query = normalize_food_text(query)
    foods = detect_foods(query)

    # 🔥 STEP 1B: FORCE USDA PROMOTION (ALWAYS BEFORE ANY EXIT)
    if not foods:
        candidate = try_usda_as_food(query)

        if candidate:
            print(f"[FOOD_PROMOTED_FROM_USDA] {candidate}")

            nutrition = USDA_CACHE.get(candidate) or call_usda(candidate)

            if nutrition:
                FOOD_DATA[candidate] = nutrition

            foods = [candidate]

    # 🔥 DEBUG (add this temporarily)
    print(f"[PROCESS_QUERY] foods after detection+usda: {foods}")

# 🔥 NOW continue pipeline (not before)

    # ------------------------------------------------------------
    # 🔥 STEP 2: CAPTURE UNKNOWNS (SEPARATE TRACKING)
    # ------------------------------------------------------------
    tokens = tokenize(query)
    known_set = {f.lower() for f in foods}

    unknown_tokens = []

    for t in tokens:
        if (
            is_food_like(t)
            and t.lower() not in known_set
            and not is_part_of_detected_food(t, foods)
        ):
            UNKNOWN_FOODS.add(t.lower())
            unknown_tokens.append(t.lower())

    # ------------------------------------------------------------
    # 🔴 HARD STOP: NO VALID FOODS (AFTER USDA TRY)
    # ------------------------------------------------------------
    if not foods:
        return {
            "foods": [],
            "scores": {"glucose": 0, "cholesterol": 0, "lifestyle": 0},
            "domain": "unknown",
            "meal_calories": 0.0,
            "nutrition": {},
            "macro_dominance": {
                "dominance": "balanced",
                "carb_cal": 0.0,
                "fat_cal": 0.0,
                "protein_cal": 0.0,
                "carb_ratio": 0.0,
                "fat_ratio": 0.0,
                "protein_ratio": 0.0,
            },
            "macro_totals": {},
            "has_food": False,
        }

    # ------------------------------------------------------------
    # 🔴 HARD STOP: ALL FOODS UNKNOWN (FIXED)
    # ------------------------------------------------------------
    valid_foods = []

    for f in foods:
        n = get_nutrition(f)
        print("[DEBUG_NUTRITION]", f, n)

        # 🔥 ACCEPT IF ANY REAL SIGNAL EXISTS
        if n and any([
            n.get("carbs_g", 0) > 0,
            n.get("protein_g", 0) > 0,
            n.get("fat_g", 0) > 0,
            n.get("calories", 0) > 0
        ]):
            valid_foods.append(f)

    # 🔥 HARD STOP ONLY IF NOTHING VALID
    if not valid_foods:
        return {
            "foods": [],
            "scores": {"glucose": 0, "cholesterol": 0, "lifestyle": 0},
            "domain": "unknown",
            "meal_calories": 0.0,
            "nutrition": {},
            "macro_dominance": {
                "dominance": "balanced",
                "carb_cal": 0.0,
                "fat_cal": 0.0,
                "protein_cal": 0.0,
                "carb_ratio": 0.0,
                "fat_ratio": 0.0,
                "protein_ratio": 0.0,
            },
            "macro_totals": {},
            "has_food": False,
        }

    # 🔥 overwrite foods with valid ones
    foods = valid_foods

    # ------------------------------------------------------------
    # 🔥 STEP 3: CALCULATIONS
    # ------------------------------------------------------------
    grams = extract_grams(query)
    multiplier = grams / 100.0 if len(foods) == 1 else 1.0

    domain_result = determine_domain_from_foods_and_query(query, foods)
    calories = compute_meal_calories(foods, multiplier)
    nutrition = compute_nutrition_summary(foods, multiplier)

    # ------------------------------------------------------------
    # 🔥 FINAL RESPONSE
    # ------------------------------------------------------------
    return {
        "foods": foods,
        "scores": domain_result["scores"],
        "domain": domain_result["domain"],
        "meal_calories": calories,
        "nutrition": nutrition,
        "macro_dominance": domain_result["macro_dominance"],
        "macro_totals": domain_result["macro_totals"],
        "has_food": True,
    }

def nutrition_source_confidence(nutrition: dict) -> str:
    source = nutrition.get("_source", "food_data")
    if source == "food_data":
        return "high"
    if source == "usda":
        return "medium"
    return "low"


def build_food_sources(foods: list) -> list:
    sources = []
    for food in foods:
        n = get_nutrition(food)
        source = n.get("_source", "food_data")
        sources.append({
            "food": food,
            "source": source,
            "confidence": nutrition_source_confidence(n),
        })
    return sources


def load_food_data_from_csv(file_path: str) -> dict:
    import csv

    food_data = {}

    with open(file_path, newline="") as csvfile:
        reader = csv.DictReader(csvfile)

        for row in reader:
            try:
                name = row["Name"].strip().lower()

                food_data[name] = {
                    "carbs_g": float(row.get("Carbs (g)", 0)),
                    "protein_g": float(row.get("Protein (g)", 0)),
                    "fat_g": float(row.get("Total Fat (g)", 0)),
                    "sat_fat_g": float(row.get("Saturated Fat (g)", 0)),
                    "fiber_g": float(row.get("Total Fiber (g)", 0)),
                    "soluble_fiber_g": float(row.get("Soluble Fiber (g)", 0)),
                    "calories": float(row.get("Calories (kcal)", 0)),
                }

            except Exception as e:
                print(f"⚠️ Skipping row due to error: {e}")

    return food_data


BASE_DIR = os.path.dirname(os.path.abspath(__file__))

csv_path = os.path.join(BASE_DIR, "data", "food_items.csv")

print("📂 CSV PATH:", csv_path)

try:
    FOOD_DATA = load_food_data_from_csv(csv_path)
    print(f"✅ CSV LOADED: {len(FOOD_DATA)} items")
except Exception as e:
    print(f"❌ CSV LOAD FAILED: {e}")
    FOOD_DATA = _parse_food_data(SEED_FOOD_ITEMS)

FOOD_CALORIES = build_food_calories(FOOD_DATA)
