import React from "react";
import { Text, View } from "react-native";

const PROFILE = {
  name: "Deepak",
  condition: "diabetic",
  a1c: 8.0,
  focus: "Glucose",
  phenotype: "Spiker",
};

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
        {PROFILE.name} ·{" "}
        <Text style={{ color: "#FFD06A" }}>
          {PROFILE.condition} (A1C {PROFILE.a1c})
        </Text>{" "}
        · Focus: {PROFILE.focus} · {PROFILE.phenotype}
      </Text>
    </View>
  );
}