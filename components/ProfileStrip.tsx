import React from "react";
import { Text, View } from "react-native";

export default function ProfileStrip() {
  return (
    <View
      style={{
        backgroundColor: "#071427",
        borderRadius: 12,
        paddingVertical: 8,
        paddingHorizontal: 12,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: "rgba(212,168,67,0.08)",
      }}
    >
      <Text style={{ color: "#9CA3AF", fontSize: 13 }}>
        Deepak · BP focus today · Last meal: Lunch
      </Text>
    </View>
  );
}