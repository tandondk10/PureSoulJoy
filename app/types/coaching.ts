import type { UIAction } from "../../types/actions";
import type { UIRenderContract } from "../../types/renderContract";

export type { UIAction, UIRenderContract };

export type MessageRole = "user" | "assistant";
export type MessageSource = "keyboard" | "voice" | "system";
export type MessageStatus = "loading" | "complete" | "error" | "cancelled";
export type AssistantMessageKind = "text" | "meal_result" | "clarification" | "error";

export type AssistantSection = {
  title: string;
  content: string;
};

export type CoachingAction = {
  id: string;
  label: string;
  lever?: string;
  priority?: number;
  intensity?: "low" | "moderate" | "high";
  duration_minutes?: number | null;
  urgency?: "now" | "soon" | "today" | "next_meal";
  reason?: string;
};

export type CoachingRequest = {
  query: string;
  voice?: boolean;
  lite?: boolean;
  user_profile?: unknown;
  traceId?: string;
};

export type FoodSource = "internal" | "usda" | "cache" | "unknown";

export type NormalizedFoodDebug = {
  canonical_name?: string;
  display_name?: string;
  source?: FoodSource;
  confidence?: number;
  calories?: number;
  carbs_g?: number;
  protein_g?: number;
  fat_g?: number;
  sat_fat_g?: number;
  fiber_g?: number;
  external_id?: string;
};

export type CoachingResponse = {
  contract_version?: string;
  status?: "ok" | "error" | "clarification";
  chat?: string;
  text?: string;
  rawText?: string;
  message?: string;
  sections?: AssistantSection[];
  top_actions?: (CoachingAction | string)[];
  actions?: (CoachingAction | string)[];
  needs_clarification?: boolean;
  clarification_question?: string | null;
  input_domain?: string;
  condition_focus?: string | null;
  timing?: string;
  conditions?: Record<string, string>;
  levers?: string[];
  foods?: string[];
  unknown_foods?: string[];
  confidence?: number;
  trace_id?: string;
  error?: string;
  audio?: string;
  screen?: { next_actions?: string[]; next_action_labels?: string[] };
  structured?: { next_actions?: string[]; next_action_labels?: string[] };
  cleaned_query?: string;
  query?: string;
  transcript?: string;
  has_food?: boolean;
  normalized_foods?: NormalizedFoodDebug[];
  render_contract?: Record<string, unknown>;
  debug?: Record<string, unknown>;
};

export type ChatMessage = {
  id: string;
  role: MessageRole;
  source: MessageSource;
  status: MessageStatus;
  text: string;
  rawText?: string;
  sections?: AssistantSection[];
  errorMessage?: string;
  topActions?: string[];
  topActionCodes?: string[];
  nextActionLabels?: string[];
  nextActionCodes?: string[];
  traceId: string;
  context?: string;
  feedbackSent?: "helpful" | "not_helpful";
  actionTaken?: boolean;
  foods?: string[];
  unknownFoods?: string[];
  needsClarification?: boolean;
  kind?: AssistantMessageKind;
  actions?: UIAction[];
  renderContract?: UIRenderContract;
  createdAt: number;
  updatedAt?: number;
};
