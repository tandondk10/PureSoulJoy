from backend.intervention_engine import get_intervention

ACTION_TEXT_MAP = {
    # glucose domain
    "walk_10min_now": "Take a 10-minute walk now",
    "drink_water_now": "Drink a glass of water",
    "next_meal_add_protein_and_fiber": "Add protein and fiber to your next meal",
    "avoid_simple_carbs_now": "Avoid simple carbs for now",
    # cholesterol domain
    "avoid_saturated_fat_today": "Avoid saturated fat today",
    "add_soluble_fiber_to_meal": "Add soluble fiber to your meal",
    "take_a_brisk_walk": "Take a brisk walk",
    # lifestyle / balanced / unknown domains
    "take_a_10min_walk": "Take a 10-minute walk",
    "check_your_last_meal": "Review your last meal",
}

DOMAIN_RESPONSE_MAP = {
    "glucose": "Carb-heavy meal.",
    "cholesterol": "Fat-heavy meal.",
    "lifestyle": "Balanced meal.",
    "balanced": "Balanced meal.",
    "unknown": "Balanced meal.",
}

FALLBACK_ACTIONS = ["take_a_10min_walk", "drink_water_now"]

def build_meal_mode_nudge(domain: str, foods: list) -> str:
    if not foods:
        return ""

    # 🔥 Keep it short, action-driven
    if domain == "glucose":
        return "Log this in Meal Mode with quantities to control your glucose better."

    if domain == "cholesterol":
        return "Log this in Meal Mode to track fats and improve your numbers."

    return "Log this in Meal Mode to get more precise guidance."

def build_meal_response(domain: str, actions: list, foods: list) -> str:
    base = DOMAIN_RESPONSE_MAP.get(domain, DOMAIN_RESPONSE_MAP["unknown"])
    readable = [ACTION_TEXT_MAP.get(a, a) for a in actions]

    response = base

    if readable:
        response += " " + ". ".join(readable)

    # 🔥 FIX: ensure proper sentence ending
    response = response.strip()
    if not response.endswith("."):
        response += "."

    # 🔥 Meal Mode Coaching
    if foods:
        if domain == "glucose":
            response += " Log this in Meal Mode with quantities to control your glucose better."
        elif domain == "cholesterol":
            response += " Log this in Meal Mode to track fats and improve your numbers."
        else:
            response += " Log this in Meal Mode to get more precise guidance."

    return response


def build_deterministic_meal_response(food_result: dict, meal: str) -> dict:
    
    print("[DEBUG_MEAL_RESPONSE_INPUT]", food_result)
    
    if food_result.get("needs_clarification"):
        return {
            "status": "success",
            "needs_clarification": True,
            "text": "I need more detail about your meal.",
            "chat": "I need more detail about your meal.",
            "foods": [],
            "has_food": False,
        }

    if not food_result.get("has_food") and not food_result.get("foods"):
        msg = "I couldn't detect a meal. Can you clarify?"

        return {
            "status": "success",
            "chat": msg,
            "text": msg,
            "foods": [],
            "has_food": False,
            "food_engine": True,   # 🔥 REQUIRED
            "structured": {        # 🔥 REQUIRED
                "domain": "unknown",
                "foods": [],
                "has_food": False,
            },
            "actions": [],         # 🔥 KEEP CONSISTENT
        }

    domain = food_result.get("domain", "unknown")
    foods = (
        food_result.get("foods")
        or food_result.get("matched_foods")
        or food_result.get("all_foods")
        or []
)

    actions = get_intervention(domain=domain, need="intervention", context=None) or []
    if not actions:
        actions = FALLBACK_ACTIONS

    chat = build_meal_response(domain, actions, foods)

    return {
        "status": "success",
        "chat": chat,
        "text": chat,
        "actions": actions,
        "foods": foods,
        "has_food": bool(foods),
        "food_engine": True,
        "structured": {
            "domain": domain,
            "foods": foods,
            "has_food": bool(foods),
        },
    }
