import type { BackendAction, BackendResponse, UIAction, UIMessage } from "../contracts/backendResponse";

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeAction(action: BackendAction, index: number): UIAction {
  return {
    id: safeString(action.id, `action-${index}`),
    kind: action.kind || "unknown",
    title: safeString(action.title, "Recommended action"),
    description: safeString(action.description, "Try this next step now."),
    priority: typeof action.priority === "number" ? action.priority : index + 1,
    durationMinutes: action.duration_minutes,
    intensity: action.intensity,
    timing: action.timing,
  };
}

export function normalizeBackendResponseToUIMessage(
  response: BackendResponse,
  fallbackTraceId: string
): UIMessage {
  const traceId = safeString(response.traceId, safeString(response.trace_id, fallbackTraceId));

  const primaryText =
    safeString(response.display_text) ||
    safeString(response.answer) ||
    safeString(response.message) ||
    safeString(response.clarification?.question) ||
    safeString(response.error?.message) ||
    "I could not prepare a full response, but I can still help with a simple next step.";

  const actions = Array.isArray(response.actions)
    ? response.actions.map(normalizeAction)
    : [];

  return {
    id: `assistant-${traceId}`,
    traceId,
    role: "assistant",
    text: primaryText,
    pending: false,
    error: response.status === "error" ? primaryText : undefined,
    foods: Array.isArray(response.foods) ? response.foods : [],
    mealScore: response.meal_score,
    actions,
    createdAt: Date.now(),
    source: "backend",
  };
}
