import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

REQUIRED_FIELDS = ["chat", "text", "domain", "has_food", "foods", "context_domain"]


def assert_contract(resp):
    for field in REQUIRED_FIELDS:
        assert field in resp, f"Missing field '{field}': {resp}"
    assert resp["chat"] == resp["text"], "chat must equal text"
    assert len(resp["chat"]) > 0, "chat must be non-empty"
    assert "unknown_foods" in resp, f"Missing unknown_foods: {resp}"
    assert isinstance(resp["unknown_foods"], list), f"unknown_foods must be list: {resp}"
    assert isinstance(resp.get("needs_clarification"), bool), f"needs_clarification must be bool: {resp}"


@pytest.mark.parametrize("query", [
    "unknownfood",
    "mystery bowl",
    "special snack",
])
def test_unknown_food_clarification(query):
    resp = client.post("/query", json={"query": query}).json()
    assert_contract(resp)

    assert resp.get("needs_clarification") is True, (
        f"needs_clarification must be True for {query!r}: {resp}"
    )
    assert len(resp["unknown_foods"]) >= 1, f"unknown food should populate unknown_foods: {resp}"

    chat = resp["chat"].lower()
    assert "guess" in chat, f"Expected 'guess' for {query!r}: {chat}"
    assert "carbs" in chat, f"Expected 'carbs' for {query!r}: {chat}"
    assert "protein" in chat, f"Expected 'protein' for {query!r}: {chat}"
    assert "fats" in chat, f"Expected 'fats' for {query!r}: {chat}"
    assert resp["chat"].count("?") == 1, (
        f"Expected exactly one '?' for {query!r}: {resp['chat']}"
    )
    assert "cannot answer" not in chat
    assert "provide more details" not in chat


@pytest.mark.parametrize("query", [
    "juice",
    "coke",
    "soda",
    "ice cream",
])
def test_known_curated_no_clarification(query):
    resp = client.post("/query", json={"query": query}).json()
    assert_contract(resp)

    assert resp.get("has_food") is True, (
        f"has_food must be True for {query!r}"
    )
    assert resp.get("needs_clarification") is not True, (
        f"needs_clarification must not be set for known food {query!r}"
    )
    assert resp["unknown_foods"] == [], f"known food should have no unknown_foods: {resp}"

    chat = resp["chat"].lower()
    assert "guess" not in chat, (
        f"Should not say 'guess' for known food {query!r}: {chat}"
    )
    assert not ("carbs" in chat and "protein" in chat and "fats" in chat), (
        f"Known food should not ask macro clarification for {query!r}: {chat}"
    )


def test_mixed_known_unknown():
    resp = client.post("/query", json={"query": "juice and mystery snack"}).json()
    assert_contract(resp)

    assert resp.get("has_food") is True, "has_food must be True when juice is present"

    chat = resp["chat"].lower()

    assert any(w in chat for w in ["juice", "sugar", "glucose", "carb"]), (
        f"Chat must reflect juice context: {chat}"
    )

    # V2: known food present (juice) → food engine handles it, no clarification question.
    # unknown_foods is empty when needs_clarification=False.
    assert resp.get("needs_clarification") is not True, \
        f"needs_clarification must be False when known food is present: {resp}"
    assert resp["unknown_foods"] == [], \
        f"unknown_foods must be empty when needs_clarification=False: {resp}"
