import { C } from "@/constants/colors";
import React from "react";
import { Text, View } from "react-native";

export default function AppHeader() {
  return (
    <View style={{ paddingTop: 4, paddingBottom: 8 }}>
      <View
        style={{
          backgroundColor: C.surface,
          borderRadius: 22,
          paddingVertical: 10,
          paddingHorizontal: 16,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.08)",
          shadowColor: C.accent,
          shadowOpacity: 0.10,
          shadowRadius: 6,
          shadowOffset: { width: 0, height: 2 },
        }}
      >
        {/* 🔹 TITLE */}
        <Text style={{ fontSize: 26, fontWeight: "600", lineHeight: 28 }}>
          <Text style={{ color: C.text }}>Better</Text>
          <Text style={{ color: C.accent }}>Me</Text>
          <Text style={{ color: C.muted, opacity: 0.5 }}>{" · Daily"}</Text>
        </Text>

        {/* 🔹 TAGLINE */}
        <Text
          style={{
            color: C.muted,
            fontSize: 13,
            marginTop: 1,
            opacity: 0.75,
            lineHeight: 16,
          }}
        >
          Better meals. Better habits. Better you.
        </Text>

        {/* 🔹 PROFILE SECTION */}
        <View
          style={{
            marginTop: 8,   // 👈 tight but visible separation
            paddingTop: 8,
            borderTopWidth: 1,
            borderTopColor: "rgba(255,255,255,0.06)",

            flexDirection: "row",
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          {/* NAME */}
          <Text
            style={{
              color: C.text,
              fontSize: 15,
              fontWeight: "500",
              marginRight: 8,
            }}
          >
            Deepak
          </Text>

          {/* CHIPS */}
          {["A1C 8", "Glucose Focus", "Spiker"].map((item) => (
            <View
              key={item}
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginRight: 8,
                marginBottom: 2,
              }}
            >
              <View
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: 2,
                  backgroundColor: C.accent,
                  marginRight: 4,
                }}
              />
              <Text
                style={{
                  color: C.muted,
                  fontSize: 12,
                }}
              >
                {item}
              </Text>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}