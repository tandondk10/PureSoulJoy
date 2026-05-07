import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { ChatMessage } from "../app/types/coaching";

type Colors = {
  surfaceAlt: string;
  accent: string;
  error: string;
  muted: string;
};

type Props = {
  msg: ChatMessage;
  colors: Colors;
};

export function AssistantMessage({ msg, colors }: Props) {
  const isLoading = msg.status === "loading";
  const isError = msg.status === "error";
  const isCancelled = msg.status === "cancelled";
  const displayText = getDisplayText(msg);

  return (
    <View
      style={{
        alignSelf: "flex-start",
        backgroundColor: isError ? "#3A1A1A" : colors.surfaceAlt,
        padding: 12,
        borderRadius: 14,
        marginVertical: 6,
        maxWidth: "85%",
      }}
    >
      {msg.context ? (
        <Text style={{ color: colors.muted, fontSize: 12, marginBottom: 6 }}>
          {msg.context}
        </Text>
      ) : null}

      {isLoading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
            Thinking...
          </Text>
        </View>
      ) : isError ? (
        <Text style={{ color: colors.error, fontSize: 16, lineHeight: 22 }}>
          {displayText}
        </Text>
      ) : isCancelled ? (
        <Text style={{ color: colors.muted, fontSize: 16, lineHeight: 22 }}>
          {displayText || "Cancelled."}
        </Text>
      ) : msg.sections && msg.sections.length > 0 ? (
        <View>
          {msg.sections.map((s, i) => (
            <View
              key={`${msg.id}-s${i}`}
              style={{ marginBottom: i < msg.sections!.length - 1 ? 10 : 0 }}
            >
              <Text style={{ color: "white", fontWeight: "700", marginBottom: 4 }}>
                {s.title}
              </Text>
              <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
                {s.content}
              </Text>
            </View>
          ))}
        </View>
      ) : (
        <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
          {displayText || "I could not prepare a response. Please try again."}
        </Text>
      )}
    </View>
  );
}

function getDisplayText(msg: ChatMessage): string {
  if (msg.status === "loading") return "Thinking...";
  if (msg.status === "error") return msg.errorMessage || msg.text || "Something went wrong.";
  if (msg.status === "cancelled") return msg.text || "Cancelled.";
  return msg.rawText?.trim() || msg.text?.trim() || "I could not prepare a response. Please try again.";
}
