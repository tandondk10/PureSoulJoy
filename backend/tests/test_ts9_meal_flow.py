import sys
import os

# Ensure project root is in path
sys.path.append(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from backend.main import process_query
from backend.response.deterministic_meal import build_deterministic_meal_response
from backend.intervention_engine import get_intervention


# -----------------------------------------
# CORE TEST RUNNER
# -----------------------------------------
def run_test_case(name, meal_input, expected_domain=None, expect_food=True):
    print(f"\n=== TEST: {name} ===")

    result = process_query(meal_input)
    response = build_deterministic_meal_response(result, meal_input)

    print("INPUT:", meal_input)
    print("FOODS:", response.get("foods"))
    print("DOMAIN:", response.get("structured", {}).get("domain"))
    print("TEXT:", response.get("text"))

    # ---- ASSERTIONS ----
    if expect_food:
        assert response.get("foods"), f"[FAIL] No foods detected for {name}"

    # 🔥 CRITICAL CONSISTENCY CHECK
    assert response["has_food"] == bool(response["foods"]), \
        f"[FAIL] has_food mismatch for {name}"

    if expected_domain:
        assert response["structured"]["domain"] == expected_domain, \
            f"[FAIL] Expected domain {expected_domain}, got {response['structured']['domain']}"

    print("[PASS]")


# -----------------------------------------
# TS9 TEST SUITE
# -----------------------------------------
def test_ts9_suite():

    # ✅ Balanced meal
    run_test_case(
        name="Chicken + Rice",
        meal_input="chicken rice",
        expected_domain="glucose"
    )

    # ✅ Carb heavy
    run_test_case(
        name="Rice + Dal",
        meal_input="rice dal",
        expected_domain="glucose"
    )

    # ✅ Pure carb spike
    run_test_case(
        name="White Rice Only",
        meal_input="rice",
        expected_domain="glucose"
    )

    # ✅ Fat dominant
    run_test_case(
        name="Butter Cheese",
        meal_input="butter cheese",
        expected_domain="cholesterol"
    )

    # ✅ Mixed unknown
    run_test_case(
        name="Chicken + Unknown",
        meal_input="chicken xyz",
        expect_food=True
    )

    # 🔥 Edge cases
    run_test_case(
        name="Small protein + carb",
        meal_input="little rice and chicken"
    )

    run_test_case(
        name="Junk + valid food",
        meal_input="pizza abcdef"
    )

    run_test_case(
        name="Only unknown",
        meal_input="asdfgh",
        expect_food=False
    )

    # ✅ No food case
    print("\n=== TEST: No Food ===")
    result = process_query("how to reduce sugar")
    response = build_deterministic_meal_response(result, "how to reduce sugar")

    assert response["has_food"] == bool(response["foods"])
    print("[PASS]")


# -----------------------------------------
# ENTRY POINT
# -----------------------------------------
if __name__ == "__main__":
    test_ts9_suite()