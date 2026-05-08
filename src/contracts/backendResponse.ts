export type Severity = "low" | "moderate" | "high" | "unknown";

export type ActionKind =
  | "movement"
  | "hydration"
  | "meal_timing"
  | "fiber_first"
  | "protein_first"
  | "recovery"
  | "education"
  | "unknown";

export type BackendAction = {
  id: string;
  kind: ActionKind;
  title: string;
  description?: string;
  priority?: number;
  duration_minutes?: number;
  intensity?: "low" | "moderate" | "high";
  timing?: "now" | "next_meal" | "today" | "later";
};

export type BackendMealScore = {
  overall?: Severity;
  glucose?: Severity;
  cholesterol?: Severity;
  bp?: Severity;
  lifestyle?: Severity;
};

export type BackendResponse = {
  status?: "ok" | "clarification_required" | "error";
  message?: string;
  answer?: string;
  display_text?: string;
  traceId?: string;
  trace_id?: string;
  domain?: string;
  intent?: string;
  need?: string;
  foods?: string[];
  meal_score?: BackendMealScore;
  actions?: BackendAction[];
  clarification?: {
    required?: boolean;
    question?: string;
    reason?: string;
  };
  error?: {
    code?: string;
    message?: string;
  };
  [key: string]: unknown;
};

export type ChatRole = "user" | "assistant" | "system";

export type UIAction = {
  id: string;
  kind: ActionKind;
  title: string;
  description: string;
  priority: number;
  durationMinutes?: number;
  intensity?: "low" | "moderate" | "high";
  timing?: "now" | "next_meal" | "today" | "later";
};

export type UIMessage = {
  id: string;
  traceId: string;
  role: ChatRole;
  text: string;
  pending: boolean;
  error?: string;
  foods?: string[];
  mealScore?: BackendMealScore;
  actions?: UIAction[];
  createdAt: number;
  source: "keyboard" | "voice" | "backend" | "system";
};
