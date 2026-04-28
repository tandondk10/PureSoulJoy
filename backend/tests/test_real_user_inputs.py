"""
Real user input tests (messy, emotional, ambiguous).

Validates:
- correct domain classification
- lever selection quality
- LLM fidelity to structured actions
- no generic advice
- actionable responses

Run with:
USE_MOCK=false USE_LLM=true python3 -m pytest backend/tests/test_real_user_inputs.py -v
"""

import pytest
from fastapi.testclient import TestClient

from backend.main import app

client = TestClient(app)


# ---------- helpers ----------

GENERIC_PHRASES = [
    "healthy lifestyle",
    "take care",
    "balanced diet",
    "stay healthy",
]

ACTION_KEYWORDS = ["walk", "drink", "eat", "avoid", "move", "add", "reduce"]


def assert_basic_invariants(resp):
    assert "chat" in resp
    assert "screen" in resp
    assert "structured" in resp

    structured = resp["structured"]
    screen = resp["screen"]

    # max 3 actions
    assert len(structured["top_actions"]) <= 3

    # unique levers
    assert len(set(structured["levers"])) == len(structured["levers"])

    # screen consistency
    assert screen["top_actions"] == structured["top_actions"]

    # chat consistency
    assert resp["chat"] == resp["text"]


def assert_llm_fidelity(resp):
    chat = resp["chat"].lower()
    actions = resp["structured"]["top_actions"]

    # every structured action should appear in chat (keyword match)
    for action in actions:
        keyword = action.split("_")[0]
        assert keyword in chat, f"LLM missed action keyword: {keyword}"


def assert_not_generic(chat):
    chat = chat.lower()
    for phrase in GENERIC_PHRASES:
        assert phrase not in chat, f"Generic phrase detected: {phrase}"


def assert_actionable(chat):
    chat = chat.lower()
    assert any(k in chat for k in ACTION_KEYWORDS), "No actionable verb found"


# ---------- test cases ----------


@pytest.mark.parametrize(
    "query, expected_domain, must_have_levers",
    [
        # 1. pizza spike
        (
            "ate pizza lol sugar probably high now what",
            "glucose",
            ["movement", "fiber"],
        ),
        # 2. dessert guilt
        (
            "had dessert feel guilty what should i do now",
            "glucose",
            ["movement", "fiber"],
        ),
        # 3. post-meal crash
        ("i feel sleepy after lunch every day", "glucose", ["protein", "fiber"]),
        # 4. stress bp
        ("feeling stressed my bp might be high", "bp", ["recovery"]),
        # 5. salty food
        ("had salty food today should i worry", "bp", ["recovery", "movement"]),
        # 6. vague fatigue
        ("i feel tired all the time", "lifestyle", []),
        # 7. rice daily
        ("i eat rice daily is that bad", "glucose", ["fiber", "protein"]),
        # 8. late dinner
        ("i eat late at night is that a problem", "lifestyle", ["timing"]),
        # 9. motivation gap
        ("i know i should walk but i dont", "lifestyle", ["movement"]),
        # 10. glucose variability
        (
            "my sugar is sometimes high sometimes normal what does that mean",
            "glucose",
            ["monitoring"],
        ),
    ],
)
def test_real_user_inputs(query, expected_domain, must_have_levers):

    resp = client.post("/query", json={"query": query}).json()

    # ---------- core invariants ----------
    assert_basic_invariants(resp)

    # ---------- domain ----------
    assert resp["screen"]["domain"] == expected_domain

    # ---------- lever quality ----------
    levers = resp["structured"]["levers"]

    if must_have_levers:
        assert any(
            l in levers for l in must_have_levers
        ), f"Missing critical lever. Got: {levers}"

    # ---------- LLM fidelity ----------
    assert_llm_fidelity(resp)

    # ---------- no fluff ----------
    assert_not_generic(resp["chat"])

    # ---------- actionable ----------
    assert_actionable(resp["chat"])
