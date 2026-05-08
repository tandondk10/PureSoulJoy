from domain.intensity import get_glucose_intensity

def map_actions(domain, context, levers, user_state):
    actions = []

    conditions = user_state["conditions"]
    profile = user_state.get("glucose_profile", {})

    glucose_state = conditions.get("glucose", "none")
    intensity = get_glucose_intensity(glucose_state)

    insulin_sensitivity = profile.get("insulin_sensitivity")
    insulin_production = profile.get("insulin_production")

    bp_state = conditions.get("bp", "none")
    chol_state = conditions.get("cholesterol", "none")

    # ---- Fallback for non-glucose paths ----
    if domain != "glucose" or context != "nutrition":
        return ["Focus on balanced meals and consistent activity"]

    # ---- Detect metabolic syndrome ----
    has_metabolic_syndrome = (
        glucose_state in ["at_risk", "diagnosed"]
        and bp_state != "none"
        and chol_state != "none"
    )

    print("DEBUG:", glucose_state, bp_state, chol_state, has_metabolic_syndrome)
    
    # ---- Determine scenario ----
    scenario = "normal"

    if insulin_sensitivity == "high" and insulin_production == "reduced_moderate":
        scenario = "slow_starter"

    elif insulin_sensitivity == "high" and insulin_production == "reduced_high_severity":
        scenario = "t2_low_production"

    elif insulin_sensitivity in ["reduced_like_t2", "reduced_high_severity"]:
        scenario = "insulin_resistance"

    # ---- Base actions ----
    if scenario == "slow_starter":
        actions = [
            "Eat smaller portions to avoid spikes",
            "Avoid large carb loads in one meal",
            "Spread carbs across meals"
        ]

    elif scenario == "t2_low_production":
        actions = [
            "Strictly limit carb portions per meal",
            "Always pair carbs with protein or fat",
            "Avoid back-to-back carb-heavy meals"
        ]

    elif scenario == "insulin_resistance":

        if intensity == "high":
            actions = [
                "Strictly reduce carb portion",
                "Always start with protein or fiber",
                "Walk 10–15 minutes after eating"
            ]

        elif intensity == "moderate":
            actions = [
                "Reduce simple carb portion",
                "Add protein or fiber before carbs",
                "Walk 10 minutes after eating"
            ]

        else:
            actions = [
                "Balance carbs with protein or fiber",
                "Avoid very high-carb meals",
                "Light walk after meals helps"
            ]

    else:
        actions = [
            "Balance carbs with protein or fiber",
            "Avoid very high-carb meals",
            "Light walk after meals helps"
        ]

    # ---- Overlay: Metabolic syndrome ----

    if has_metabolic_syndrome:

        overlay_actions = []

        if bp_state != "none":
            overlay_actions.append(
                "Limit sodium and avoid highly processed foods"
            )

        if chol_state != "none":
            overlay_actions.append(
                "Increase fiber and favor healthy fats over saturated fats"
            )

        # ---- Replace least important base action ----
        # Keep first 2 base actions, inject 1 overlay
        actions = actions[:2] + overlay_actions[:1]

    return actions[:3]