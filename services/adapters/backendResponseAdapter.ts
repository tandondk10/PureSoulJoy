import { ACTION_TEXT_MAP } from "../../constants/actionTextMap";
import type { UIAction, ActionPriority, ActionCategory, ActionTone } from "../../types/actions";
import type { RenderContract, UIRenderContract } from "../../types/renderContract";
import { DEFAULT_RENDER_CONTRACT } from "../../types/renderContract";

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizePriority(value: unknown): ActionPriority {
  if (value === "primary" || value === "secondary" || value === "supporting") return value;
  return "supporting";
}

function normalizeCategory(value: unknown): ActionCategory {
  const allowed = new Set<ActionCategory>([
    "movement", "hydration", "food_sequence", "next_meal",
    "recovery", "education", "clarification", "safety", "unknown",
  ]);
  return typeof value === "string" && allowed.has(value as ActionCategory)
    ? (value as ActionCategory)
    : "unknown";
}

function normalizeTone(value: unknown): ActionTone {
  if (value === "calm" || value === "urgent" || value === "encouraging" || value === "neutral") return value;
  return "neutral";
}

function inferCategoryFromCode(code: string): ActionCategory {
  if (code.includes("walk") || code.includes("movement")) return "movement";
  if (code.includes("water") || code.includes("hydrat")) return "hydration";
  if (code.includes("next_meal") || code.includes("protein") || code.includes("fiber")) return "next_meal";
  if (code.includes("food") || code.includes("sequence")) return "food_sequence";
  return "unknown";
}

export function normalizeAction(raw: unknown, index: number): UIAction {
  // String code from current backend format: "walk_10min_now"
  if (typeof raw === "string") {
    const title = ACTION_TEXT_MAP[raw] || raw.replace(/_/g, " ");
    return {
      id: raw,
      title,
      instruction: title,
      priority: "supporting",
      category: inferCategoryFromCode(raw),
      tone: "neutral",
      isValid: true,
      validationWarnings: [],
      raw,
    };
  }

  const action = raw as Record<string, unknown> | null | undefined;
  const warnings: string[] = [];

  if (!action) {
    return {
      id: `action_${index + 1}`,
      title: "Recommended action",
      instruction: "Follow the recommended next step.",
      priority: "supporting",
      category: "unknown",
      tone: "neutral",
      isValid: false,
      validationWarnings: ["null or undefined action"],
      raw,
    };
  }

  const id = safeString(action.id, `action_${index + 1}`);
  // Support both new {title, instruction} and old {label} formats
  const title = safeString(action.title ?? action.label, "Recommended action");
  const instruction = safeString(action.instruction ?? action.label, "Follow the recommended next step.");

  if (!action.id) warnings.push("Missing action.id");
  if (!action.title && !action.label) warnings.push("Missing action.title");
  if (!action.instruction && !action.label) warnings.push("Missing action.instruction");

  const explicitCategory = normalizeCategory(action.category);
  const category = explicitCategory !== "unknown" ? explicitCategory : inferCategoryFromCode(id);

  return {
    id,
    title,
    instruction,
    priority: normalizePriority(action.priority),
    category,
    tone: normalizeTone(action.tone),
    durationMinutes: typeof action.duration_minutes === "number" ? action.duration_minutes : undefined,
    timing: typeof action.timing === "string" ? action.timing : undefined,
    rationale: typeof action.rationale === "string" ? action.rationale : undefined,
    lever: typeof action.lever === "string" ? action.lever : undefined,
    confidence: typeof action.confidence === "number" ? action.confidence : undefined,
    isValid: title !== "Recommended action" || instruction !== "Follow the recommended next step.",
    validationWarnings: warnings,
    raw,
  };
}

export function normalizeRenderContract(raw?: RenderContract): UIRenderContract {
  return {
    version: raw?.version || DEFAULT_RENDER_CONTRACT.version,
    layout: raw?.layout || DEFAULT_RENDER_CONTRACT.layout,
    showActions: raw?.show_actions ?? DEFAULT_RENDER_CONTRACT.showActions,
    showScore: raw?.show_score ?? DEFAULT_RENDER_CONTRACT.showScore,
    showRationale: raw?.show_rationale ?? DEFAULT_RENDER_CONTRACT.showRationale,
    maxVisibleActions:
      typeof raw?.max_visible_actions === "number"
        ? raw.max_visible_actions
        : DEFAULT_RENDER_CONTRACT.maxVisibleActions,
  };
}
