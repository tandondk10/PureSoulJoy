import {
  makeUserMessage,
  makeAssistantLoadingMessage,
  assistantCompleteFromResponse,
  assistantError,
  assistantCancelled,
  getSafeErrorMessage,
  getVoiceUserText,
} from "../app/utils/messageLifecycle";
import type { ChatMessage, CoachingResponse } from "../app/types/coaching";

const BASE_LOADING = (): ChatMessage =>
  makeAssistantLoadingMessage({ id: "t-assistant", source: "keyboard", traceId: "t" });

// ─── makeAssistantLoadingMessage ─────────────────────────────────────────────

test("loading message has status=loading and text=Thinking...", () => {
  const msg = BASE_LOADING();
  expect(msg.status).toBe("loading");
  expect(msg.text).toBe("Thinking...");
  expect(msg.role).toBe("assistant");
  expect(msg.traceId).toBe("t");
});

test("loading message is render-safe (no empty text)", () => {
  const msg = BASE_LOADING();
  expect(msg.text.trim().length).toBeGreaterThan(0);
});

// ─── makeUserMessage ─────────────────────────────────────────────────────────

test("user message has correct fields", () => {
  const msg = makeUserMessage({ id: "t-user", text: "I ate pizza", source: "keyboard", traceId: "t" });
  expect(msg.role).toBe("user");
  expect(msg.status).toBe("complete");
  expect(msg.text).toBe("I ate pizza");
  expect(msg.source).toBe("keyboard");
});

// ─── assistantCompleteFromResponse ───────────────────────────────────────────

test("complete response uses chat as display text", () => {
  const loading = BASE_LOADING();
  const response: CoachingResponse = {
    status: "ok",
    chat: "After pizza, walk 10 minutes.",
    trace_id: "t2",
  };
  const complete = assistantCompleteFromResponse({ existing: loading, response });
  expect(complete.status).toBe("complete");
  expect(complete.text).toBe("After pizza, walk 10 minutes.");
  expect(complete.traceId).toBe("t2");
});

test("complete response falls back to text when chat is absent", () => {
  const loading = BASE_LOADING();
  const response: CoachingResponse = {
    status: "ok",
    text: "Walk after eating.",
  };
  const complete = assistantCompleteFromResponse({ existing: loading, response });
  expect(complete.text).toBe("Walk after eating.");
});

test("complete response falls back to message when chat and text are absent", () => {
  const loading = BASE_LOADING();
  const response: CoachingResponse = { status: "ok", message: "Legacy fallback." };
  const complete = assistantCompleteFromResponse({ existing: loading, response });
  expect(complete.text).toBe("Legacy fallback.");
});

test("complete response uses ultimate fallback when all text fields absent", () => {
  const loading = BASE_LOADING();
  const response: CoachingResponse = { status: "ok" };
  const complete = assistantCompleteFromResponse({ existing: loading, response });
  expect(complete.text.length).toBeGreaterThan(0);
  expect(complete.status).toBe("complete");
});

test("liteMode=true sets rawText and clears sections", () => {
  const loading = BASE_LOADING();
  const response: CoachingResponse = { status: "ok", chat: "Short answer." };
  const complete = assistantCompleteFromResponse({ existing: loading, response, liteMode: true });
  expect(complete.rawText).toBe("Short answer.");
  expect(complete.sections).toBeUndefined();
});

test("actions are resolved from top_actions", () => {
  const loading = BASE_LOADING();
  const response: CoachingResponse = {
    status: "ok",
    chat: "Walk now.",
    top_actions: ["walk_10min_now"],
  };
  const complete = assistantCompleteFromResponse({ existing: loading, response });
  expect(complete.topActions).toEqual(["Take a 10-minute walk now"]);
  expect(complete.topActionCodes).toEqual(["walk_10min_now"]);
});

// ─── assistantError ───────────────────────────────────────────────────────────

test("error creates terminal error state with non-empty text", () => {
  const loading = BASE_LOADING();
  const errMsg = assistantError({ existing: loading });
  expect(errMsg.status).toBe("error");
  expect(errMsg.text.length).toBeGreaterThan(0);
  expect(errMsg.errorMessage).toBeDefined();
});

test("error uses provided errorMessage", () => {
  const loading = BASE_LOADING();
  const errMsg = assistantError({ existing: loading, errorMessage: "Custom error." });
  expect(errMsg.errorMessage).toBe("Custom error.");
  expect(errMsg.text).toBe("Custom error.");
});

// ─── assistantCancelled ───────────────────────────────────────────────────────

test("cancelled message has status=cancelled and non-empty text", () => {
  const loading = BASE_LOADING();
  const cancelled = assistantCancelled(loading);
  expect(cancelled.status).toBe("cancelled");
  expect(cancelled.text.length).toBeGreaterThan(0);
});

// ─── getSafeErrorMessage ──────────────────────────────────────────────────────

test("AbortError returns timeout message", () => {
  const err = new Error("aborted");
  err.name = "AbortError";
  expect(getSafeErrorMessage(err)).toContain("timed out");
});

test("generic error returns connection issue message", () => {
  expect(getSafeErrorMessage(new Error("Network failed"))).toContain("Connection");
});

// ─── getVoiceUserText ─────────────────────────────────────────────────────────

test("returns transcript when available", () => {
  expect(getVoiceUserText({ transcript: "I ate ice cream." })).toBe("I ate ice cream.");
});

test("falls back to voice placeholder when transcript absent", () => {
  expect(getVoiceUserText({})).toBe("🎤 Voice input");
});
