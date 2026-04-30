import pytest

TEST_CASES = [
    {
        "input": "ate pizza lol sugar probably high now what",
        "expected_action": "walk_10min_now",
        "expected_keyword": "walk",
    },
    {
        "input": "had dessert feel guilty what should i do now",
        "expected_action": "walk_10min_now",
        "expected_keyword": "walk",
    },
    {
        "input": "chicken 300g rice 50g",
        "expected_action": "analyze_meal",
        "expected_keyword": "analyze",
    },
    {
        "input": "i know i should walk but i dont",
        "expected_action": "avoid_simple_carbs_now",
        "expected_keyword": "avoid",
    },
    {
        "input": "my sugar is sometimes high sometimes normal what does that mean",
        "expected_action": "walk_10min_now",
        "expected_keyword": "walk",
    },
]


def call_api(query):
    from fastapi.testclient import TestClient
    from backend.main import app

    client = TestClient(app)
    response = client.post("/query", json={"query": query, "voice": False})
    return response.json()


@pytest.mark.parametrize("case", TEST_CASES)
def test_action_engine(case):
    response = call_api(case["input"])

    text = response.get("message", "").lower()
    structured = response.get("structured", {})

    # ✅ 1. Action must be correct
    assert case["expected_action"] in structured.get(
        "top_actions", []
    ), f"Wrong action for input: {case['input']}"

    # ✅ 2. Action must appear in text (enforcement)
    assert case["expected_keyword"] in text, f"Action missing in text: {case['input']}"

    # ✅ 3. No empty actions
    assert (
        len(structured.get("top_actions", [])) > 0
    ), f"No action returned for input: {case['input']}"
