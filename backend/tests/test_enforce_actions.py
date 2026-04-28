"""
Unit tests for enforce_actions_in_text and ACTION_REGISTRY.

Run:  cd /Users/deepaktandon/Projects/PureSoulJoy
      USE_MOCK=true python3 -m pytest backend/tests/test_enforce_actions.py -v
"""

import os
import sys

os.environ.setdefault("USE_LLM", "false")
os.environ.setdefault("USE_MOCK", "false")
os.environ.setdefault("OPENAI_API_KEY", "test")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main as M

enforce = M.enforce_actions_in_text
REG = M.ACTION_REGISTRY


# ---------------------------------------------------------------------------
# ACTION_REGISTRY structure
# ---------------------------------------------------------------------------

def test_registry_has_required_keys():
    for action_id, meta in REG.items():
        assert "display" in meta, f"{action_id} missing 'display'"
        assert "keywords" in meta, f"{action_id} missing 'keywords'"
        assert isinstance(meta["keywords"], list), f"{action_id} keywords must be a list"
        assert len(meta["keywords"]) >= 1, f"{action_id} needs at least one keyword"


def test_registry_display_has_no_underscores():
    for action_id, meta in REG.items():
        assert "_" not in meta["display"], (
            f"{action_id} display text contains underscore: {meta['display']!r}"
        )


# ---------------------------------------------------------------------------
# No-op: action already present in text
# ---------------------------------------------------------------------------

def test_no_append_when_walk_keyword_present():
    """Spec case: 'take a walk' should satisfy walk_10min_now."""
    text = "You should take a walk after meals"
    result = enforce(text, ["walk_10min_now"])
    assert result == text, f"expected unchanged, got: {result!r}"


def test_no_append_when_all_keywords_present():
    text = "Avoid carbs and add protein to your meal, then check your glucose."
    actions = ["avoid_simple_carbs_now", "add_protein_next_meal", "check_glucose_again"]
    result = enforce(text, actions)
    assert result == text


def test_no_append_empty_actions():
    text = "Some response text."
    result = enforce(text, [])
    assert result == text


def test_no_duplicate_action_appended():
    """Keyword match found → nothing appended, no duplicate."""
    text = "Walk for 10 minutes after eating."
    result = enforce(text, ["walk_10min_now"])
    assert result.count("walk") == 1 or "Do this now" not in result


# ---------------------------------------------------------------------------
# Append: action genuinely missing
# ---------------------------------------------------------------------------

def test_append_missing_action_uses_display_not_id():
    text = "General health advice."
    result = enforce(text, ["walk_10min_now"])
    assert "walk_10min_now" not in result, "raw action ID must not appear in output"
    assert "Do this now:" in result
    assert "Take a 10-minute walk now" in result


def test_append_multiple_missing_actions():
    text = "Stay hydrated."
    actions = ["walk_10min_now", "avoid_simple_carbs_now"]
    result = enforce(text, actions)
    assert "Take a 10-minute walk now" in result
    assert "Avoid simple carbs right now" in result
    assert result.count("Do this now:") == 1, "block must appear exactly once"


def test_partial_match_does_not_append_matched_action():
    """If one action is present and one is missing, only the missing one is appended."""
    text = "Go for a walk after eating."
    actions = ["walk_10min_now", "check_glucose_again"]
    result = enforce(text, actions)
    assert "Take a 10-minute walk now" not in result, "walk is already covered"
    assert "Check your glucose again" in result


# ---------------------------------------------------------------------------
# Case-insensitive matching
# ---------------------------------------------------------------------------

def test_case_insensitive_keyword_match():
    text = "WALK briskly for MINUTES after eating."
    result = enforce(text, ["walk_10min_now"])
    assert result == text, "uppercase keywords must be matched case-insensitively"


# ---------------------------------------------------------------------------
# Unregistered action IDs — must not raise, must not leak underscore IDs
# ---------------------------------------------------------------------------

def test_unregistered_action_falls_back_to_readable_display():
    text = "Some response."
    result = enforce(text, ["some_unknown_action"])
    # Should not raise KeyError
    assert "some_unknown_action" not in result
    # Fallback: underscores replaced with spaces
    assert "some unknown action" in result


def test_unregistered_action_still_appends():
    text = "Some response."
    result = enforce(text, ["totally_new_action"])
    assert "Do this now:" in result
    assert "totally new action" in result


# ---------------------------------------------------------------------------
# No raw IDs in output
# ---------------------------------------------------------------------------

def test_no_raw_action_ids_in_output():
    text = "General advice."
    actions = list(REG.keys())
    result = enforce(text, actions)
    for action_id in actions:
        assert action_id not in result, f"raw ID {action_id!r} leaked into output"
