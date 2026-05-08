import React from "react";
import { View } from "react-native";
import type { UIAction } from "../../types/actions";
import type { UIRenderContract } from "../../types/renderContract";
import { DEFAULT_RENDER_CONTRACT } from "../../types/renderContract";
import { ActionCard } from "./ActionCard";

export type ActionListProps = {
  actions?: UIAction[];
  renderContract?: UIRenderContract;
};

export function ActionList({ actions = [], renderContract = DEFAULT_RENDER_CONTRACT }: ActionListProps) {
  if (!renderContract.showActions) return null;
  if (!actions.length) return null;

  const visibleActions = actions
    .filter((a) => a.isValid)
    .slice(0, renderContract.maxVisibleActions);

  if (!visibleActions.length) return null;

  return (
    <View testID="action-list">
      {visibleActions.map((action) => (
        <ActionCard
          key={action.id}
          action={action}
          showRationale={renderContract.showRationale}
        />
      ))}
    </View>
  );
}
