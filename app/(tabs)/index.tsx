import React, { useRef, useState } from "react";
import {
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import SectionCard from "../../components/SectionCard";

const BACKEND_URL = "http://192.168.40.236:8000";

export default function HomeScreen() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  const parseSections = (text: string) => {
    if (!text.includes("##")) return null;

    const parts = text.split("## ").filter(Boolean);

    return parts.map((p) => {
      const lines = p.split("\n");
      return {
        title: lines[0].trim(),
        content: lines.slice(1).join("\n").trim(),
      };
    });
  };

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMsg = input;
    setInput("");

    setMessages((prev) => [...prev, { type: "user", text: userMsg }]);

    try {
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMsg }),
      });

      const data = await res.json();
      const text = data.message || "";

      const sections = parseSections(text);

      if (sections) {
        setMessages((prev) => [
          ...prev,
          ...sections.map((s) => ({
            type: "section",
            title: s.title,
            content: s.content,
          })),
        ]);
      } else {
        setMessages((prev) => [
          ...prev,
          { type: "joy", text },
        ]);
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { type: "error", text: "Connection error" },
      ]);
    }
  };

  return (
    <SafeAreaView
      style={{
        flex: 1,
        backgroundColor: "#020617",
      }}
    >
      <View
        style={{
          flex: 1,
          paddingHorizontal: 16,
          paddingBottom: 10,
        }}
      >
        <View style={{ paddingTop: 6, paddingBottom: 14 }}>
          <Text style={{ fontSize: 20 }}>
            <Text style={{ color: "#FFFFFF" }}>FeedSoul</Text>
            <Text style={{ color: "#FFD06A", fontWeight: "600" }}>Joy</Text>
            <Text style={{ color: "#9CA3AF" }}> · Lifestyle</Text>
          </Text>
        </View>

        <ScrollView
          ref={scrollRef}
          style={{ flex: 1, marginBottom: 10 }}
          onContentSizeChange={() =>
            scrollRef.current?.scrollToEnd({ animated: true })
          }
        >
          {messages.map((m, i) => {
            if (m.type === "user") {
              return (
                <View
                  key={i}
                  style={{
                    alignSelf: "flex-end",
                    backgroundColor: "#DCF8C6",
                    padding: 12,
                    borderRadius: 14,
                    marginVertical: 6,
                    maxWidth: "85%",
                  }}
                >
                  <Text
                    style={{
                      color: "#111827",
                      fontSize: 15,
                      lineHeight: 22,
                    }}
                  >
                    {m.text}
                  </Text>
                </View>
              );
            }

            if (m.type === "joy") {
              return (
                <View
                  key={i}
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: "#071427",
                    padding: 12,
                    borderRadius: 14,
                    marginVertical: 6,
                    maxWidth: "85%",
                    borderWidth: 1,
                    borderColor: "rgba(212,168,67,0.08)",
                  }}
                >
                  <Text
                    style={{
                      color: "#FFFFFF",
                      fontSize: 15,
                      lineHeight: 22,
                    }}
                  >
                    {m.text}
                  </Text>
                </View>
              );
            }

            if (m.type === "section") {
              return (
                <SectionCard
                  key={i}
                  title={m.title}
                  content={m.content}
                />
              );
            }

            if (m.type === "error") {
              return (
                <Text key={i} style={{ color: "red" }}>
                  {m.text}
                </Text>
              );
            }

            return null;
          })}
        </ScrollView>

        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#071427",
            borderRadius: 14,
            padding: 6,
          }}
        >
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Ask something..."
            placeholderTextColor="#9CA3AF"
            style={{
              flex: 1,
              color: "#FFFFFF",
              padding: 10,
            }}
          />
          <TouchableOpacity
            onPress={sendMessage}
            style={{
              backgroundColor: "#FFD06A",
              paddingHorizontal: 14,
              paddingVertical: 10,
              borderRadius: 10,
            }}
          >
            <Text style={{ color: "#000", fontWeight: "600" }}>Send</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}