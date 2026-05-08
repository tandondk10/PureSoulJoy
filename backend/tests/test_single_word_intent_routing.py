import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


@pytest.mark.parametrize("query", ["fat", "carbs", "meal", "food"])
def test_single_word_intents_are_contract_safe(query):
    resp = client.post("/query", json={"query": query}).json()

    for field in [
        "chat", "text", "domain", "has_food", "foods",
        "context_domain", "needs_clarification", "unknown_foods"
    ]:
        assert field in resp, f"Missing {field}: {resp}"

    assert resp["chat"] == resp["text"]
    assert resp["domain"] == "lifestyle"
    assert resp["has_food"] is False
    assert resp["foods"] == []
    assert resp["needs_clarification"] is False
    assert resp["unknown_foods"] == []
    assert len(resp["chat"]) > 0


@pytest.mark.parametrize("query, expected_words", [
    ("fat",   ["saturated", "fiber"]),
    ("carbs", ["glucose", "protein", "fiber"]),
    ("meal",  ["meal", "carbs", "protein"]),
    ("food",  ["food", "action"]),
])
def test_single_word_intents_are_actionable(query, expected_words):
    resp = client.post("/query", json={"query": query}).json()
    chat = resp["chat"].lower()

    for word in expected_words:
        assert word in chat, f"Expected {word!r} in response for {query!r}: {chat}"

    assert "please say a full sentence" not in chat
    assert "cannot answer" not in chat
