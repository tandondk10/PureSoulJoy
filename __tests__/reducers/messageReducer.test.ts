import { messageReducer } from "../../src/utils/messageReducer";
import type { UIMessage } from "../../src/contracts/backendResponse";

function makeMessage(overrides: Partial<UIMessage> = {}): UIMessage {
  return {
    id: "m1",
    traceId: "t1",
    role: "user",
    text: "hello",
    pending: false,
    createdAt: 1,
    source: "keyboard",
    ...overrides,
  };
}

// ─── FE-GOLD-009 / FE-GOLD-010 ───────────────────────────────────────────────

describe("messageReducer", () => {
  it("USER_MESSAGE_ADDED: adds message to empty state", () => {
    const state = messageReducer(
      { messages: [] },
      { type: "USER_MESSAGE_ADDED", message: makeMessage({ id: "u1", role: "user" }) }
    );
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].role).toBe("user");
  });

  it("USER_MESSAGE_ADDED: preserves voice source on user bubble", () => {
    const state = messageReducer(
      { messages: [] },
      {
        type: "USER_MESSAGE_ADDED",
        message: makeMessage({ id: "u1", role: "user", source: "voice", text: "🎤 Voice input" }),
      }
    );
    expect(state.messages[0].source).toBe("voice");
    expect(state.messages[0].text).toBe("🎤 Voice input");
  });

  // FE-GOLD-009: duplicate pending guard
  it("ASSISTANT_PENDING_ADDED: adds pending message", () => {
    const pending = makeMessage({ id: "a-t1", traceId: "t1", role: "assistant", pending: true, source: "system" });
    const state = messageReducer({ messages: [] }, { type: "ASSISTANT_PENDING_ADDED", traceId: "t1", message: pending });
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].pending).toBe(true);
  });

  it("ASSISTANT_PENDING_ADDED: does not duplicate on second add (FE-GOLD-009)", () => {
    const pending = makeMessage({ id: "a-t1", traceId: "t1", role: "assistant", pending: true, source: "system" });
    const s1 = messageReducer({ messages: [] }, { type: "ASSISTANT_PENDING_ADDED", traceId: "t1", message: pending });
    const s2 = messageReducer(s1, { type: "ASSISTANT_PENDING_ADDED", traceId: "t1", message: pending });
    expect(s2.messages).toHaveLength(1);
  });

  // FE-GOLD-010: pending replaced, not duplicated
  it("ASSISTANT_RESPONSE_RECEIVED: replaces pending with final response (FE-GOLD-010)", () => {
    const pending = makeMessage({ id: "a-pending-t1", traceId: "t1", role: "assistant", pending: true, source: "system", text: "Thinking…" });
    const final = makeMessage({ id: "assistant-t1", traceId: "t1", role: "assistant", pending: false, source: "backend", text: "Walk for 10 minutes." });

    const state = messageReducer(
      { messages: [pending] },
      { type: "ASSISTANT_RESPONSE_RECEIVED", traceId: "t1", message: final }
    );

    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].pending).toBe(false);
    expect(state.messages[0].text).toContain("Walk");
  });

  it("ASSISTANT_RESPONSE_RECEIVED: appends if no pending exists", () => {
    const userMsg = makeMessage({ id: "u1", role: "user" });
    const final = makeMessage({ id: "assistant-t2", traceId: "t2", role: "assistant", pending: false, source: "backend", text: "Response." });

    const state = messageReducer(
      { messages: [userMsg] },
      { type: "ASSISTANT_RESPONSE_RECEIVED", traceId: "t2", message: final }
    );

    expect(state.messages).toHaveLength(2);
  });

  it("ASSISTANT_RESPONSE_FAILED: marks pending as failed with error text", () => {
    const pending = makeMessage({ id: "a-t1", traceId: "t1", role: "assistant", pending: true, source: "system" });
    const state = messageReducer(
      { messages: [pending] },
      { type: "ASSISTANT_RESPONSE_FAILED", traceId: "t1", errorText: "Something went wrong. Try again." }
    );

    expect(state.messages[0].pending).toBe(false);
    expect(state.messages[0].error).toContain("Something went wrong");
  });

  it("CLEAR_ALL: empties all messages", () => {
    const state = messageReducer(
      { messages: [makeMessage(), makeMessage({ id: "m2" })] },
      { type: "CLEAR_ALL" }
    );
    expect(state.messages).toHaveLength(0);
  });

  it("user bubble is preserved after assistant response is added", () => {
    const user = makeMessage({ id: "u1", role: "user", text: "I ate pizza" });
    const pending = makeMessage({ id: "a-t1", traceId: "t1", role: "assistant", pending: true, source: "system" });
    const final = makeMessage({ id: "assistant-t1", traceId: "t1", role: "assistant", pending: false, source: "backend", text: "Walk now." });

    let state = messageReducer({ messages: [] }, { type: "USER_MESSAGE_ADDED", message: user });
    state = messageReducer(state, { type: "ASSISTANT_PENDING_ADDED", traceId: "t1", message: pending });
    state = messageReducer(state, { type: "ASSISTANT_RESPONSE_RECEIVED", traceId: "t1", message: final });

    expect(state.messages).toHaveLength(2);
    expect(state.messages[0].role).toBe("user");
    expect(state.messages[0].text).toBe("I ate pizza");
    expect(state.messages[1].text).toBe("Walk now.");
  });
});
