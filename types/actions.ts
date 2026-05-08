export type ActionPriority = "primary" | "secondary" | "supporting";
export type ActionCategory =
  | "movement"
  | "hydration"
  | "food_sequence"
  | "next_meal"
  | "recovery"
  | "education"
  | "clarification"
  | "safety"
  | "unknown";
export type ActionTone = "calm" | "urgent" | "encouraging" | "neutral";

export type ActionContract = {
  id: string;
  title: string;
  instruction: string;
  priority?: ActionPriority;
  category?: ActionCategory;
  tone?: ActionTone;
  duration_minutes?: number;
  timing?: string;
  rationale?: string;
  lever?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

export type UIAction = {
  id: string;
  title: string;
  instruction: string;
  priority: ActionPriority;
  category: ActionCategory;
  tone: ActionTone;
  durationMinutes?: number;
  timing?: string;
  rationale?: string;
  lever?: string;
  confidence?: number;
  isValid: boolean;
  validationWarnings: string[];
  raw?: unknown;
};
