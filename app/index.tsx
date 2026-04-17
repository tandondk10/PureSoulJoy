import { C } from "@/constants/colors";
import { profiles } from "@/data/profiles";
//import { loadUser, saveUser } from "@/utils/storage";
import { loadUser } from "@/utils/storage";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";

import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import SectionCard from "../components/SectionCard";

const BACKEND_URL = "http://192.168.40.138:8000";


// Voice thresholds — all configurable, no hardcoded values per spec §2.1
const SILENCE_DB_THRESHOLD = -40; // dBFS — below = silence
const SOFT_PAUSE_MS = 2000;       // 2s — show "Still listening..."
const FINAL_PAUSE_MS = 4000;      // 4s — stop and send
const MAX_RECORDING_MS = 20000;   // 20s — hard stop failsafe
const REQUEST_TIMEOUT_MS = 40000; // from 20s tp 40s — backend request timeout
const UX_RUNMODE = process.env.EXPO_PUBLIC_UX_RUNMODE || "screen";

console.log("UX_RUNMODE:", UX_RUNMODE);


type VoiceState = "IDLE" | "RECORDING" | "PROCESSING" | "PLAYING";

type Section = { title: string; content: string };

type QueryBlock = {
  id: string;
  query: string;
  status: "loading" | "complete" | "error";
  source: "voice" | "text";
  sections?: Section[];
  rawText?: string;
  errorMessage?: string;
  mode?: string;
  score?: number;
};

// Valid state transitions per spec §4.2
// IDLE → PROCESSING added to support keyboard submit from IDLE
const VALID_TRANSITIONS: Record<VoiceState, VoiceState[]> = {
  IDLE: ["RECORDING", "PROCESSING"],
  RECORDING: ["PROCESSING", "IDLE"],
  PROCESSING: ["PLAYING", "IDLE"],
  PLAYING: ["IDLE", "RECORDING", "PROCESSING"],
};

export default function HomeScreen() {
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<QueryBlock[]>([]);
  const [input, setInput] = useState("");

  const router = useRouter();
  const { user, setUser } = useUser();
  const [checkingUser, setCheckingUser] = useState(true);

  // other refs and state...

  // Refs — readable inside callbacks, AppState handler, timers
  const voiceStateRef = useRef<VoiceState>("IDLE");
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const activeRecordingRef = useRef<Audio.Recording | null>(null);
  const isStoppingRef = useRef(false);
  const lastSpeechTimeRef = useRef(Date.now());
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const discardResponseRef = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const blockRefs = useRef<Record<string, View | null>>({});
  const lastScrollIdRef = useRef<string | null>(null);
  const lastSubmitRef = useRef(0); // ✅ debounce guard

  // 🔹 Effect 1 — Recording cleanup (runs once)
  useEffect(() => {
    const cleanup = async () => {
      const dangling = activeRecordingRef.current;

      if (dangling) {
        activeRecordingRef.current = null;
        try {
          await dangling.stopAndUnloadAsync();
        } catch (e) {
          console.log("cleanup error", e);
        }
      }
    };

    cleanup();
  }, []);

  // ─── State machine ───────────────────────────────────────────────────────

  const updateVoiceState = (next: VoiceState) => {
    const current = voiceStateRef.current;
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(next)) {
      console.warn(`[VoiceState] Invalid transition: ${current} → ${next} — ignored`);
      return;
    }
    console.log(`[VoiceState] ${current} → ${next}`);
    voiceStateRef.current = next;
    setVoiceState(next);
  };

  const handleIntentRouting = (intent: string, data: any) => {
    console.log("🧠 Routing intent:", intent, "mode:", data.mode);

    // ✅ ONLY mode controls navigation
    if (data.mode === "meal") {
      router.push({
        pathname: "/meal-main",
        params: {
          mode: UX_RUNMODE,
          intent: intent,
          score: data.score,
          items: JSON.stringify(data.meal_items || []),
        },
      });
      return;
    }

    // ✅ chat mode → stay here
  };

  // future:
  // cholesterol → meal-main?intent=cholesterol
  // weight → meal-main?intent=weight

  //🔹 Effect 2 — Load user on app start
  useEffect(() => {
    const initUser = async () => {
      //await saveUser("");   // 🔥 TEMP ONLY
      const id = await loadUser();
      console.log("LOADED USER:", id);

      if (!id || !profiles[id]) {
        setUser(null);
        router.replace("/login");
      } else {
        setUser(profiles[id]);
      }

      setCheckingUser(false);
    };

    initUser();
  }, []);

  // 🔹 Effect 3 — App state (background / interrupt handling)

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (nextAppState) => {
      if (nextAppState !== "background" && nextAppState !== "inactive") return;

      const state = voiceStateRef.current;

      if (state === "RECORDING") {
        isStoppingRef.current = true;

        const rec = activeRecordingRef.current;
        activeRecordingRef.current = null;

        if (rec) {
          try {
            await rec.stopAndUnloadAsync();
          } catch { }
        }

        if (maxDurationTimerRef.current) {
          clearTimeout(maxDurationTimerRef.current);
          maxDurationTimerRef.current = null;
        }

        clearThinkingTimer();
        updateVoiceState("IDLE");
        setStatusText(null);
      } else if (state === "PROCESSING") {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        discardResponseRef.current = true;

        clearThinkingTimer();
        updateVoiceState("IDLE");
        setStatusText(null);
      } else if (state === "PLAYING") {
        await stopAnyPlayback();

        clearThinkingTimer();
        updateVoiceState("IDLE");
        setStatusText(null);
      }
    });

    return () => sub.remove();
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────
  const isErrorStatus =
    statusText !== null &&
    (statusText.includes("timed out") ||
      statusText.includes("issue") ||
      statusText.includes("Could not") ||
      statusText.includes("Please say") ||
      statusText.includes("access is required"));

  if (checkingUser) return null;

  const isProcessing = voiceState === "PROCESSING";
  const isRecording = voiceState === "RECORDING";
  const handleSendPress = () => {
    if (voiceStateRef.current === "PROCESSING") return;

    const query = input.trim();
    if (!query) return;

    Keyboard.dismiss(); // ✅ THIS is why import will stay

    const traceId = Date.now().toString(); // simple id (or use createTraceId if you have it)

    console.log("🔥 KEYBOARD SEND:", query);

    sendKeyboardQuery(query, traceId);
  };

  const handleMicPress = async () => {
    console.log("🎤 MIC PRESSED, state:", voiceStateRef.current);

    const state = voiceStateRef.current;

    if (state === "PLAYING") {
      await stopAnyPlayback();
      updateVoiceState("IDLE");
      return;
    }

    if (state === "IDLE") {
      await startRecording();
      return;
    }

    if (state === "RECORDING") {
      await stopRecordingAndSend(false);
      return;
    }
  };

  const sendKeyboardQuery = async (query: string, traceId: string) => {
    console.log("🚀 API CALL START:", query);

    setBlocks((prev) => [
      ...prev,
      { id: traceId, query, status: "loading", source: "text" }
    ]);

    try {
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query,
          voice: false,
          user_profile: user ?? {},
          traceId,
        }),
      });

      const data = await res.json();

      const text =
        typeof data.message === "string" && data.message.trim().length > 0
          ? data.message
          : "No response";

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === traceId
            ? {
              ...b,
              status: "complete",
              rawText: text,
              mode: data.mode,
              score: data.score,
            }
            : b
        )
      );

      console.log("✅ API SUCCESS:", data);
      const intent = data.intent || "general";
      setStatusText("Opening meal insights...");

      setTimeout(() => {
        handleIntentRouting(intent, data, "text");
      }, 400);

    } catch (err) {
      console.log("❌ API ERROR:", err);

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === traceId
            ? {
              ...b,
              status: "error",
              errorMessage: "API failed",
            }
            : b
        )
      );
    }
  };
  const sendVoiceQuery = async (uri: string, traceId: string) => {
    console.log("🎤 VOICE SEND:", uri);

    updateVoiceState("PROCESSING");
    setStatusText("Processing voice...");

    try {
      const formData = new FormData();

      formData.append("audio_file", {
        uri,
        name: "audio.m4a",
        type: "audio/m4a",
      } as any);

      formData.append("traceId", traceId);
      formData.append("user_profile", JSON.stringify(user ?? {}));

      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        body: formData,
      });

      const text = await res.text();

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.log("❌ RAW RESPONSE:", text);
        throw new Error("Invalid JSON from backend");
      }

      console.log("🎤 VOICE RESPONSE:", data);

      // ✅ SAME UI update as keyboard
      setBlocks((prev) => [
        ...prev,
        {
          id: traceId,
          query: "Voice input",
          status: "complete",
          rawText: data.message,
          mode: data.mode,
          score: data.score,
          meal_items: data.meal_items,
          source: "voice",
        },
      ]);

      // ✅ HYBRID routing
      const intent = data.intent || "general";
      handleIntentRouting(intent, data, "voice");

      updateVoiceState("IDLE");
      setStatusText(null);

    } catch (err) {
      console.log("❌ VOICE ERROR:", err);
      updateVoiceState("IDLE");
      setStatusText("Voice failed. Try again.");
    }
  };

  const startRecording = async () => {
    try {
      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) return;

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();

      await rec.prepareToRecordAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      );

      await rec.startAsync();

      activeRecordingRef.current = rec;

      updateVoiceState("RECORDING");
      setStatusText("Listening...");
    } catch (e) {
      console.log("❌ startRecording error", e);
    }
  };

  const stopRecordingAndSend = async () => {
    try {
      const rec = activeRecordingRef.current;
      if (!rec) return;

      activeRecordingRef.current = null;

      await rec.stopAndUnloadAsync();

      const uri = rec.getURI();
      console.log("🎤 URI:", uri);

      const traceId = Date.now().toString();

      await sendVoiceQuery(uri!, traceId);
    } catch (e) {
      console.log("❌ stopRecording error", e);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          flex: 1,
          backgroundColor: "#0B0F14",
        }}
      >
        <AppHeader />

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
                backgroundColor: C.bg,
                paddingHorizontal: 16,
                paddingTop: 6,
                paddingBottom: 100,
              }}
            >
              {blocks.map((block, index) => {
                if (!block) return null;

                return (
                  <View
                    key={block.id || index}
                    ref={(ref) => {
                      if (block?.id) {
                        if (ref) blockRefs.current[block.id] = ref;
                        else delete blockRefs.current[block.id];
                      }
                    }}
                  >
                    {/* Query bubble */}
                    {typeof block.query === "string" && block.query.trim() ? (
                      <View
                        style={{
                          alignSelf: "flex-end",
                          backgroundColor:
                            block.source === "voice" ? "#CDEBCC" : C.userBubble,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 14,
                          marginVertical: 3,
                          maxWidth: "80%",
                        }}
                      >
                        <Text style={{ color: C.textDark }}>
                          {block.source === "voice" ? "🎤 " : ""}
                          {block.query}
                        </Text>
                      </View>
                    ) : null}

                    {/* Loading */}
                    {block.status === "loading" && (
                      <View style={{ padding: 10 }}>
                        <ActivityIndicator color={C.accent} />
                      </View>
                    )}

                    {/* Error */}
                    {block.status === "error" && (
                      <Text style={{ color: C.error, paddingVertical: 4 }}>
                        {block.errorMessage || "Something went wrong"}
                      </Text>
                    )}

                    {/* Complete */}
                    {block.status === "complete" ? (
                      block.mode === "meal" ? (
                        <MealCard block={block} />
                      ) : block.sections && block.sections.length > 0 ? (
                        block.sections.map((s, i) => (
                          <SectionCard key={i} title={s.title} content={s.content} />
                        ))
                      ) : typeof block.rawText === "string" ? (
                        <View
                          style={{
                            backgroundColor: C.surfaceAlt,
                            padding: 12,
                            borderRadius: 14,
                            marginVertical: 6,
                          }}
                        >
                          <Text style={{ color: C.text }}>
                            {block.rawText}
                          </Text>
                        </View>
                      ) : (
                        <Text style={{ color: "red" }}>⚠️ No content</Text>
                      )
                    ) : null}
                  </View>
                );
              })}
            </ScrollView>

            {/* Status indicator — separate from input field per spec §8.1, §8.2 */}
            {statusText ? (
              <View
                style={{
                  paddingHorizontal: 16,
                  paddingVertical: 6,
                  alignItems: "center",
                }}
              >
                <Text
                  style={{
                    color: isErrorStatus ? C.error : C.muted,
                    fontSize: 13,
                  }}
                >
                  {statusText}
                </Text>
              </View>
            ) : null}

            <View
              style={{
                paddingHorizontal: 16,
                paddingBottom: 6,
              }}
            >
              <Text
                style={{
                  color: C.muted,
                  fontSize: 12,
                  marginBottom: 6,
                }}
              >
                Quick actions
              </Text>

              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  justifyContent: "space-between",
                }}
              >
                {[
                  "🍽 Analyze my meal",
                  "🥗 Improve my meal",
                ].map((label) => (
                  <TouchableOpacity
                    key={label}
                    onPress={() => handleActionChip(label)}
                    style={{
                      width: "48%",
                      backgroundColor: C.surfaceAlt,
                      paddingVertical: 10,
                      paddingHorizontal: 12,
                      borderRadius: 14,
                      marginBottom: 8,
                    }}
                  >
                    <Text style={{ color: C.text }}>
                      {label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
            {/* Input bar */}
            <View
              style={{
                flexDirection: "row",
                backgroundColor: C.surface,
                borderRadius: 14,
                padding: 8,
                margin: 10,
                alignItems: "center",
              }}
            >
              {/* Input field — read-only during PROCESSING only, never overwritten by status — spec §8.1 */}
              <TextInput
                value={input}
                onChangeText={setInput}
                editable={!isProcessing}
                placeholder='Ask or speak… say “Go BuildJoy”'
                placeholderTextColor={C.muted}
                style={{ flex: 1, color: C.text }}
                onSubmitEditing={handleSendPress}
                returnKeyType="send"
              />

              {/* Mic button — red during RECORDING, disabled during PROCESSING */}
              <TouchableOpacity
                onPress={handleMicPress}
                disabled={isProcessing}
                style={{
                  marginRight: 8,
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  borderRadius: 10,
                  backgroundColor: isRecording
                    ? C.recordingRed
                    : C.surfaceAlt,
                  opacity: isProcessing ? 0.5 : 1,
                }}
              >
                <Text style={{ color: C.text }}>
                  {voiceState === "RECORDING" || voiceState === "PLAYING" ? "⏹" : "🎤"}
                </Text>
              </TouchableOpacity>

              {/* Send button */}
              <TouchableOpacity
                disabled={isProcessing}
                onPress={handleSendPress}
                style={{
                  backgroundColor: C.accent,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 10,
                  opacity: isProcessing ? 0.5 : 1,
                }}
              >
                <Text style={{ color: "#000" }}>Send</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </View>
    </SafeAreaView>
  )


};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.background,
    padding: 16,
  },
  form: {
    marginTop: 30,
  },
  input: {
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    borderRadius: 12,
    padding: 14,
    color: C.text,
    marginBottom: 12,
    backgroundColor: C.surface,
  },
  loginBtn: {
    backgroundColor: C.accent,
    padding: 14,
    borderRadius: 12,
    alignItems: "center",
    marginTop: 10,
  },
  loginText: {
    color: "#000",
    fontWeight: "600",
    fontSize: 16,
  },
  demoBtn: {
    marginTop: 20,
    alignItems: "center",
  },
  demoText: {
    color: C.muted,
    fontSize: 14,
  },
  error: {
    color: "red",
    marginBottom: 10,
  },
});

function MealCard({ block }: { block: any }) {
  return (
    <View
      style={{
        backgroundColor: "#111",
        padding: 14,
        borderRadius: 14,
        marginVertical: 6,
      }}
    >
      <Text style={{ color: "gold", fontSize: 16, marginBottom: 10 }}>
        Meal Score: {block.score ?? "-"}
      </Text>

      {block.sections && block.sections.length > 0 ? (
        block.sections.map((s: any, i: number) => (
          <View key={i} style={{ marginBottom: 10 }}>
            <Text style={{ color: "#aaa", fontSize: 13 }}>
              {s.title}
            </Text>
            <Text style={{ color: "white" }}>
              {s.content}
            </Text>
          </View>
        ))
      ) : typeof block.rawText === "string" ? (
        <Text style={{ color: "white" }}>
          {block.rawText}
        </Text>
      ) : null}
    </View>
  );
};