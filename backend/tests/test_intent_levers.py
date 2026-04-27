import requests

URL = "http://localhost:8000/query"

LEVER_CASES = [
    ("Does fiber help sugar?", "food", "fiber_first"),
    ("Should I eat protein first?", "food", "protein_first"),
    ("Is pairing carbs with nuts good?", "food", "pairing"),
    ("Should I walk after meals?", "movement", "post_meal_walk"),
    ("Is brisk walking better?", "movement", "brisk_walk"),
    ("How much should I move daily?", "movement", None),
    ("When should I eat dinner?", "timing", "early_dinner"),
    ("How long gap between meals?", "timing", "meal_spacing"),
    ("Should I delay my next meal?", "timing", "delay_meal"),
    ("Does stress affect BP?", "recovery", "stress_control"),
    ("Should I do breathing for BP?", "recovery", "breathing"),
    ("How important is sleep?", "recovery", "sleep"),
    ("Should I check sugar again?", "monitoring", "check_again"),
    ("How to track glucose patterns?", "monitoring", "track_pattern"),
    ("Compare before and after meal sugar?", "monitoring", "pre_post_compare"),
    ("Does vinegar help sugar?", "enhancers", "vinegar"),
    ("Is cinnamon useful?", "enhancers", "cinnamon"),
    ("I feel tired", "lifestyle", None),
    ("I want to stay healthy", "lifestyle", None),
]

print("\n=== API Lever Coverage Tests ===")

passed = failed = 0

for q, exp_lever, exp_sub in LEVER_CASES:
    try:
        resp = requests.post(URL, json={"query": q, "voice": False}, timeout=5)

        if resp.status_code != 200:
            print(f"FAIL | {q!r:40} | HTTP {resp.status_code}")
            failed += 1
            continue

        data = resp.json()

        lever = data.get("lever")
        sub = data.get("sub_lever")

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

    except Exception as e:
        failed += 1
        print(f"ERROR | {q!r:40} | {e}")

print()
print(f"API Lever Tests: {passed}/{passed+failed} passed")
