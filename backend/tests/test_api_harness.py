"""
API Test Harness — Chat + Screen Modes
Validates the full backend pipeline via /query using FastAPI TestClient.

Run:  cd /Users/deepaktandon/Projects/PureSoulJoy
      USE_MOCK=true python3 -m pytest backend/tests/test_api_harness.py -v
"""

import os
import sys

# Force mock mode so no LLM calls are made during testing
os.environ["USE_MOCK"] = "true"
os.environ["USE_LLM"] = "false"
os.environ.setdefault("OPENAI_API_KEY", "test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest
from fastapi.testclient import TestClient
import main as M

client = TestClient(M.app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def post_query(query: str, lite: bool = False) -> dict:
    resp = client.post("/query", json={"query": query, "voice": False, "lite": lite})
    assert resp.status_code == 200, f"HTTP {resp.status_code} for query {query!r}"
    return resp.json()


def _text_field(data: dict) -> str:
    """The keyboard path exposes text as 'message'; build_response uses 'text'."""
    return data.get("text") or data.get("message", "")


def _check_chat(data: dict, case: str) -> list[str]:
    """Return list of failure reasons for chat mode validation."""
    failures = []
    text = _text_field(data)
    chat = data.get("chat", "")
    if chat != text:
        failures.append(f"chat != text/message (chat={chat!r}, text={text!r})")
    if not chat:
        failures.append("chat is empty")
    return failures


def _check_screen(data: dict, case: str) -> list[str]:
    """Return list of failure reasons for screen mode validation."""
    failures = []
    screen = data.get("screen", {})
    structured = data.get("structured", {})

    if not screen:
        failures.append("screen is missing or empty")
        return failures

    if not structured:
        failures.append("structured is missing or empty")
        return failures

    # screen.top_actions must equal structured.top_actions
    s_actions = screen.get("top_actions", [])
    st_actions = structured.get("top_actions", [])
    if s_actions != st_actions:
        failures.append(f"screen.top_actions != structured.top_actions ({s_actions} vs {st_actions})")

    # max 3 actions
    if len(s_actions) > 3:
        failures.append(f"screen has {len(s_actions)} actions (max 3)")

    # unique levers
    levers = screen.get("levers", [])
    if len(levers) != len(set(levers)):
        failures.append(f"duplicate levers in screen: {levers}")

    # screen must have required keys
    for key in ("title", "domain", "top_actions", "levers"):
        if key not in screen:
            failures.append(f"screen missing key: {key!r}")

    return failures


def _check_unified(data: dict, case: str) -> list[str]:
    """Return list of failure reasons for unified mode validation."""
    failures = _check_chat(data, case) + _check_screen(data, case)

    structured = data.get("structured", {})
    screen = data.get("screen", {})

    # same source: screen.top_actions == structured.top_actions
    if structured and screen:
        if structured.get("top_actions") != screen.get("top_actions"):
            failures.append("chat and screen derive from different structured sources")

    # overall max 3 actions in structured
    top = structured.get("top_actions", [])
    if len(top) > 3:
        failures.append(f"structured has {len(top)} actions (max 3)")

    # unique levers in structured
    levers = structured.get("levers", [])
    if len(levers) != len(set(levers)):
        failures.append(f"duplicate levers in structured: {levers}")

    return failures


def _check_domain(data: dict, expected_domain: str) -> list[str]:
    got = data.get("domain") or data.get("structured", {}).get("domain")
    if got != expected_domain:
        return [f"expected domain={expected_domain!r}, got {got!r}"]
    return []


def _run(case: str, query: str, mode: str, expected_domain: str = None,
         expected_levers: list = None, lite: bool = False):
    """Core runner — collects all failures and returns (passed: bool, reasons: list)."""
    data = post_query(query, lite=lite)

    failures = []

    if mode == "chat":
        failures += _check_chat(data, case)
    elif mode == "screen":
        failures += _check_screen(data, case)
    else:
        failures += _check_unified(data, case)

    if expected_domain:
        failures += _check_domain(data, expected_domain)

    if expected_levers:
        screen_levers = data.get("screen", {}).get("levers", [])
        for lv in expected_levers:
            if lv not in screen_levers:
                failures.append(f"expected lever {lv!r} not found in screen.levers {screen_levers}")

    return len(failures) == 0, failures


def assert_case(case: str, query: str, mode: str = "unified",
                expected_domain: str = None, expected_levers: list = None,
                lite: bool = False):
    """Used in parametrized tests — raises AssertionError with structured output."""
    passed, reasons = _run(case, query, mode, expected_domain, expected_levers, lite)
    if not passed:
        reason_str = "; ".join(reasons)
        raise AssertionError(
            f"\nCASE: {case}\nSTATUS: FAIL\nREASON: {reason_str}"
        )


# ---------------------------------------------------------------------------
# Test Cases — organized by domain
# ---------------------------------------------------------------------------

# ── GLUCOSE ─────────────────────────────────────────────────────────────────

def test_glucose_post_meal_unified():
    assert_case("glucose_post_meal", "My sugar is high after lunch",
                mode="unified", expected_domain="glucose")

def test_glucose_crash_unified():
    assert_case("glucose_crash", "Sugar crash",
                mode="unified", expected_domain="glucose")

def test_glucose_fasting_unified():
    assert_case("glucose_fasting", "My fasting glucose is elevated",
                mode="unified", expected_domain="glucose")

def test_glucose_variability_unified():
    assert_case("glucose_variability", "My glucose is fluctuating a lot",
                mode="unified", expected_domain="glucose")

def test_glucose_prediabetic_unified():
    assert_case("glucose_prediabetic", "Prediabetic",
                mode="unified", expected_domain="glucose")

# ── BP ──────────────────────────────────────────────────────────────────────

def test_bp_high_unified():
    assert_case("bp_high", "My blood pressure is high",
                mode="unified", expected_domain="bp")

def test_bp_stress_unified():
    assert_case("bp_stress", "I feel very stressed about my BP",
                mode="unified", expected_domain="bp")

def test_bp_systolic_unified():
    assert_case("bp_systolic", "Systolic is elevated",
                mode="unified", expected_domain="bp")

def test_bp_after_meal_unified():
    assert_case("bp_after_meal", "After lunch my blood pressure is high",
                mode="unified", expected_domain="bp")

# ── CHOLESTEROL ──────────────────────────────────────────────────────────────

def test_cholesterol_high_unified():
    assert_case("cholesterol_high", "My cholesterol is high",
                mode="unified", expected_domain="cholesterol")

def test_cholesterol_ldl_unified():
    assert_case("cholesterol_ldl", "LDL is high",
                mode="unified", expected_domain="cholesterol")

def test_cholesterol_hdl_unified():
    assert_case("cholesterol_hdl", "Low HDL",
                mode="unified", expected_domain="cholesterol")

def test_cholesterol_lipid_variability_unified():
    assert_case("cholesterol_lipid_variability", "Lipid variability",
                mode="unified", expected_domain="cholesterol")

# ── LIFESTYLE ────────────────────────────────────────────────────────────────

def test_lifestyle_general_health_unified():
    assert_case("general_health", "I want to stay healthy",
                mode="unified", expected_domain="lifestyle")

def test_lifestyle_sleep_unified():
    assert_case("sleep_issue", "I slept badly last night",
                mode="unified", expected_domain="lifestyle")

def test_lifestyle_stress_unified():
    assert_case("lifestyle_stress", "I feel stressed today",
                mode="unified")

# ── LEVER COVERAGE ───────────────────────────────────────────────────────────

def test_lever_fiber_first():
    assert_case("lever_fiber_first", "Does fiber help lower blood sugar?",
                mode="unified", expected_domain="glucose")

def test_lever_protein_first():
    assert_case("lever_protein_first", "Should I eat protein first before carbs?",
                mode="unified")

def test_lever_post_meal_walk():
    assert_case("lever_post_meal_walk", "Should I walk after meals to lower glucose?",
                mode="unified", expected_domain="glucose")

def test_lever_timing_early_dinner():
    assert_case("lever_timing", "When should I eat dinner?",
                mode="unified")

def test_lever_breathing_recovery():
    assert_case("lever_breathing", "Should I do breathing exercises for blood pressure?",
                mode="unified", expected_domain="bp")

def test_lever_check_again_monitoring():
    assert_case("lever_monitoring", "Should I check my sugar again?",
                mode="unified")


# ---------------------------------------------------------------------------
# Chat Mode tests
# ---------------------------------------------------------------------------

def test_glucose_chat_mode():
    assert_case("glucose_chat", "My blood sugar is high after dinner",
                mode="chat", expected_domain="glucose")

def test_bp_chat_mode():
    assert_case("bp_chat", "My blood pressure is elevated",
                mode="chat", expected_domain="bp")

def test_cholesterol_chat_mode():
    assert_case("cholesterol_chat", "My LDL cholesterol is elevated",
                mode="chat", expected_domain="cholesterol")

def test_lifestyle_chat_mode():
    assert_case("lifestyle_chat", "I want to improve my habits",
                mode="chat")


# ---------------------------------------------------------------------------
# Screen Mode tests
# ---------------------------------------------------------------------------

def test_glucose_screen_mode():
    assert_case("glucose_screen", "Sugar spike after meal",
                mode="screen", expected_domain="glucose")

def test_bp_screen_mode():
    assert_case("bp_screen", "High blood pressure reading",
                mode="screen", expected_domain="bp")

def test_cholesterol_screen_mode():
    assert_case("cholesterol_screen", "Cholesterol is too high",
                mode="screen", expected_domain="cholesterol")

def test_lifestyle_screen_mode():
    assert_case("lifestyle_screen", "How do I improve my lifestyle?",
                mode="screen")


# ---------------------------------------------------------------------------
# Structural invariants — apply across all domains
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("query,domain", [
    ("My sugar spiked after lunch",         "glucose"),
    ("BP is elevated today",                "bp"),
    ("Cholesterol increased",               "cholesterol"),
    ("I want to stay healthy",              "lifestyle"),
])
def test_invariant_max_3_actions(query, domain):
    data = post_query(query)
    structured = data.get("structured", {})
    assert len(structured.get("top_actions", [])) <= 3, (
        f"CASE: max_3_actions ({domain})\nSTATUS: FAIL\n"
        f"REASON: {len(structured.get('top_actions', []))} actions returned"
    )


@pytest.mark.parametrize("query,domain", [
    ("My sugar spiked after lunch",         "glucose"),
    ("BP is elevated today",                "bp"),
    ("Cholesterol increased",               "cholesterol"),
    ("I want to stay healthy",              "lifestyle"),
])
def test_invariant_unique_levers(query, domain):
    data = post_query(query)
    levers = data.get("screen", {}).get("levers", [])
    assert len(levers) == len(set(levers)), (
        f"CASE: unique_levers ({domain})\nSTATUS: FAIL\n"
        f"REASON: duplicate levers: {levers}"
    )


@pytest.mark.parametrize("query,domain", [
    ("My sugar spiked after lunch",         "glucose"),
    ("BP is elevated today",                "bp"),
    ("Cholesterol increased",               "cholesterol"),
    ("I want to stay healthy",              "lifestyle"),
])
def test_invariant_screen_equals_structured(query, domain):
    data = post_query(query)
    assert data.get("screen", {}).get("top_actions") == \
           data.get("structured", {}).get("top_actions"), (
        f"CASE: screen_equals_structured ({domain})\nSTATUS: FAIL\n"
        f"REASON: screen.top_actions != structured.top_actions"
    )


@pytest.mark.parametrize("query,domain", [
    ("My sugar spiked after lunch",         "glucose"),
    ("BP is elevated today",                "bp"),
    ("Cholesterol increased",               "cholesterol"),
    ("I want to stay healthy",              "lifestyle"),
])
def test_invariant_chat_equals_text(query, domain):
    data = post_query(query)
    assert data.get("chat") == _text_field(data), (
        f"CASE: chat_equals_text ({domain})\nSTATUS: FAIL\n"
        f"REASON: chat diverged from text/message"
    )
