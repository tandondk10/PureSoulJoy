# backend/domain/lever_selector.py

def select_top_levers(domain: str, context: str, conditions: dict) -> list[str]:
    """
    Selects 1–3 levers deterministically.
    Levers: nutrition, exercise, recovery
    """

    # ---- Glucose cases ----
    if domain == "glucose":
        if context == "nutrition":
            return ["nutrition", "exercise"]

        if context == "recovery":
            return ["recovery", "nutrition"]

        if context == "exercise":
            return ["exercise"]

        return ["nutrition", "exercise"]

    # ---- Cholesterol ----
    if domain == "cholesterol":
        if context == "nutrition":
            return ["nutrition", "exercise"]
        return ["nutrition"]

    # ---- BP ----
    if domain == "bp":
        if context == "recovery":
            return ["recovery", "nutrition"]
        return ["nutrition", "exercise"]

    # ---- Lifestyle (no condition) ----
    if domain == "lifestyle":
        if context == "nutrition":
            return ["nutrition"]

        if context == "exercise":
            return ["exercise"]

        if context == "recovery":
            return ["recovery"]

        if context == "general":
            return ["nutrition", "exercise", "recovery"]

    # ---- Fallback ----
    return ["nutrition"]