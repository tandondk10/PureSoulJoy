import { normalizeAction, normalizeRenderContract } from "../services/adapters/backendResponseAdapter";
import { DEFAULT_RENDER_CONTRACT } from "../types/renderContract";

// ─── normalizeAction ──────────────────────────────────────────────────────────

describe("normalizeAction", () => {
  it("normalizes a string code into a UIAction", () => {
    const action = normalizeAction("walk_10min_now", 0);
    expect(action.id).toBe("walk_10min_now");
    expect(action.title).toBe("Take a 10-minute walk now");
    expect(action.category).toBe("movement");
    expect(action.isValid).toBe(true);
    expect(action.validationWarnings).toHaveLength(0);
  });

  it("normalizes a full ActionContract object", () => {
    const action = normalizeAction(
      {
        id: "walk_10min_now",
        title: "Walk now",
        instruction: "Take a 10-minute walk.",
        category: "movement",
        priority: "primary",
        duration_minutes: 10,
        tone: "encouraging",
      },
      0
    );
    expect(action.id).toBe("walk_10min_now");
    expect(action.title).toBe("Walk now");
    expect(action.instruction).toBe("Take a 10-minute walk.");
    expect(action.category).toBe("movement");
    expect(action.priority).toBe("primary");
    expect(action.durationMinutes).toBe(10);
    expect(action.tone).toBe("encouraging");
    expect(action.isValid).toBe(true);
  });

  it("normalizes legacy {id, label} object (old backend format)", () => {
    const action = normalizeAction({ id: "drink_water_now", label: "Drink water" }, 0);
    expect(action.id).toBe("drink_water_now");
    expect(action.title).toBe("Drink water");
    expect(action.instruction).toBe("Drink water");
    expect(action.category).toBe("hydration");
  });

  it("generates fallback fields for empty object", () => {
    const action = normalizeAction({}, 0);
    expect(action.id).toBe("action_1");
    expect(action.title).toBe("Recommended action");
    expect(action.instruction).toBe("Follow the recommended next step.");
    expect(action.validationWarnings.length).toBeGreaterThan(0);
  });

  it("returns safe fallback for null input", () => {
    const action = normalizeAction(null, 2);
    expect(action.id).toBe("action_3");
    expect(action.isValid).toBe(false);
  });

  it("normalizes unknown category to 'unknown'", () => {
    const action = normalizeAction({ id: "x", title: "X", instruction: "Do X", category: "bogus" }, 0);
    expect(action.category).toBe("unknown");
  });

  it("normalizes unknown priority to 'supporting'", () => {
    const action = normalizeAction({ id: "x", title: "X", instruction: "Do X", priority: "critical" }, 0);
    expect(action.priority).toBe("supporting");
  });

  it("preserves optional timing and rationale", () => {
    const action = normalizeAction(
      { id: "x", title: "X", instruction: "Do X", timing: "Post-meal", rationale: "Reduces spike" },
      0
    );
    expect(action.timing).toBe("Post-meal");
    expect(action.rationale).toBe("Reduces spike");
  });
});

// ─── normalizeRenderContract ──────────────────────────────────────────────────

describe("normalizeRenderContract", () => {
  it("returns defaults when called with undefined", () => {
    const contract = normalizeRenderContract(undefined);
    expect(contract).toEqual(DEFAULT_RENDER_CONTRACT);
  });

  it("overrides specific fields from backend", () => {
    const contract = normalizeRenderContract({ show_rationale: true, max_visible_actions: 5 });
    expect(contract.showRationale).toBe(true);
    expect(contract.maxVisibleActions).toBe(5);
    expect(contract.showActions).toBe(DEFAULT_RENDER_CONTRACT.showActions);
  });

  it("maps snake_case backend fields to camelCase", () => {
    const contract = normalizeRenderContract({
      show_actions: false,
      show_score: false,
      layout: "text_only",
    });
    expect(contract.showActions).toBe(false);
    expect(contract.showScore).toBe(false);
    expect(contract.layout).toBe("text_only");
  });
});
