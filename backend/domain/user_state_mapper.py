def map_user_to_engine_state(user: dict) -> dict:
    glucose_raw = user["conditions"]["glucose"]

    glucose_state = glucose_raw["state"]

    # normalize state
    if glucose_state in ["prediabetic", "prediabetic_or_diagnosed"]:
        glucose = "at_risk"
    elif glucose_state == "diagnosed":
        glucose = "diagnosed"
    else:
        glucose = "none"

    # normalize bp
    bp_state = user["conditions"]["bp"]["state"]
    if "elevated" in bp_state:
        bp = "elevated"
    elif "high" in bp_state:
        bp = "high"
    else:
        bp = "none"

    # normalize cholesterol
    chol_state = user["conditions"]["cholesterol"]["state"]
    if "elevated" in chol_state:
        chol = "elevated"
    elif "high" in chol_state:
        chol = "high"
    else:
        chol = "none"

    return {
        "conditions": {
            "glucose": glucose,
            "bp": bp,
            "cholesterol": chol
        },

        # 🔥 NEW (do not remove)
        "glucose_profile": {
            "phenotype": glucose_raw.get("phenotype"),
            "insulin_sensitivity": glucose_raw.get("insulin_sensitivity"),
            "insulin_production": glucose_raw.get("insulin_production"),
        }
    }