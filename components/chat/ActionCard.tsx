import React from "react";
import { Text, View } from "react-native";
import type { UIAction } from "../../src/contracts/backendResponse";

type Props = { action: UIAction };

export function ActionCard({ action }: Props) {
  return (
    <View testID={`action-card-${action.id}`}>
      <Text testID="action-title">{action.title}</Text>
      <Text testID="action-description">{action.description}</Text>
      {action.durationMinutes ? (
        <Text testID="action-duration">{action.durationMinutes} min</Text>
      ) : null}
      {action.intensity ? (
        <Text testID="action-intensity">{action.intensity}</Text>
      ) : null}
    </View>
  );
}
