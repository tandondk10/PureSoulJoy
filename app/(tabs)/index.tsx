import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import ProfileStrip from "../../components/ProfileStrip";
import QuickChips from "../../components/QuickChips";
import SectionCard from "../../components/SectionCard";

const BACKEND_URL = "http://192.168.40.138:8000";

const COLORS = {
  background: "#0B0F14",
  surface: "#121821",
  surfaceAlt: "#071427",

  textPrimary: "#FFFFFF",
  textSecondary: "#9CA3AF",
  textDark: "#111827",

  aceAlt: "#120F24",
  accent: "#FFD06A",
  error: "#EF4444",

  userBubble: "#DCF8C6",
};
/*
--- OPTION 0: balanced dark ---
background: "#0B0F14",
surface: "#121821",
surfaceAlt: "#071427",
accent: "#FFD06A",

--- OPTION 1: PREMIUM DARK ---
background: "#080C10",
surface: "#10161D",
surfaceAlt: "#0A1018",
accent: "#EAB308",

--- OPTION 2: PURPLE MODERN ---
background: "#0B0F14",
surface: "#1A1630",
surfaceAlt: "#120F24",
accent: "#8B5CF6",

--- OPTION 3: GREEN HEALTH (your app theme?) ---
background: "#0B0F14",
surface: "#112018",
surfaceAlt: "#0A1510",
accent: "#22C55E",

--- OPTION 4: BLUE CLEAN ---
background: "#0B0F14",
surface: "#131A24",
surfaceAlt: "#0C131C",
accent: "#3B82F6",

--- OPTION 5: SOFT GREY ---
background: "#111827",
surface: "#1F2937",
surfaceAlt: "#111827",
accent: "#F59E0B",
*/

type Section = { title: string; content: string };

type QueryBlock = {
  id: string;
  query: string;
  status: "loading" | "complete" | "error";
  sections?: Section[];
  rawText?: string;
};

export default function HomeScreen() {
  const [blocks, setBlocks] = useState<QueryBlock[]>([]);
  const [input, setInput] = useState("");
  const [recording, setRecording] = useState<any>(null);

  const scrollRef = useRef<ScrollView>(null);
  const lockRef = useRef(false);
  const blockRefs = useRef<Record<string, View | null>>({});
  const lastScrollIdRef = useRef<string | null>(null);

  const parseSections = (text: string): Section[] | null => {
    if (!text || !text.includes("##")) return null;

    return text
      .split("## ")
      .filter(Boolean)
      .map((p) => {
        const lines = p.split("\n");
        return {
          title: String(lines[0] || "").trim(),
          content: String(lines.slice(1).join("\n") || "").trim(),
        };
      });
  };

  const scrollToBlock = (id: string) => {
    requestAnimationFrame(() => {
      const block = blockRefs.current[id];
      const scrollView = scrollRef.current;
      if (!block || !scrollView) return;

      block.measureLayout(
        scrollView,
        (_x, y) => {
          scrollView.scrollTo({
            y: Math.max(0, y - 20),
            animated: true,
          });
        },
        () => {}
      );
    });
  };

  const stopListening = async (rec: any) => {
    try {
      if (!rec) return;

      console.log("🛑 Stopping recording...");
      await rec.stopAndUnloadAsync();

      setRecording(null);

      const uri = rec.getURI();
      console.log("Recorded file:", uri);

      if (!uri) {
        throw new Error("Recording URI missing");
      }

      const isCAF = uri.endsWith(".caf");

      const formData = new FormData();
      formData.append("file", {
        uri,
        name: isCAF ? "audio.caf" : "audio.m4a",
        type: isCAF ? "audio/x-caf" : "audio/m4a",
      } as any);

      setInput("Transcribing...");

      const response = await fetch(`${BACKEND_URL}/transcribe`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`Transcription failed: HTTP ${response.status}`);
      }

      const data = await response.json();
      const transcribedText = (data.text || "").trim();

      console.log("TRANSCRIBE RESPONSE:", data);

      if (!transcribedText) {
        setInput("Could not transcribe");
        return;
      }

      setInput(transcribedText);
      await sendMessage(transcribedText);
    } catch (err) {
      console.error("Stop error:", err);
      setRecording(null);
      setInput("Voice failed. Try again.");
    } finally {
      try {
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
        });
      } catch {
        // ignore
      }
    }
  };

  const startListening = async () => {
    try {
      if (recording || lockRef.current) {
        console.log("🚫 Busy");
        return;
      }

      console.log("🎤 Requesting permission...");
      const permission = await Audio.requestPermissionsAsync();

      if (!permission.granted) {
        alert("Microphone permission required");
        return;
      }

      console.log("🎤 Starting recording...");
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      setRecording(rec);

      setTimeout(async () => {
        await stopListening(rec);
      }, 3000);
    } catch (err) {
      console.error("Recording error:", err);
      setRecording(null);
    }
  };

  const sendMessage = async (override?: string) => {
    if (lockRef.current) return;
    lockRef.current = true;

    const query = override ? override.trim() : input.trim();
    if (!query) {
      lockRef.current = false;
      return;
    }

    Keyboard.dismiss();
    requestAnimationFrame(() => setInput(""));

    const id = `${Date.now()}-${Math.random()}`;
    lastScrollIdRef.current = id;

    setBlocks((prev) => [...prev, { id, query, status: "loading" }]);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBlock(id);
      });
    });

    try {
      console.log("SENDING QUERY:", query);

      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query,
          voice: true,
        }),
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      console.log("QUERY RESPONSE:", data);

      const text =
        typeof data.message === "string"
          ? data.message
          : JSON.stringify(data.message || "");

      // 🔊 audio playback
      if (data.audio) {
        try {
          const fileUri = FileSystem.cacheDirectory + "tts.mp3";

          await FileSystem.writeAsStringAsync(fileUri, data.audio, {
            encoding: "base64" as any,
          });

          const { sound } = await Audio.Sound.createAsync({ uri: fileUri });

          console.log("AUDIO PLAYING");
          await sound.playAsync();

          sound.setOnPlaybackStatusUpdate((status) => {
            if ((status as any).didJustFinish) {
              console.log("AUDIO FINISHED");
              sound.unloadAsync();
            }
          });
        } catch (err) {
          console.log("AUDIO PLAY ERROR:", err);
        }
      } else {
        console.log("NO AUDIO RETURNED");
      }

      const sections = parseSections(text);

      setBlocks((prev) => {
        const updated = prev.map((b) =>
          b.id === id
            ? {
                ...b,
                status: "complete",
                sections: sections ?? undefined,
                rawText: sections ? undefined : text,
              }
            : b
        );

        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            scrollToBlock(id);
          });
        });

        return updated;
      });
    } catch (err) {
      console.log("QUERY ERROR:", err);

      setBlocks((prev) =>
        prev.map((b) => (b.id === id ? { ...b, status: "error" } : b))
      );
    } finally {
      lockRef.current = false;
    }
  };

  const handleChip = (value: string) => {
    setInput("");
    sendMessage(value);
  };

  const isLoading = blocks.some((b) => b.status === "loading");

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }}>
      <View style={{ flex: 1, backgroundColor: COLORS.background }}>
        <View style={{ paddingHorizontal: 16, paddingTop: 2, paddingBottom: 6 }}>
          <ProfileStrip />

          <Text style={{ fontSize: 20 }}>
            <Text style={{ color: COLORS.textPrimary }}>Improve</Text>
            <Text style={{ color: COLORS.accent, fontWeight: "600" }}>Me</Text>
            <Text style={{ color: COLORS.textSecondary }}> · Lifestyle</Text>
          </Text>

          <Text
            style={{
              color: COLORS.textSecondary,
              fontSize: 13,
              marginTop: 2,
            }}
          >
            Better lifestyle. Better future.
          </Text>

          <View style={{ marginTop: 4, opacity: isLoading ? 0.5 : 1 }}>
            <QuickChips onSelect={handleChip} />
          </View>
        </View>

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={80}
        >
          <View style={{ flex: 1 }}>
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                backgroundColor: COLORS.background,
                paddingHorizontal: 16,
                paddingTop: 6,
                paddingBottom: 100,
              }}
              onContentSizeChange={() => {
                if (lastScrollIdRef.current) {
                  scrollToBlock(lastScrollIdRef.current);
                }
              }}
            >
              {blocks.map((block) => (
                <View
                  key={block.id}
                  ref={(ref) => {
                    if (ref) blockRefs.current[block.id] = ref;
                    else delete blockRefs.current[block.id];
                  }}
                >
                  <View
                    style={{
                      alignSelf: "flex-end",
                      backgroundColor: COLORS.userBubble,
                      paddingVertical: 6,
                      paddingHorizontal: 10,
                      borderRadius: 14,
                      marginVertical: 3,
                      maxWidth: "80%",
                    }}
                  >
                    <Text style={{ color: COLORS.textDark }}>{block.query}</Text>
                  </View>

                  {block.status === "loading" && (
                    <View style={{ padding: 10 }}>
                      <ActivityIndicator color={COLORS.accent} />
                    </View>
                  )}

                  {block.status === "error" && (
                    <Text style={{ color: COLORS.error }}>Connection error</Text>
                  )}

                  {block.status === "complete" &&
                    block.sections?.map((s, i) => (
                      <SectionCard key={i} title={s.title} content={s.content} />
                    ))}

                  {block.status === "complete" && block.rawText && (
                    <View
                      style={{
                        backgroundColor: COLORS.surfaceAlt,
                        padding: 12,
                        borderRadius: 14,
                        marginVertical: 6,
                      }}
                    >
                      <Text style={{ color: COLORS.textPrimary }}>{block.rawText}</Text>
                    </View>
                  )}
                </View>
              ))}
            </ScrollView>

            <View
              style={{
                flexDirection: "row",
                backgroundColor: COLORS.surface,
                borderRadius: 14,
                padding: 8,
                margin: 10,
                alignItems: "center",
              }}
            >
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!isLoading}
                placeholder="Ask something..."
                placeholderTextColor={COLORS.textSecondary}
                style={{ flex: 1, color: COLORS.textPrimary }}
              />

              <TouchableOpacity
                disabled={isLoading || !!recording}
                onPress={startListening}
                style={{
                  marginRight: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: COLORS.surfaceAlt,
                  opacity: isLoading || recording ? 0.5 : 1,
                }}
              >
                <Text style={{ color: COLORS.textPrimary }}>🎤</Text>
              </TouchableOpacity>

              <TouchableOpacity
                disabled={isLoading}
                onPress={() => sendMessage()}
                style={{
                  backgroundColor: COLORS.accent,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  opacity: isLoading ? 0.5 : 1,
                }}
              >
                <Text style={{ color: "#000" }}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  );
}
