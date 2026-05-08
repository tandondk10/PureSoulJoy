import pytest
from fastapi.testclient import TestClient
import main
from main import app

client = TestClient(app)


def call_query(query: str) -> dict:
    return client.post("/query", json={"query": query}).json()


@pytest.mark.parametrize("query", [
    "beef turnip",
    "beef and turnip",
])
def test_known_general_food_routes_without_clarification(query):
    resp = call_query(query)

    assert resp.get("has_food") is True, f"has_food must be True for {query!r}: {resp}"
    assert resp.get("needs_clarification") is not True, f"must not clarify for {query!r}: {resp}"
    assert resp.get("unknown_foods") == [], f"unknown_foods must be [] for {query!r}: {resp}"
    assert resp.get("message") is None, f"message must be null for {query!r}: {resp}"


@pytest.mark.parametrize("query", [
    "sag dal",
    "saag",
    "okra rice",
    "spinach paneer",
])
def test_cultural_food_does_not_clarify(query):
    resp = call_query(query)

    assert resp.get("has_food") is True, f"has_food must be True for {query!r}: {resp}"
    assert resp.get("needs_clarification") is not True, f"must not clarify for {query!r}: {resp}"
    assert resp.get("unknown_foods") == [], f"unknown_foods must be [] for {query!r}: {resp}"


def test_api_confirmed_food_routes_as_food(monkeypatch):
    monkeypatch.setattr(
        main,
        "validate_unresolved_foods_with_api",
        lambda unresolved: ["turnip"] if "turnip" in unresolved else [],
    )

    resp = call_query("turnip")

    assert resp.get("has_food") is True, f"has_food must be True: {resp}"
    assert resp.get("needs_clarification") is not True, f"must not clarify: {resp}"
    assert resp.get("unknown_foods") == [], f"unknown_foods must be []: {resp}"


def test_truly_unknown_clarifies_after_api_fails(monkeypatch):
    monkeypatch.setattr(
        main,
        "validate_unresolved_foods_with_api",
        lambda unresolved: [],
    )

    resp = call_query("xyzabc")

    assert resp.get("needs_clarification") is True, f"must clarify for unknown: {resp}"
    assert resp.get("clarification_type") == "unknown_food", resp
    assert len(resp.get("unknown_foods", [])) >= 1, f"unknown_foods must be non-empty: {resp}"


def test_message_is_null_for_general_food():
    resp = call_query("beef turnip")
    assert resp.get("message") is None, f"message must be null: {resp}"


@pytest.mark.parametrize("query", [
    "juice", "coke", "soda", "ice cream",
    "pizza and coke", "rice and dal", "chicken salad",
])
def test_known_foods_still_route_correctly(query):
    resp = call_query(query)
    assert resp.get("has_food") is True, f"has_food must be True for {query!r}: {resp}"
    assert resp.get("needs_clarification") is not True, f"must not clarify for {query!r}: {resp}"
    assert resp.get("message") is None, f"message must be null for {query!r}: {resp}"
