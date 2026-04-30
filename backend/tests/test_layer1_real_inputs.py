import pytest
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)

ACTION_WORDS = ["walk", "add", "reduce", "avoid", "move", "keep", "use", "pair"]
GENERIC_PHRASES = [
    "healthy lifestyle",
    "stay healthy",
    "balanced diet",
]


def assert_basic(resp):
    assert "chat" in resp, f"Missing 'chat': {resp}"
    assert "text" in resp, f"Missing 'text': {resp}"
    assert "domain" in resp, f"Missing 'domain': {resp}"
    assert "has_food" in resp, f"Missing 'has_food': {resp}"
    assert resp["chat"] == resp["text"], f"chat != text: {resp}"
    assert len(resp["chat"]) > 0, f"Empty chat: {resp}"


def assert_actionable(chat):
    lower = chat.lower()
    assert any(w in lower for w in ACTION_WORDS), f"Not actionable: {chat}"


def assert_not_generic(chat):
    lower = chat.lower()
    for phrase in GENERIC_PHRASES:
        assert phrase not in lower, f"Generic phrase detected: {phrase!r} in {chat!r}"


@pytest.mark.parametrize(
    "query, allowed_domains, expect_food",
    [
        # Pure food — FOOD_DATA-backed detection
        ("pizza and coke",    {"glucose"},                                          True),
        ("avocado toast",     {"cholesterol"},                                      True),
        ("butter and cheese", {"cholesterol"},                                      True),
        ("rice and dal",      {"glucose"},                                          True),
        # chicken is FOOD_DATA-backed via synonym; salad unknown — gate still satisfied by chicken
        ("chicken salad",     {"cholesterol", "balanced", "lifestyle", "glucose"},  True),

        # Food + condition context
        ("pizza and coke. my A1C is 6.0",   {"glucose"},                True),
        ("avocado toast for cholesterol",    {"cholesterol"},            True),
        ("butter chicken. LDL high",        {"cholesterol", "glucose"}, True),

        # Food + lifestyle context
        ("pizza after workout",   {"glucose", "balanced"}, True),

        # No food — text-only condition queries
        ("how do I lower A1C",       {"glucose"},     False),
        ("LDL is high what to do",   {"cholesterol"}, False),
        ("blood pressure 140/90",    {"bp"},          False),

        # Curated high-impact food/drink terms → food routing
        ("juice",      {"glucose"}, True),
        ("coke",       {"glucose"}, True),
        ("soda",       {"glucose"}, True),
        ("ice cream",  {"glucose"}, True),
        # Non-food edge cases — text path
        ("fat",    {"lifestyle"}, False),
        ("carbs",  {"lifestyle"}, False),
        ("meal",   {"lifestyle"}, False),
        ("food",   {"lifestyle"}, False),
    ],
)
def test_layer1_core(query, allowed_domains, expect_food):
    resp = client.post("/query", json={"query": query}).json()

    assert_basic(resp)

    assert resp["domain"] in allowed_domains, (
        f"{query!r} -> domain={resp['domain']!r} not in {allowed_domains}. resp={resp}"
    )

    assert resp["has_food"] == expect_food, (
        f"{query!r} has_food mismatch: got {resp['has_food']}, expected {expect_food}. resp={resp}"
    )

    assert_actionable(resp["chat"])
    assert_not_generic(resp["chat"])


@pytest.mark.parametrize(
    "query, expected_domain, expected_context",
    [
        ("pizza and coke. my A1C is 6.0",  "glucose",     "glucose"),
        ("avocado toast for cholesterol",   "cholesterol", "cholesterol"),
        ("pizza after workout",             None,          "lifestyle"),
        ("how do I lower A1C",             "glucose",     None),
    ],
)
def test_layer1_context_domain(query, expected_domain, expected_context):
    resp = client.post("/query", json={"query": query}).json()

    assert_basic(resp)

    if expected_domain:
        assert resp["domain"] == expected_domain, (
            f"{query!r} domain mismatch: {resp['domain']!r} != {expected_domain!r}"
        )

    assert resp.get("context_domain") == expected_context, (
        f"{query!r} context_domain: {resp.get('context_domain')!r} != {expected_context!r}"
    )
