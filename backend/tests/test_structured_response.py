"""
Tests for the unified structured response pipeline.

Imports pure functions directly from main — no server, no exec, no LLM calls.
Run with:  cd /Users/deepaktandon/Projects/PureSoulJoy && python -m pytest backend/tests/test_structured_response.py -v
"""
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Prevent LLM calls during import
os.environ.setdefault("USE_LLM", "false")
os.environ.setdefault("USE_MOCK", "false")
os.environ.setdefault("OPENAI_API_KEY", "test")

import main as M


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

def _intent(domain, need, lever, sub_lever, interventions):
    return {
        "domain": domain,
        "need": need,
        "lever": lever,
        "sub_lever": sub_lever,
        "interventions": interventions,
        "tool": "llm_full",
    }


def _ctx(after_meal=False, high=False, low=False, unstable=False):
    return {"after_meal": after_meal, "high": high, "low": low, "unstable": unstable}


GLUCOSE_INTENT = _intent(
    "glucose", "intervention", "movement", "post_meal_walk",
    ["walk_10min_now", "drink_water_now", "next_meal_add_protein_and_fiber"],
)

BP_INTENT = _intent(
    "bp", "intervention", "recovery", None,
    ["slow_deep_breathing", "sit_and_rest_now", "reduce_salt_today"],
)

CHOLESTEROL_INTENT = _intent(
    "cholesterol", "guidance", "food", "fiber_first",
    ["avoid_saturated_fat_today", "add_soluble_fiber_to_meal", "take_a_brisk_walk"],
)

LIFESTYLE_INTENT = _intent(
    "lifestyle", "education", "food", None,
    ["balanced_diet", "regular_activity", "manage_stress"],
)


# ---------------------------------------------------------------------------
# build_structured_response
# ---------------------------------------------------------------------------

def test_structured_has_required_keys():
    s = M.build_structured_response(GLUCOSE_INTENT, _ctx())
    for key in ("domain", "need", "lever", "sub_lever", "top_actions", "levers", "context"):
        assert key in s, f"missing key: {key}"


def test_structured_max_3_actions():
    for intent in [GLUCOSE_INTENT, BP_INTENT, CHOLESTEROL_INTENT, LIFESTYLE_INTENT]:
        s = M.build_structured_response(intent, _ctx())
        assert len(s["top_actions"]) <= 3, f"expected ≤3 actions, got {len(s['top_actions'])}"


def test_structured_all_levers_unique():
    for intent in [GLUCOSE_INTENT, BP_INTENT, CHOLESTEROL_INTENT, LIFESTYLE_INTENT]:
        s = M.build_structured_response(intent, _ctx())
        levers = s["levers"]
        assert len(levers) == len(set(levers)), (
            f"duplicate levers for domain={intent['domain']}: {levers}"
        )


def test_structured_levers_match_top_actions():
    """Each entry in levers must correspond to its action in top_actions."""
    s = M.build_structured_response(GLUCOSE_INTENT, _ctx())
    for action, lever in zip(s["top_actions"], s["levers"]):
        expected = M._ACTION_LEVER.get(action)
        if expected is not None:
            assert lever == expected, (
                f"action {action!r} mapped to lever {lever!r}, expected {expected!r}"
            )


def test_structured_domain_preserved():
    for intent in [GLUCOSE_INTENT, BP_INTENT, CHOLESTEROL_INTENT, LIFESTYLE_INTENT]:
        s = M.build_structured_response(intent, _ctx())
        assert s["domain"] == intent["domain"]


def test_structured_context_passed_through():
    ctx = _ctx(after_meal=True, high=True)
    s = M.build_structured_response(GLUCOSE_INTENT, ctx)
    assert s["context"]["after_meal"] is True
    assert s["context"]["high"] is True


def test_structured_empty_interventions_uses_default_levers():
    # No context_name and no interventions → DEFAULT_LEVERS actions are used
    intent = _intent("glucose", "education", "food", None, [])
    s = M.build_structured_response(intent, _ctx())
    assert len(s["top_actions"]) >= 1, "expected at least one default action"
    assert len(s["top_actions"]) <= 3
    assert len(s["levers"]) == len(set(s["levers"])), "levers must be unique"


# ---------------------------------------------------------------------------
# format_screen_response
# ---------------------------------------------------------------------------

def test_screen_has_required_keys():
    s = M.build_structured_response(GLUCOSE_INTENT, _ctx())
    screen = M.format_screen_response(s)
    for key in ("title", "domain", "top_actions", "levers"):
        assert key in screen, f"missing key in screen: {key}"


def test_screen_top_actions_equals_structured():
    s = M.build_structured_response(GLUCOSE_INTENT, _ctx())
    screen = M.format_screen_response(s)
    assert screen["top_actions"] == s["top_actions"]


def test_screen_levers_equals_structured():
    s = M.build_structured_response(BP_INTENT, _ctx())
    screen = M.format_screen_response(s)
    assert screen["levers"] == s["levers"]


def test_screen_domain_specific_titles():
    cases = [
        ("glucose",     "Glucose Control"),
        ("bp",          "Blood Pressure"),
        ("cholesterol", "Cholesterol"),
        ("lifestyle",   "Lifestyle"),
    ]
    for domain, expected_title in cases:
        intent = _intent(domain, "education", "food", None, [])
        s = M.build_structured_response(intent, _ctx())
        screen = M.format_screen_response(s)
        assert screen["title"] == expected_title, (
            f"domain={domain!r}: expected title {expected_title!r}, got {screen['title']!r}"
        )


def test_screen_unknown_domain_falls_back_to_health():
    intent = _intent("unknown_domain", "education", "food", None, [])
    s = M.build_structured_response(intent, _ctx())
    screen = M.format_screen_response(s)
    assert screen["title"] == "Health"


# ---------------------------------------------------------------------------
# _enriched_response
# ---------------------------------------------------------------------------

def test_enriched_has_chat_screen_structured():
    r = M._enriched_response("Some LLM text.", 75, GLUCOSE_INTENT, _ctx())
    assert "chat" in r
    assert "screen" in r
    assert "structured" in r
    assert "text" in r


def test_chat_equals_text():
    r = M._enriched_response("LLM response here.", 80, BP_INTENT, _ctx())
    assert r["chat"] == r["text"], "chat must equal text (no divergence)"


def test_screen_derived_from_structured_not_llm():
    """screen.top_actions must match structured.top_actions, not contain LLM text."""
    r = M._enriched_response("Walk more. Eat less. Sleep well.", 70, CHOLESTEROL_INTENT, _ctx())
    assert r["screen"]["top_actions"] == r["structured"]["top_actions"]
    assert "Walk more" not in str(r["screen"]["top_actions"])


def test_enriched_screen_max_3_actions():
    r = M._enriched_response("text", 60, LIFESTYLE_INTENT, _ctx())
    assert len(r["screen"]["top_actions"]) <= 3


def test_enriched_screen_levers_unique():
    r = M._enriched_response("text", 60, GLUCOSE_INTENT, _ctx(after_meal=True))
    levers = r["screen"]["levers"]
    assert len(levers) == len(set(levers)), f"duplicate levers in screen: {levers}"


def test_enriched_preserves_score():
    r = M._enriched_response("text", 92, GLUCOSE_INTENT, _ctx())
    assert r["score"] == 92


# ---------------------------------------------------------------------------
# End-to-end: same structured source for chat and screen
# ---------------------------------------------------------------------------

def test_same_structured_source_for_chat_and_screen():
    """chat and screen must both derive from the same structured object."""
    r = M._enriched_response("response text", 85, BP_INTENT, _ctx(high=True))
    # screen's top_actions must mirror structured's top_actions exactly
    assert r["screen"]["top_actions"] == r["structured"]["top_actions"]
    # chat is the LLM text, structured is the deterministic data
    assert r["chat"] == "response text"
    assert isinstance(r["structured"]["top_actions"], list)
