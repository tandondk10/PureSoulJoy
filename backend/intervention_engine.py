from typing import Optional

# (domain, need, context_key) → ordered list of intervention identifiers
# context_key: "post_meal" | "high_reading" | None
INTERVENTION_MAP = {
    # --- glucose / intervention ---
    ("glucose", "intervention", "post_meal"): [
        "walk_10min_now",
        "drink_water_now",
        "next_meal_add_protein_and_fiber",
    ],
    ("glucose", "intervention", "high_reading"): [
        "walk_10min_now",
        "drink_water_now",
        "avoid_simple_carbs_now",
    ],
    ("glucose", "intervention", None): [
        "walk_10min_now",
        "drink_water_now",
        "next_meal_add_protein_and_fiber",
    ],
    # glucose / guidance
    ("glucose", "prevention", "post_meal"): [
        "walk_10min_now",
        "drink_water_now",
        "next_meal_add_protein_and_fiber",
    ],
    ("glucose", "prevention", None): [
        "fiber_first",
        "reduce_refined_carbs",
        "walk_after_meals",
    ],
    ("glucose", "guidance", "post_meal"): [
        "walk_10min_now",
        "drink_water_now",
        "next_meal_add_protein_and_fiber",
    ],
    ("glucose", "guidance", None): [
        "fiber_first",
        "reduce_refined_carbs",
        "walk_after_meals",
    ],
    ("glucose", "nutrition", "post_meal"): [
        "fiber_protein_meal",
        "reduce_simple_carbs",
        "drink_water_now",
    ],
    ("glucose", "nutrition", None): ["fiber_first", "low_gi_foods", "balanced_plate"],
    ("glucose", "education", None): [
        "understand_glucose_spikes",
        "track_bg_pattern",
        "learn_glycemic_index",
    ],
    ("glucose", "exercise", None): [
        "walk_after_meals",
        "light_resistance_training",
        "consistent_activity",
    ],
    # --- bp / intervention ---
    ("bp", "intervention", "high_reading"): [
        "slow_deep_breathing",
        "sit_and_rest_now",
        "reduce_salt_today",
    ],
    ("bp", "intervention", "post_meal"): [
        "sit_and_rest_now",
        "avoid_heavy_food_now",
        "check_bp_in_30min",
    ],
    ("bp", "intervention", None): [
        "reduce_sodium_now",
        "sit_quietly_5min",
        "check_bp_again_in_30min",
    ],
    # bp / guidance
    ("bp", "prevention", None): ["reduce_sodium", "walk_daily", "stress_management"],
    ("bp", "guidance", None): ["reduce_sodium", "walk_daily", "stress_management"],
    ("bp", "nutrition", None): [
        "potassium_rich_foods",
        "reduce_sodium",
        "avoid_processed_food",
    ],
    ("bp", "education", None): [
        "understand_bp_range",
        "track_bp_daily",
        "identify_triggers",
    ],
    ("bp", "exercise", None): [
        "walk_30min_daily",
        "avoid_heavy_lifting",
        "consistent_light_activity",
    ],
    # --- cholesterol / intervention ---
    ("cholesterol", "intervention", None): [
        "avoid_saturated_fat_today",
        "add_soluble_fiber_to_meal",
        "take_a_brisk_walk",
    ],
    ("cholesterol", "intervention", "high_reading"): [
        "avoid_saturated_fat_today",
        "add_soluble_fiber_to_meal",
        "take_a_brisk_walk",
    ],
    # cholesterol / guidance
    ("cholesterol", "prevention", None): [
        "soluble_fiber_daily",
        "limit_saturated_fat",
        "regular_exercise",
    ],
    ("cholesterol", "guidance", None): [
        "soluble_fiber_daily",
        "limit_saturated_fat",
        "regular_exercise",
    ],
    ("cholesterol", "nutrition", None): [
        "oats_daily",
        "healthy_fats",
        "increase_vegetables",
    ],
    ("cholesterol", "education", None): [
        "understand_ldl_hdl",
        "lifestyle_vs_medication",
        "track_lipids",
    ],
    # --- lifestyle / intervention (domain fallback after recent fix) ---
    ("lifestyle", "intervention", "post_meal"): [
        "walk_10min_now",
        "drink_water_now",
        "light_movement",
    ],
    ("lifestyle", "intervention", "high_reading"): [
        "sit_and_rest_now",
        "slow_deep_breathing",
        "avoid_stimulants",
    ],
    ("lifestyle", "intervention", None): [
        "take_a_10min_walk",
        "drink_water_now",
        "check_your_last_meal",
    ],
    ("lifestyle", "guidance", None): [
        "balanced_diet",
        "regular_activity",
        "manage_stress",
    ],
    ("lifestyle", "education", None): [
        "understand_condition",
        "track_metrics",
        "lifestyle_focus",
    ],
    # --- need-only fallbacks (no specific condition) ---
    (None, "intervention", "post_meal"): [
        "walk_10min_now",
        "drink_water_now",
        "light_movement",
    ],
    (None, "intervention", "high_reading"): [
        "sit_and_rest_now",
        "slow_deep_breathing",
        "avoid_stimulants",
    ],
    (None, "intervention", None): [
        "take_a_10min_walk",
        "drink_water_now",
        "check_your_last_meal",
    ],
    (None, "prevention", "post_meal"): [
        "walk_10min_now",
        "drink_water_now",
        "light_activity",
    ],
    (None, "prevention", None): ["balanced_diet", "regular_activity", "manage_stress"],
    (None, "guidance", None): ["balanced_diet", "regular_activity", "manage_stress"],
    (None, "nutrition", None): ["balanced_plate", "whole_foods", "portion_control"],
    (None, "exercise", None): [
        "walk_10min_now",
        "light_stretching",
        "consistent_movement",
    ],
    (None, "education", None): [
        "understand_condition",
        "track_metrics",
        "lifestyle_focus",
    ],
    (None, "medication", None): [
        "consult_doctor",
        "lifestyle_alongside_medication",
        "track_response",
    ],
    (None, "device", None): [
        "track_cgm_patterns",
        "correlate_with_meals",
        "share_with_doctor",
    ],
}


def get_intervention(domain: Optional[str], need: str, context: dict) -> list:
    """
    Deterministic rule-based intervention selection.
    Resolution order: (domain+need+ctx) → (domain+need) → (None+need+ctx) → (None+need) → default.
    ctx_flag priority: post_meal > high_reading > None.
    """
    if context.get("after_meal"):
        ctx_flag = "post_meal"
    elif context.get("high"):
        ctx_flag = "high_reading"
    else:
        ctx_flag = None

    if ctx_flag and (domain, need, ctx_flag) in INTERVENTION_MAP:
        return list(INTERVENTION_MAP[(domain, need, ctx_flag)])

    if (domain, need, None) in INTERVENTION_MAP:
        return list(INTERVENTION_MAP[(domain, need, None)])

    if ctx_flag and (None, need, ctx_flag) in INTERVENTION_MAP:
        return list(INTERVENTION_MAP[(None, need, ctx_flag)])

    if (None, need, None) in INTERVENTION_MAP:
        return list(INTERVENTION_MAP[(None, need, None)])

    return ["take_a_10min_walk", "drink_water_now", "check_your_last_meal"]
