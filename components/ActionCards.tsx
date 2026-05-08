import React from "react";
import { Text, TouchableOpacity, View } from "react-native";
import type { ChatMessage } from "../app/types/coaching";

type Colors = {
  surface: string;
  muted: string;
  text: string;
};

type Props = {
  msg: ChatMessage;
  colors: Colors;
  onFeedback: (msg: ChatMessage, feedback: "helpful" | "not_helpful") => void;
  onActionTaken: (msg: ChatMessage) => void;
  onNextAction: (code: string) => void;
};

export function ActionCards({ msg, colors, onFeedback, onActionTaken, onNextAction }: Props) {
  if (msg.needsClarification) return null;
  if (msg.status !== "complete") return null;

  const hasActions = msg.topActions && msg.topActions.length > 0;
  const hasActionCodes = msg.topActionCodes && msg.topActionCodes.length > 0;
  const hasNextActions = msg.nextActionCodes && msg.nextActionCodes.length > 0;
  // ActionList (via AssistantMessageRenderer) handles display when rich actions exist
  const hasRichActions = Array.isArray(msg.actions) && msg.actions.length > 0;

  return (
    <>
      {hasActions && !hasRichActions && (
        <View
          style={{
            backgroundColor: colors.surface,
            borderRadius: 14,
            padding: 12,
            marginTop: 8,
          }}
        >
          <Text style={{ color: colors.muted, fontSize: 13, marginBottom: 6, fontWeight: "600" }}>
            Do this now:
          </Text>
          <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
            {msg.topActions!.join("\n")}
          </Text>
        </View>
      )}

      {hasActions && (
        <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
          {msg.feedbackSent ? (
            <Text style={{ color: colors.muted, fontSize: 13 }}>
              {msg.feedbackSent === "helpful" ? "Thanks for the feedback!" : "Got it, we'll improve."}
            </Text>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => onFeedback(msg, "helpful")}
                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#2D3748" }}
              >
                <Text style={{ color: colors.text, fontSize: 14 }}>👍 Helpful</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => onFeedback(msg, "not_helpful")}
                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#2D3748" }}
              >
                <Text style={{ color: colors.text, fontSize: 14 }}>👎 Not helpful</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {hasActionCodes && (
        <TouchableOpacity
          onPress={() => onActionTaken(msg)}
          disabled={msg.actionTaken}
          style={{
            marginTop: 8,
            paddingHorizontal: 16,
            paddingVertical: 8,
            borderRadius: 20,
            backgroundColor: msg.actionTaken ? "#1A2A1A" : "#1A3A1A",
            alignSelf: "flex-start",
          }}
        >
          <Text style={{ color: msg.actionTaken ? colors.muted : "#4ADE80", fontSize: 14, fontWeight: "600" }}>
            {msg.actionTaken ? "✔ You committed — start now" : "⚡ I'll do this"}
          </Text>
        </TouchableOpacity>
      )}

      {hasNextActions && (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>
            What's next?
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {msg.nextActionCodes!.map((code, idx) => (
              <TouchableOpacity
                key={code}
                activeOpacity={0.82}
                onPress={() => onNextAction(code)}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "#2D3748",
                  backgroundColor: colors.surface,
                }}
              >
                <Text style={{ color: colors.text, fontSize: 13 }}>
                  {msg.nextActionLabels?.[idx] ?? code.replace(/_/g, " ")}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}
    </>
  );
}
