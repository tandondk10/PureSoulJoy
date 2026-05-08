# backend/domain/context_detector.py

def detect_context(query: str) -> str:
    """
    Detects context of user query.
    Returns: nutrition | exercise | recovery | general
    """

    q = query.lower()

    # ---- Nutrition ----
    if any(k in q for k in [
        "meal", "food", "eat", "diet", "carb", "rice", "bread"
    ]):
        return "nutrition"

    # ---- Exercise ----
    if any(k in q for k in [
        "walk", "exercise", "workout", "gym", "run"
    ]):
        return "exercise"

    # ---- Recovery ----
    if any(k in q for k in [
        "stress", "sleep", "anxiety", "rest", "calm"
    ]):
        return "recovery"

    return "general"