import React from "react";
import { Text, TouchableOpacity, View } from "react-native";

type Props = {
  onSelect: (value: string) => void;
};

const chips = ["Check BP", "Check Glucose", "Check Cholesterol"];

export default function QuickChips({ onSelect }: Props) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        marginBottom: 10,
      }}
    >
      {chips.map((c) => (
        <TouchableOpacity
          key={c}
          onPress={() => onSelect(c)}
          style={{
            backgroundColor: "#071427",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: "rgba(212,168,67,0.1)",
          }}
        >
          <Text style={{ color: "#FFD06A", fontSize: 13 }}>{c}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}