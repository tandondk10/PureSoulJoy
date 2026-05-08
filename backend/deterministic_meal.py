def build_meal_mode_nudge(domain: str, foods: list) -> str:
    if not foods:
        return ""

    # 🔥 Keep it short, action-driven
    if domain == "glucose":
        return "Log this in Meal Mode with quantities to control your glucose better."

    if domain == "cholesterol":
        return "Log this in Meal Mode to track fats and improve your numbers."

    return "Log this in Meal Mode to get more precise guidance."