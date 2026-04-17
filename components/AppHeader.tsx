import { C } from "@/constants/colors";
import { useUser } from "@/context/UserContext";
import React from "react";
import { Text, View } from "react-native";

export default function AppHeader({
  showProfile = true,
}: {
  showProfile?: boolean;
}) {
  const { user } = useUser();

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
          <Text style={{ color: C.text }}>Build</Text>
          <Text style={{ color: C.accent }}>Joy</Text>
          <Text style={{ color: C.muted, opacity: 0.5 }}>{" · Health"}</Text>
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
          Improve daily. Live healthy.
        </Text>

        {/* 🔹 PROFILE SECTION */}
        {showProfile && user && (
          <View
            style={{
              marginTop: 8,
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
              {user.name}
            </Text>

            {/* CHIPS */}
            {[
              user.a1c ? `A1C ${user.a1c}` : null,
              user.focus ? `${user.focus} Focus` : null,
              user.phenotype,
            ]
              .filter(Boolean)
              .map((item) => (
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
        )}
      </View>
    </View>
  );
}