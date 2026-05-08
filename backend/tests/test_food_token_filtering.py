import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


@pytest.mark.parametrize("query", [
    "what do i need to do to reduce my bp",
    "what do i need to do to reduce my sugar",
    "how do i lower a1c",
    "ldl is high what to do",
    "blood pressure 140/90",
])
def test_non_food_health_words_do_not_become_unknown_foods(query):
    resp = client.post("/query", json={"query": query}).json()

    assert "unknown_foods" in resp, resp
    assert isinstance(resp["unknown_foods"], list), resp
    assert resp["unknown_foods"] == [], resp
    assert resp.get("has_food") is False, resp


@pytest.mark.parametrize("query, forbidden_unknown", [
    ("pizza after workout", "workout"),
    ("avocado toast for cholesterol", "cholesterol"),
])
def test_context_words_do_not_become_unknown_foods_when_food_exists(query, forbidden_unknown):
    resp = client.post("/query", json={"query": query}).json()

    assert "unknown_foods" in resp, resp
    assert forbidden_unknown not in resp["unknown_foods"], resp


@pytest.mark.parametrize("query", [
    "unknownfood",
    "mystery bowl",
    "special snack",
])
def test_real_unknown_food_candidates_still_clarify(query):
    resp = client.post("/query", json={"query": query}).json()

    assert resp.get("needs_clarification") is True, resp
    assert len(resp.get("unknown_foods", [])) >= 1, resp
    assert resp["chat"].count("?") == 1, resp


@pytest.mark.parametrize("query", [
    "juice",
    "coke",
    "soda",
    "ice cream",
    "pizza and coke",
    "rice and dal",
])
def test_known_foods_still_route(query):
    resp = client.post("/query", json={"query": query}).json()

    assert resp.get("has_food") is True, resp
    assert resp.get("needs_clarification") is not True, resp
