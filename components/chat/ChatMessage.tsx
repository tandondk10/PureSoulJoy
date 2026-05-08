import React from "react";
import { ActivityIndicator, Text, View } from "react-native";
import type { UIMessage } from "../../src/contracts/backendResponse";
import { AssistantActionRenderer } from "./AssistantActionRenderer";

type Props = { message: UIMessage };

export function ChatMessage({ message }: Props) {
  return (
    <View testID={`chat-message-${message.role}-${message.traceId}`}>
      {message.pending ? <ActivityIndicator testID="message-pending" /> : null}
      <Text testID="message-text">{message.text}</Text>
      {message.error ? <Text testID="message-error">{message.error}</Text> : null}
      {message.role === "assistant" ? (
        <AssistantActionRenderer actions={message.actions} />
      ) : null}
    </View>
  );
}
