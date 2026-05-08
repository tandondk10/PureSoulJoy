import { messageReducer } from "../../src/utils/messageReducer";
import { normalizeBackendResponseToUIMessage } from "../../src/utils/normalizeBackendResponse";
import { pizzaResponse } from "../../src/testFixtures/goldenBackendResponses";
import type { UIMessage } from "../../src/contracts/backendResponse";

function voiceUserMessage(traceId: string, text = "🎤 Voice input"): UIMessage {
  return { id: `user-${traceId}`, traceId, role: "user", text, pending: false, createdAt: 1, source: "voice" };
}

function pendingAssistant(traceId: string): UIMessage {
  return { id: `assistant-pending-${traceId}`, traceId, role: "assistant", text: "Thinking…", pending: true, createdAt: 2, source: "system" };
}

// ─── FE-GOLD-004: voice lifecycle ────────────────────────────────────────────

describe("voice lifecycle (FE-GOLD-004)", () => {
  it("inserts voice user bubble and pending assistant", () => {
    const traceId = "voice-trace-001";
    let state = messageReducer({ messages: [] }, { type: "USER_MESSAGE_ADDED", message: voiceUserMessage(traceId) });
    state = messageReducer(state, { type: "ASSISTANT_PENDING_ADDED", traceId, message: pendingAssistant(traceId) });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].source).toBe("voice");
    expect(state.messages[1].role).toBe("assistant");
    expect(state.messages[1].pending).toBe(true);
  });

  it("voice user bubble survives backend response", () => {
    const traceId = "voice-trace-002";
    const response = normalizeBackendResponseToUIMessage(pizzaResponse, traceId);

    let state = messageReducer({ messages: [] }, { type: "USER_MESSAGE_ADDED", message: voiceUserMessage(traceId) });
    state = messageReducer(state, { type: "ASSISTANT_PENDING_ADDED", traceId, message: pendingAssistant(traceId) });
    state = messageReducer(state, { type: "ASSISTANT_RESPONSE_RECEIVED", traceId, message: { ...response, traceId } });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].source).toBe("voice");
    expect(state.messages[0].text).toBe("🎤 Voice input");
    expect(state.messages[1].pending).toBe(false);
    expect(state.messages[1].text).toContain("Pizza");
  });

  it("voice user bubble survives backend error", () => {
    const traceId = "voice-trace-003";

    let state = messageReducer({ messages: [] }, { type: "USER_MESSAGE_ADDED", message: voiceUserMessage(traceId) });
    state = messageReducer(state, { type: "ASSISTANT_PENDING_ADDED", traceId, message: pendingAssistant(traceId) });
    state = messageReducer(state, { type: "ASSISTANT_RESPONSE_FAILED", traceId, errorText: "Connection issue." });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].source).toBe("voice");
    expect(state.messages[1].error).toContain("Connection");
    expect(state.messages[1].pending).toBe(false);
  });

  it("duplicate pending guard works for voice", () => {
    const traceId = "voice-trace-004";
    const pending = pendingAssistant(traceId);
    let state = messageReducer({ messages: [] }, { type: "USER_MESSAGE_ADDED", message: voiceUserMessage(traceId) });
    state = messageReducer(state, { type: "ASSISTANT_PENDING_ADDED", traceId, message: pending });
    state = messageReducer(state, { type: "ASSISTANT_PENDING_ADDED", traceId, message: pending });

    expect(state.messages).toHaveLength(2);
  });
});
