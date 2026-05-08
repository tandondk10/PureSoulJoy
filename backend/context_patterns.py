"""
Context pattern detection — maps real user language to a named context.
Returns {"domain": str, "context": str} or {} when no pattern matches.
Called before build_structured_response so domain can be overridden.
"""

PATTERN_RULES = [
    # ── glucose / post-meal spike ──────────────────────────────────────────
    {
        "keywords": [
            "spike after", "spiked after", "shot up after", "went up after",
            "high after", "sugar after", "glucose after",
            "sleepy after lunch", "sleepy after meal", "tired after eating",
            "tired after meal", "sleepy after eating",
        ],
        "domain": "glucose",
        "context": "post_meal_spike",
    },
    # ── glucose / high-carb food event ────────────────────────────────────
    {
        "keywords": [
            "pizza", "dessert", "cake", "sweet", "chocolate", "ice cream",
            "cookies", "biscuit", "jalebi", "mithai", "ladoo", "gulab jamun",
            "samosa", "bread", "white rice", "noodles", "pasta",
        ],
        "domain": "glucose",
        "context": "high_carb_event",
    },
    # ── glucose / variability ──────────────────────────────────────────────
    {
        "keywords": [
            "fluctuating", "variability", "unstable glucose", "glucose swings",
            "erratic sugar", "yo-yo", "yo yo", "swings", "labile",
        ],
        "domain": "glucose",
        "context": "glucose_variability",
    },
    # ── bp / stress trigger ────────────────────────────────────────────────
    {
        "keywords": [
            "stress", "anxious", "anxiety", "nervous", "worried", "tense",
            "panic", "overwhelmed",
        ],
        "domain": "bp",
        "context": "stress_trigger",
    },
    # ── bp / high reading event ────────────────────────────────────────────
    {
        "keywords": [
            "high bp", "blood pressure high", "bp is high", "bp spike",
            "pressure is high", "bp shot up", "elevated bp",
        ],
        "domain": "bp",
        "context": "high_bp_event",
    },
    # ── lifestyle / low energy ─────────────────────────────────────────────
    {
        "keywords": [
            "tired", "fatigue", "exhausted", "low energy", "no energy",
            "sluggish", "lethargic",
        ],
        "domain": "lifestyle",
        "context": "low_energy",
    },
    # ── glucose / daily high-carb habit ───────────────────────────────────
    {
        "keywords": [
            "eat rice daily", "rice daily", "eat rice every day",
            "rice every day", "rice every meal",
        ],
        "domain": "glucose",
        "context": "high_carb_habit",
    },
    # ── lifestyle / late eating ────────────────────────────────────────────
    {
        "keywords": [
            "eat late at night", "late at night", "eating late",
            "eat late", "dinner late", "late dinner", "midnight snack",
        ],
        "domain": "lifestyle",
        "context": "late_eating",
    },
    # ── lifestyle / low movement ───────────────────────────────────────────
    {
        "keywords": [
            "should walk but don't", "should walk but dont",
            "don't walk", "dont walk", "never walk", "no walking",
            "can't walk", "cant walk",
        ],
        "domain": "lifestyle",
        "context": "low_movement",
    },
    # ── bp / high salt intake ──────────────────────────────────────────────
    {
        "keywords": [
            "too much salt", "salty food", "eat salty", "high salt",
            "love salt", "lot of salt",
        ],
        "domain": "bp",
        "context": "high_salt",
    },
    # ── glucose / variable sugar ───────────────────────────────────────────
    {
        "keywords": [
            "sometimes high sometimes normal", "sometimes high sometimes low",
            "fluctuating sugar", "sugar fluctuates",
        ],
        "domain": "glucose",
        "context": "glucose_variability",
    },
]


def detect_context_pattern(query: str) -> dict:
    """
    Scan query for known context patterns.
    Longer / more specific keywords are checked first within each rule.
    Returns the first matching {"domain": ..., "context": ...} or {}.
    """
    q = query.lower()
    for rule in PATTERN_RULES:
        # sort descending by length so multi-word phrases win over single words
        sorted_kw = sorted(rule["keywords"], key=len, reverse=True)
        if any(k in q for k in sorted_kw):
            return {"domain": rule["domain"], "context": rule["context"]}
    return {}
