import React from "react";
import { Text, View } from "react-native";
import type { ChatMessage } from "../app/types/coaching";

type Props = {
  msg: ChatMessage;
  enabled: boolean;
  colors: { muted: string; surface: string };
};

export function DebugFoodMetadata({ msg, enabled, colors }: Props) {
  if (!enabled) return null;
  if (msg.role !== "assistant" || msg.status !== "complete") return null;

  const hasAny =
    (msg.foods && msg.foods.length > 0) ||
    (msg.unknownFoods && msg.unknownFoods.length > 0) ||
    msg.traceId;

  if (!hasAny) return null;

  return (
    <View style={{ marginTop: 6, padding: 8, borderRadius: 10, backgroundColor: colors.surface }}>
      {msg.foods?.length ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>foods: {msg.foods.join(", ")}</Text>
      ) : null}
      {msg.unknownFoods?.length ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>unknown: {msg.unknownFoods.join(", ")}</Text>
      ) : null}
      {msg.traceId ? (
        <Text style={{ color: colors.muted, fontSize: 11 }}>trace: {msg.traceId}</Text>
      ) : null}
    </View>
  );
}
