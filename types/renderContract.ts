export type RenderLayout = "stacked_cards" | "compact_list" | "text_only";

export type RenderContract = {
  version?: string;
  layout?: RenderLayout;
  show_actions?: boolean;
  show_score?: boolean;
  show_rationale?: boolean;
  max_visible_actions?: number;
};

export type UIRenderContract = {
  version: string;
  layout: RenderLayout;
  showActions: boolean;
  showScore: boolean;
  showRationale: boolean;
  maxVisibleActions: number;
};

export const DEFAULT_RENDER_CONTRACT: UIRenderContract = {
  version: "1.0",
  layout: "stacked_cards",
  showActions: true,
  showScore: true,
  showRationale: false,
  maxVisibleActions: 3,
};
