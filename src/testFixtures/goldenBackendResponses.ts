import type { BackendResponse } from "../contracts/backendResponse";

export const pizzaResponse: BackendResponse = {
  status: "ok",
  traceId: "trace-pizza-001",
  display_text: "Pizza can create a higher glucose load. Take a short walk now and keep the next meal protein-forward.",
  domain: "glucose",
  intent: "intervention",
  need: "post_meal",
  foods: ["pizza"],
  meal_score: { overall: "high", glucose: "high", cholesterol: "moderate" },
  actions: [
    {
      id: "walk-20-high",
      kind: "movement",
      title: "Walk for 20 minutes",
      description: "Use a brisk pace if comfortable.",
      priority: 1,
      duration_minutes: 20,
      intensity: "high",
      timing: "now",
    },
    {
      id: "hydrate-now",
      kind: "hydration",
      title: "Drink water",
      description: "Hydrate steadily after the meal.",
      priority: 2,
      timing: "now",
    },
  ],
};

export const rajmaResponse: BackendResponse = {
  status: "ok",
  traceId: "trace-rajma-001",
  display_text: "Rajma is fiber-rich but still has carbs. A 10-minute moderate walk is enough for most meals like this.",
  domain: "glucose",
  intent: "intervention",
  need: "post_meal",
  foods: ["kidney beans"],
  meal_score: { overall: "moderate", glucose: "moderate" },
  actions: [
    {
      id: "walk-10-moderate",
      kind: "movement",
      title: "Walk for 10 minutes",
      description: "Moderate pace is enough here.",
      priority: 1,
      duration_minutes: 10,
      intensity: "moderate",
      timing: "now",
    },
  ],
};

export const clarificationResponse: BackendResponse = {
  status: "clarification_required",
  traceId: "trace-clarify-001",
  clarification: {
    required: true,
    question: "Did you mean cooked spinach, saag paneer, or another saag dish?",
    reason: "Food item is ambiguous.",
  },
  foods: [],
  actions: [],
};

export const backendErrorResponse: BackendResponse = {
  status: "error",
  traceId: "trace-error-001",
  error: {
    code: "BACKEND_TIMEOUT",
    message: "I had trouble analyzing that meal. Try one simple food at a time.",
  },
};

export const malformedButRenderableResponse: BackendResponse = {
  trace_id: "trace-malformed-001",
  foods: ["burger", "fries"],
  actions: [
    {
      id: "missing-title-action",
      kind: "movement",
      title: "",
    } as any,
  ],
};

export const noActionsResponse: BackendResponse = {
  status: "ok",
  traceId: "trace-noactions-001",
  display_text: "Good choice. No specific actions needed right now.",
  foods: ["salad"],
  actions: [],
};

export const longTextResponse: BackendResponse = {
  status: "ok",
  traceId: "trace-long-001",
  display_text:
    "Burger and fries create a combined high glucose and cholesterol load. " +
    "The refined carbs in the bun and fries spike blood sugar quickly. " +
    "The saturated fat in the burger adds cholesterol pressure. " +
    "Immediately after eating: take a 20-minute brisk walk. " +
    "For your next meal: prioritize fiber and protein. Avoid simple carbs. " +
    "Drink plenty of water. Consider a small handful of nuts as your next snack.",
  foods: ["burger", "fries"],
  meal_score: { overall: "high", glucose: "high", cholesterol: "high" },
  actions: [
    { id: "walk-20", kind: "movement", title: "Walk 20 minutes", description: "Brisk pace.", priority: 1, duration_minutes: 20, timing: "now" },
    { id: "hydrate", kind: "hydration", title: "Drink water", description: "Steady hydration.", priority: 2, timing: "now" },
    { id: "next-meal-fiber", kind: "fiber_first", title: "Fiber first next meal", description: "Eat vegetables before carbs.", priority: 3, timing: "next_meal" },
  ],
};
