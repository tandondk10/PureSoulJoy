import React from "react";
import { View } from "react-native";
import type { UIAction } from "../../src/contracts/backendResponse";
import { ActionCard } from "./ActionCard";

type Props = { actions?: UIAction[] };

export function AssistantActionRenderer({ actions = [] }: Props) {
  if (!actions.length) return null;
  const sorted = [...actions].sort((a, b) => a.priority - b.priority);
  return (
    <View testID="assistant-actions">
      {sorted.map((action) => (
        <ActionCard key={action.id} action={action} />
      ))}
    </View>
  );
}
