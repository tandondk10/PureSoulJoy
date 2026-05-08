import {
  pizzaResponse,
  rajmaResponse,
  clarificationResponse,
  backendErrorResponse,
  malformedButRenderableResponse,
  noActionsResponse,
  longTextResponse,
} from "../../src/testFixtures/goldenBackendResponses";
import { normalizeBackendResponseToUIMessage } from "../../src/utils/normalizeBackendResponse";

// ─── FE-GOLD-001: pizza ───────────────────────────────────────────────────────

describe("FE-GOLD-001: pizza response", () => {
  const msg = normalizeBackendResponseToUIMessage(pizzaResponse, "fallback-1");

  it("produces an assistant message", () => {
    expect(msg.role).toBe("assistant");
    expect(msg.pending).toBe(false);
  });
  it("carries the correct traceId", () => {
    expect(msg.traceId).toBe("trace-pizza-001");
  });
  it("has non-empty text", () => {
    expect(msg.text.length).toBeGreaterThan(0);
    expect(msg.text).toContain("Pizza");
  });
  it("contains food list", () => {
    expect(msg.foods).toEqual(["pizza"]);
  });
  it("has 2 actions", () => {
    expect(msg.actions).toHaveLength(2);
  });
  it("preserves backend action order", () => {
    expect(msg.actions?.[0].id).toBe("walk-20-high");
    expect(msg.actions?.[1].id).toBe("hydrate-now");
  });
  it("normalizes action titles", () => {
    expect(msg.actions?.[0].title).toBe("Walk for 20 minutes");
  });
  it("does not leak raw JSON into text", () => {
    expect(msg.text).not.toMatch(/\{"status"/);
    expect(msg.text).not.toMatch(/"actions"/);
  });
});

// ─── FE-GOLD-002: rajma ──────────────────────────────────────────────────────

describe("FE-GOLD-002: rajma response", () => {
  const msg = normalizeBackendResponseToUIMessage(rajmaResponse, "fallback-2");

  it("renders moderate-risk response", () => {
    expect(msg.mealScore?.overall).toBe("moderate");
  });
  it("has one movement action", () => {
    expect(msg.actions).toHaveLength(1);
    expect(msg.actions?.[0].kind).toBe("movement");
  });
  it("includes 10-minute walk", () => {
    expect(msg.actions?.[0].durationMinutes).toBe(10);
  });
});

// ─── FE-GOLD-003: clarification ──────────────────────────────────────────────

describe("FE-GOLD-003: clarification response", () => {
  const msg = normalizeBackendResponseToUIMessage(clarificationResponse, "fallback-3");

  it("renders clarification question as text", () => {
    expect(msg.text).toContain("Did you mean");
  });
  it("has no actions", () => {
    expect(msg.actions).toHaveLength(0);
  });
  it("does not crash", () => {
    expect(msg.role).toBe("assistant");
    expect(msg.pending).toBe(false);
  });
});

// ─── FE-GOLD-005: backend error ──────────────────────────────────────────────

describe("FE-GOLD-005: backend error response", () => {
  const msg = normalizeBackendResponseToUIMessage(backendErrorResponse, "fallback-5");

  it("marks message as error", () => {
    expect(msg.error).toBeTruthy();
  });
  it("shows user-friendly error text", () => {
    expect(msg.text).toContain("trouble analyzing");
  });
  it("does not show stack trace or raw code", () => {
    expect(msg.text).not.toMatch(/BACKEND_TIMEOUT/);
    expect(msg.text).not.toMatch(/\{"code"/);
  });
  it("is not pending", () => {
    expect(msg.pending).toBe(false);
  });
});

// ─── FE-GOLD-006: malformed response ─────────────────────────────────────────

describe("FE-GOLD-006: malformed but renderable response", () => {
  const msg = normalizeBackendResponseToUIMessage(malformedButRenderableResponse, "fallback-6");

  it("uses trace_id as fallback", () => {
    expect(msg.traceId).toBe("trace-malformed-001");
  });
  it("produces non-empty text", () => {
    expect(msg.text.length).toBeGreaterThan(0);
  });
  it("normalizes empty action title with fallback", () => {
    expect(msg.actions?.[0].title).toBe("Recommended action");
  });
  it("does not crash", () => {
    expect(msg.role).toBe("assistant");
  });
});

// ─── FE-GOLD-008: empty actions ──────────────────────────────────────────────

describe("FE-GOLD-008: no actions response", () => {
  const msg = normalizeBackendResponseToUIMessage(noActionsResponse, "fallback-8");

  it("has empty actions array", () => {
    expect(msg.actions).toHaveLength(0);
  });
  it("still has text", () => {
    expect(msg.text.length).toBeGreaterThan(0);
  });
});

// ─── FE-GOLD-007: long response ──────────────────────────────────────────────

describe("FE-GOLD-007: long response", () => {
  const msg = normalizeBackendResponseToUIMessage(longTextResponse, "fallback-7");

  it("renders text without JSON leak", () => {
    expect(msg.text).not.toMatch(/\{"status"/);
    expect(msg.text).not.toMatch(/"actions":/);
    expect(msg.text.length).toBeGreaterThan(50);
  });
  it("has 3 actions", () => {
    expect(msg.actions).toHaveLength(3);
  });
});

// ─── fallback traceId ────────────────────────────────────────────────────────

describe("fallback traceId", () => {
  it("uses fallbackTraceId when response has no traceId", () => {
    const msg = normalizeBackendResponseToUIMessage({ status: "ok", display_text: "ok" }, "my-fallback");
    expect(msg.traceId).toBe("my-fallback");
  });
});
