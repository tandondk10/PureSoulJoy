import requests
from backend.main import build_intent, detect_context

URL = "http://localhost:8000/query"

# ---- Lever + Sub-Lever Coverage Tests ----

LEVER_CASES = [
    # FOOD
    ("Does fiber help sugar?", "food", "fiber_first"),
    ("Should I eat protein first?", "food", "protein_first"),
    ("Is pairing carbs with nuts good?", "food", "pairing"),
    # MOVEMENT
    ("Should I walk after meals?", "movement", "post_meal_walk"),
    ("Is brisk walking better?", "movement", "brisk_walk"),
    ("How much should I move daily?", "movement", None),
    # TIMING
    ("When should I eat dinner?", "timing", "early_dinner"),
    ("How long gap between meals?", "timing", "meal_spacing"),
    ("Should I delay my next meal?", "timing", "delay_meal"),
    # RECOVERY
    ("Does stress affect BP?", "recovery", "stress_control"),
    ("Should I do breathing for BP?", "recovery", "breathing"),
    ("How important is sleep?", "recovery", "sleep"),
    # MONITORING (critical new coverage)
    ("Should I check sugar again?", "monitoring", "check_again"),
    ("How to track glucose patterns?", "monitoring", "track_pattern"),
    ("Compare before and after meal sugar?", "monitoring", "pre_post_compare"),
    # ENHANCERS
    ("Does vinegar help sugar?", "enhancers", "vinegar"),
    ("Is cinnamon useful?", "enhancers", "cinnamon"),
    # FALLBACK (lifestyle)
    ("I feel tired", "lifestyle", None),
    ("I want to stay healthy", "lifestyle", None),
]

print("\n=== Lever Coverage Tests ===")

passed = failed = 0

for q, exp_lever, exp_sub in LEVER_CASES:
    intent = build_intent(q, False, detect_context(q))
    lever = intent.get("lever")
    sub = intent.get("sub_lever")

    ok_l = lever == exp_lever
    ok_s = (exp_sub is None) or (sub == exp_sub)
    ok = ok_l and ok_s

    if ok:
        passed += 1
        print(f"PASS | {q!r:40} | lever={lever} sub={sub}")
    else:
        failed += 1
        print(
            f"FAIL | {q!r:40} | lever={lever}(exp={exp_lever}) sub={sub}(exp={exp_sub})"
        )

print()
print(f"Lever Tests: {passed}/{passed+failed} passed")
