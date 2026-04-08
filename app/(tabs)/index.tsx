import React, { useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
} from "react-native";

import { SafeAreaView } from "react-native-safe-area-context";
import ProfileStrip from "../../components/ProfileStrip";
import QuickChips from "../../components/QuickChips";
import SectionCard from "../../components/SectionCard";

const BACKEND_URL = "http://192.168.40.236:8000";

export default function HomeScreen() {
  const [messages, setMessages] = useState<any[]>([]);
  const [input, setInput] = useState("");

  const scrollRef = useRef<ScrollView>(null);

  const parseSections = (text: string) => {
    if (!text || typeof text !== "string") return null;
    if (!text.includes("##")) return null;

    return text.split("## ").filter(Boolean).map((p) => {
      const lines = p.split("\n");
      return {
        title: String(lines[0] || "").trim(),
        content: String(lines.slice(1).join("\n") || "").trim(),
      };
    });
  };

  const scrollToBottom = () => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  const sendMessage = async (override?: string) => {
    const userMsg = (override ?? input).trim();
    if (!userMsg) return;

    setInput("");

    setMessages((prev) => [
      ...prev,
      { type: "user", text: userMsg },
    ]);

    try {
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: userMsg }),
      });

      const data = await res.json();

      const text =
        typeof data.message === "string"
          ? data.message
          : JSON.stringify(data.message || "");

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

      scrollToBottom(); // ✅ only after response

    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { type: "error", text: "Connection error" },
      ]);
    }
  };

  const handleChip = (value: any) => {
    const safe = typeof value === "string" ? value : String(value);
    sendMessage(safe);
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0B1220" }}>

      {/* HEADER */}
      <View style={{ paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 }}>
        <ProfileStrip />

        <Text style={{ fontSize: 20 }}>
          <Text style={{ color: "#FFFFFF" }}>FeedSoul</Text>
          <Text style={{ color: "#FFD06A", fontWeight: "600" }}>Joy</Text>
          <Text style={{ color: "#9CA3AF" }}> · Lifestyle</Text>
        </Text>

        <QuickChips onSelect={handleChip} />
      </View>

      {/* MAIN */}
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={90}
      >
        <View style={{ flex: 1 }}>

          {/* CHAT */}
          <ScrollView
            ref={scrollRef}
            style={{ flex: 1 }}
            contentContainerStyle={{
              flexGrow: 1,            // 🔥 CRITICAL
              paddingHorizontal: 16,
              paddingTop: 10,
              paddingBottom: 120,
            }}
            keyboardShouldPersistTaps="always"
            contentOffset={{ y: 0 }}   // 🔥 start at top
          >
            {messages.map((m, i) => {
              if (m.type === "user") {
                return (
                  <View key={i} style={{
                    alignSelf: "flex-end",
                    backgroundColor: "#DCF8C6",
                    padding: 12,
                    borderRadius: 14,
                    marginVertical: 6,
                    maxWidth: "80%",
                  }}>
                    <Text style={{ color: "#111827" }}>{m.text}</Text>
                  </View>
                );
              }

              if (m.type === "joy") {
                return (
                  <View key={i} style={{
                    alignSelf: "flex-start",
                    backgroundColor: "#071427",
                    padding: 12,
                    borderRadius: 14,
                    marginVertical: 6,
                    maxWidth: "85%",
                  }}>
                    <Text style={{ color: "#FFFFFF" }}>{m.text}</Text>
                  </View>
                );
              }

              if (m.type === "section") {
                return (
                  <SectionCard key={i} title={m.title} content={m.content} />
                );
              }

              return null;
            })}
          </ScrollView>

          {/* INPUT */}
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={{
              position: "absolute",
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 10,
              paddingBottom: Platform.OS === "ios" ? 25 : 10,
              backgroundColor: "#0B1220",
            }}>
              <View style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#0F1B2E",
                borderRadius: 14,
                padding: 8,
              }}>
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
                  onPress={() => {
                    Keyboard.dismiss();
                    sendMessage();
                  }}
                  style={{
                    backgroundColor: "#FFD06A",
                    paddingHorizontal: 14,
                    paddingVertical: 10,
                    borderRadius: 10,
                  }}
                >
                  <Text style={{ color: "#000", fontWeight: "600" }}>
                    Send
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>

        </View>
      </KeyboardAvoidingView>

    </SafeAreaView>
  );
}