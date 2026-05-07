import React from "react";
import { Text, View } from "react-native";
import type { ChatMessage } from "../app/types/coaching";

type Colors = {
  userBubble: string;
  textDark: string;
};

type Props = {
  msg: ChatMessage;
  colors: Colors;
};

export function UserMessage({ msg, colors }: Props) {
  const bg = msg.source === "voice" ? "#CDEBCC" : colors.userBubble;

  return (
    <View
      style={{
        alignSelf: "flex-end",
        backgroundColor: bg,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRadius: 14,
        marginVertical: 3,
        maxWidth: "80%",
      }}
    >
      <Text style={{ color: colors.textDark }}>{msg.text || ""}</Text>
    </View>
  );
}
