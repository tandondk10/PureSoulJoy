def get_glucose_intensity(glucose_state: str) -> str:
    if glucose_state == "diagnosed":
        return "high"
    if glucose_state == "at_risk":
        return "moderate"
    return "low"