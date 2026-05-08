import type { UIMessage } from "../contracts/backendResponse";

export type MessageState = {
  messages: UIMessage[];
};

export type MessageEvent =
  | { type: "USER_MESSAGE_ADDED"; message: UIMessage }
  | { type: "ASSISTANT_PENDING_ADDED"; traceId: string; message: UIMessage }
  | { type: "ASSISTANT_RESPONSE_RECEIVED"; traceId: string; message: UIMessage }
  | { type: "ASSISTANT_RESPONSE_FAILED"; traceId: string; errorText: string }
  | { type: "CLEAR_ALL" };

export function messageReducer(state: MessageState, event: MessageEvent): MessageState {
  switch (event.type) {
    case "USER_MESSAGE_ADDED":
      return { messages: [...state.messages, event.message] };

    case "ASSISTANT_PENDING_ADDED": {
      const exists = state.messages.some((m) => m.id === event.message.id);
      if (exists) return state;
      return { messages: [...state.messages, event.message] };
    }

    case "ASSISTANT_RESPONSE_RECEIVED": {
      const next = state.messages.map((m) =>
        m.traceId === event.traceId && m.role === "assistant" ? event.message : m
      );
      const replaced = next.some(
        (m) => m.id === event.message.id || m.traceId === event.traceId
      );
      return replaced ? { messages: next } : { messages: [...state.messages, event.message] };
    }

    case "ASSISTANT_RESPONSE_FAILED":
      return {
        messages: state.messages.map((m) =>
          m.traceId === event.traceId && m.role === "assistant"
            ? { ...m, pending: false, error: event.errorText, text: event.errorText }
            : m
        ),
      };

    case "CLEAR_ALL":
      return { messages: [] };

    default:
      return state;
  }
}
