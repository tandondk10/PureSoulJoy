import React from "react";
import { View } from "react-native";
import type { ChatMessage } from "../../app/types/coaching";
import { DEFAULT_RENDER_CONTRACT } from "../../types/renderContract";
import { AssistantMessage } from "../AssistantMessage";
import { ActionList } from "../actions/ActionList";

type Colors = {
  surfaceAlt: string;
  accent: string;
  error: string;
  muted: string;
};

type Props = {
  message: ChatMessage;
  colors: Colors;
};

export function AssistantMessageRenderer({ message, colors }: Props) {
  const renderContract = message.renderContract || DEFAULT_RENDER_CONTRACT;
  const showActions =
    message.status === "complete" &&
    !message.needsClarification &&
    renderContract.showActions &&
    Array.isArray(message.actions) &&
    message.actions.length > 0;

  return (
    <View testID={`assistant-message-${message.id}`}>
      <AssistantMessage msg={message} colors={colors} />
      {showActions ? (
        <ActionList actions={message.actions} renderContract={renderContract} />
      ) : null}
    </View>
  );
}
