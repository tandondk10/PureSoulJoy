import type { AssistantSection, ChatMessage, CoachingResponse, MessageSource } from "../types/coaching";
import { ACTION_TEXT_MAP } from "../../constants/actionTextMap";
import { normalizeAction, normalizeRenderContract } from "../../services/adapters/backendResponseAdapter";

const WALK_ACTION_IDS = new Set(["walk_10min_now", "walk_now", "post_meal_walk"]);

function renderActionLabel(a: { id?: string; label?: string; duration_minutes?: number | null }): string {
  if (a.duration_minutes != null && a.id && WALK_ACTION_IDS.has(a.id)) {
    return `Take a ${a.duration_minutes}-minute walk now`;
  }
  return a.label ?? (a.id ? ACTION_TEXT_MAP[a.id] : undefined) ?? a.id ?? "Action";
}

export function makeUserMessage(args: {
  id: string;
  text: string;
  source: MessageSource;
  traceId: string;
}): ChatMessage {
  return {
    id: args.id,
    role: "user",
    source: args.source,
    status: "complete",
    text: args.text,
    traceId: args.traceId,
    createdAt: Date.now(),
  };
}

export function makeAssistantLoadingMessage(args: {
  id: string;
  source: MessageSource;
  traceId: string;
  context?: string;
}): ChatMessage {
  return {
    id: args.id,
    role: "assistant",
    source: args.source,
    status: "loading",
    text: "Thinking...",
    traceId: args.traceId,
    context: args.context,
    createdAt: Date.now(),
  };
}

export function getResponseDisplayText(response: CoachingResponse): string {
  if (
    response.needs_clarification === true &&
    typeof response.clarification_question === "string" &&
    response.clarification_question.trim().length > 0
  ) {
    return response.clarification_question.trim();
  }
  if (typeof response.chat === "string" && response.chat.trim().length > 0) return response.chat.trim();
  if (typeof response.text === "string" && response.text.trim().length > 0) return response.text.trim();
  if (typeof response.message === "string" && response.message.trim().length > 0) return response.message.trim();
  return "I could not prepare a response. Please try again.";
}

export function assistantCompleteFromResponse(args: {
  existing: ChatMessage;
  response: CoachingResponse;
  liteMode?: boolean | null;
}): ChatMessage {
  const { response, liteMode } = args;

  const text = getResponseDisplayText(response);
  const sections = parseSections(text);

  const isClarification = response.needs_clarification === true;
  const rawActions = isClarification
    ? []
    : response.top_actions || response.actions || [];

  // Legacy string arrays (kept for ActionCards feedback/commitment system)
  const topActionCodes: string[] = rawActions
    .map((a: any) => (typeof a === "string" ? a : (a.id ?? "")))
    .filter(Boolean);
  const topActions: string[] = rawActions.map((a: any) => {
    if (typeof a === "string") return ACTION_TEXT_MAP[a] || a;
    return renderActionLabel(a);
  });

  // Rich UIAction[] for ActionList rendering
  const actions = rawActions.map((a: unknown, i: number) => normalizeAction(a, i));

  const nextActionCodes: string[] =
    response.screen?.next_actions || response.structured?.next_actions || [];
  const nextActionLabels: string[] =
    response.screen?.next_action_labels || response.structured?.next_action_labels || [];

  const renderContract = normalizeRenderContract(response.render_contract as any);

  const kind = isClarification
    ? "clarification" as const
    : actions.length > 0
      ? "meal_result" as const
      : "text" as const;

  return {
    ...args.existing,
    status: "complete",
    text,
    sections: liteMode === true ? undefined : (sections ?? undefined),
    rawText: liteMode === true ? text : (sections ? undefined : text),
    topActions,
    topActionCodes,
    nextActionCodes,
    nextActionLabels,
    traceId: response.trace_id || args.existing.traceId,
    foods: response.foods || [],
    unknownFoods: response.unknown_foods || [],
    needsClarification: isClarification,
    kind,
    actions,
    renderContract,
    updatedAt: Date.now(),
  };
}

export function assistantError(args: {
  existing: ChatMessage;
  errorMessage?: string;
}): ChatMessage {
  const safeMessage = args.errorMessage || "I could not complete that. Please try again.";
  return {
    ...args.existing,
    status: "error",
    kind: "error",
    text: safeMessage,
    errorMessage: safeMessage,
    updatedAt: Date.now(),
  };
}

export function assistantCancelled(existing: ChatMessage): ChatMessage {
  return {
    ...existing,
    status: "cancelled",
    text: "Cancelled.",
    updatedAt: Date.now(),
  };
}

export function getSafeErrorMessage(err: unknown): string {
  if (err instanceof Error && err.name === "AbortError") {
    return "Connection timed out. Please try again.";
  }
  return "Connection issue. Please try again.";
}

export function getVoiceUserText(response: CoachingResponse): string {
  return (typeof response.transcript === "string" && response.transcript.trim().length > 0)
    ? response.transcript.trim()
    : "🎤 Voice input";
}

function parseSections(text: string): AssistantSection[] | null {
  if (!text || !text.includes("##")) return null;
  return text
    .split("## ")
    .filter(Boolean)
    .map((p) => {
      const lines = p.split("\n");
      return {
        title: String(lines[0] || "").trim(),
        content: String(lines.slice(1).join("\n") || "").trim(),
      };
    });
}
