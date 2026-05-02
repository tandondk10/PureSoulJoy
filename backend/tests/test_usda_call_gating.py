import pytest
from fastapi.testclient import TestClient
import main
from main import app

client = TestClient(app)


def test_usda_not_called_when_trusted_food_exists(monkeypatch):
    calls = []

    def fake_call_usda(food):
        calls.append(food)
        return None

    monkeypatch.setattr(main, "call_usda", fake_call_usda)

    resp = client.post("/query", json={"query": "chicken salad"}).json()

    assert resp["has_food"] is True
    assert resp["needs_clarification"] is False
    assert calls == [], f"USDA must not be called when trusted food exists: {calls}"


def test_usda_not_called_when_known_general_exists(monkeypatch):
    calls = []

    def fake_call_usda(food):
        calls.append(food)
        return None

    monkeypatch.setattr(main, "call_usda", fake_call_usda)

    resp = client.post("/query", json={"query": "sag dal"}).json()

    assert resp["has_food"] is True
    assert resp["needs_clarification"] is False
    assert calls == [], f"USDA must not be called when known_general food exists: {calls}"


def test_usda_called_for_pure_unresolved(monkeypatch):
    # ackee is a real food not present in any local classification list
    calls = []

    def fake_call_usda(food):
        calls.append(food)
        return {
            "calories": 167,
            "carbs_g": 9,
            "protein_g": 3,
            "fat_g": 15,
        }

    monkeypatch.setattr(main, "call_usda", fake_call_usda)

    resp = client.post("/query", json={"query": "ackee"}).json()

    assert "ackee" in calls, f"USDA must be called for unresolved token: {calls}"
    assert resp["has_food"] is True
    assert resp["needs_clarification"] is False


def test_usda_failure_for_unresolved_leads_to_clarification(monkeypatch):
    calls = []

    def fake_call_usda(food):
        calls.append(food)
        return None

    monkeypatch.setattr(main, "call_usda", fake_call_usda)

    resp = client.post("/query", json={"query": "xyzabc"}).json()

    assert "xyzabc" in calls, f"USDA must be called for unresolved token: {calls}"
    assert resp["needs_clarification"] is True
    assert resp.get("clarification_type") == "unknown_food"


def test_no_duplicate_usda_calls_for_same_token(monkeypatch):
    calls = []

    def fake_call_usda(food):
        calls.append(food)
        return None

    monkeypatch.setattr(main, "call_usda", fake_call_usda)

    client.post("/query", json={"query": "xyzabc xyzabc"}).json()

    assert calls.count("xyzabc") <= 1, f"Duplicate USDA calls detected: {calls}"
