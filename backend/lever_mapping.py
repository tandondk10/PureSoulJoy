"""
Context → Lever → Action mapping.
All action IDs are human-readable when underscores are replaced with spaces.
"""

# Named context → ordered list of levers (most important first, max 3)
CONTEXT_LEVERS = {
    "post_meal_spike":     ["movement", "protein", "fiber"],
    "high_carb_event":    ["movement", "fiber", "timing"],
    "high_carb_habit":    ["fiber", "protein", "movement"],
    "glucose_variability": ["monitoring", "fiber", "movement"],
    "stress_trigger":     ["recovery", "movement", "monitoring"],
    "high_bp_event":      ["recovery", "food", "monitoring"],
    "high_salt":          ["food", "recovery"],
    "late_eating":        ["timing", "food"],
    "low_movement":       ["movement"],
    "behavior_gap":       ["movement", "recovery"],
    "low_energy":         ["food", "recovery", "movement"],
}

# Lever → ordered list of actions (first is the default)
LEVER_ACTIONS = {
    "movement":   ["walk_10min_now",         "take_a_brisk_walk",      "light_activity"],
    "food":       ["avoid_simple_carbs_now", "add_protein_next_meal",  "add_fiber_before_meal"],
    "fiber":      ["add_fiber_before_meal",  "fiber_first",            "eat_vegetables_first"],
    "protein":    ["add_protein_next_meal",  "eat_protein_first",      "choose_high_protein"],
    "timing":     ["eat_earlier_dinner",     "allow_meal_gap",         "delay_next_meal"],
    "recovery":   ["do_breathing_5min",      "sit_and_rest_now",       "manage_stress"],
    "monitoring": ["check_glucose_again",    "track_bg_pattern",       "pre_post_meal_compare"],
    "enhancers":  ["add_vinegar_to_meal",    "add_cinnamon_to_diet",   "add_garlic_daily"],
}

# Default levers when no context pattern matches — never use education
DEFAULT_LEVERS = ["movement", "food", "recovery"]
