import { C } from "@/constants/colors";
import { profiles } from "@/data/profiles";
//import { loadUser, saveUser } from "@/utils/storage";
import { loadUser } from "@/utils/storage";
import { Audio } from "expo-av";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState, // ✅ ADD THIS LINE
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import SectionCard from "../components/SectionCard";
import { createTraceId, logTrace } from "../utils/trace";

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
  const [pendingMeal, setPendingMeal] = useState<string | null>(null);

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

  const navigatedToMealRef = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const blockRefs = useRef<Record<string, View | null>>({});
  const lastScrollIdRef = useRef<string | null>(null);
  const lastSubmitRef = useRef(0); // ✅ debounce guard


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
    console.log("🧠 Routing intent:", intent);

    if (intent === "glucose") {
      setStatusText("Do you want to analyze a meal?");
      return;
    }

    // future:
    // cholesterol → meal-main?intent=cholesterol
    // weight → meal-main?intent=weight
  };

  // ─── Utilities ───────────────────────────────────────────────────────────

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
      const sv = scrollRef.current;
      if (!block || !sv) return;
      block.measureLayout(
        sv as any,
        (_x: number, y: number) =>
          sv.scrollTo({ y: Math.max(0, y - 20), animated: true }),
        () => { }
      );
    });
  };
  // ✅ ADD THIS RIGHT BELOW
  const smoothScroll = (id: string) => {
    if (lastScrollIdRef.current === id) return; // 🔒 prevent duplicate scrolls
    lastScrollIdRef.current = id;

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        scrollToBlock(id);
      });
    });
  };

  const clearThinkingTimer = () => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
  };

  const startThinkingTimer = (message = "Almost there...", delay = 1500) => {
    clearThinkingTimer();
    thinkingTimerRef.current = setTimeout(() => {
      if (voiceStateRef.current === "PROCESSING" && !discardResponseRef.current) {
        setStatusText((current) => {
          if (!current || current === "Thinking..." || current === "Processing...") {
            return message;
          }
          return current; // 🔒 do not override error or final messages
        });
      }
    }, delay);
  };
  // ─── Audio playback ──────────────────────────────────────────────────────

  const stopAnyPlayback = async () => {
    const sound = activeSoundRef.current;
    if (!sound) return;
    activeSoundRef.current = null;
    try {
      await sound.stopAsync();
      await sound.unloadAsync();
    } catch {
      // already stopped or unloaded — ignore
    }
  };

  const playAudio = async (base64: string) => {
    await stopAnyPlayback();

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (!base64 || typeof base64 !== "string" || base64.length < 50) {
        console.warn("[playAudio] invalid base64 — text-only fallback");
        updateVoiceState("IDLE");
        setStatusText(null);
        return;
      }

      const dataUri = `data:audio/mp3;base64,${base64}`;
      const { sound } = await Audio.Sound.createAsync({ uri: dataUri });

      activeSoundRef.current = sound;
      updateVoiceState("PLAYING");
      setStatusText("Playing response...");

      sound.setOnPlaybackStatusUpdate((status) => {
        if (!(status as any).didJustFinish) return;

        if (activeSoundRef.current === sound) {
          activeSoundRef.current = null;
          sound.setOnPlaybackStatusUpdate(null);
          sound.unloadAsync().catch(() => { });
          updateVoiceState("IDLE");
          setStatusText(null);
        }
      });

      await sound.playAsync();
    } catch (err) {
      console.error("[playAudio] load/play error:", err);

      const s = activeSoundRef.current;
      activeSoundRef.current = null;

      if (s) {
        try {
          s.setOnPlaybackStatusUpdate(null);
          await s.unloadAsync();
        } catch { }
      }

      updateVoiceState("IDLE");
      setStatusText(null);
    }
  };

  // ─── Voice query ─────────────────────────────────────────────────────────

  const sendVoiceQuery = async (uri: string, isMaxDuration: boolean) => {
    const traceId = createTraceId();
    logTrace(traceId, "VOICE_START");

    if (voiceStateRef.current !== "PROCESSING") {
      updateVoiceState("PROCESSING");
    }

    discardResponseRef.current = false;

    const id = traceId;
    lastScrollIdRef.current = null;

    setBlocks((prev) => {
      if (prev.find((b) => b.id === id)) return prev;
      return [
        ...prev,
        { id, query: "Voice input...", status: "loading", source: "voice" },
      ];
    });

    smoothScroll(id);

    const initialStatus = isMaxDuration
      ? "Recording limit reached. Transcribing..."
      : "Transcribing...";

    setStatusText(initialStatus);

    const processingTimer = setTimeout(() => {
      if (
        voiceStateRef.current === "PROCESSING" &&
        !discardResponseRef.current
      ) {
        setStatusText((cur) =>
          cur === "Transcribing..." ? "Processing..." : cur
        );
      }
    }, 5000);

    startThinkingTimer("Almost there...", 1500);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = Date.now();

    try {
      const isCAF = uri.endsWith(".caf");

      const formData = new FormData();
      formData.append("audio_file", {
        uri,
        name: isCAF ? "audio.caf" : "audio.m4a",
        type: isCAF ? "audio/x-caf" : "audio/m4a",
      } as any);

      formData.append("traceId", traceId);
      formData.append("user_profile", JSON.stringify(user ?? {}));

      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;
      logTrace(traceId, "API_LATENCY_MS", latency);

      clearTimeout(processingTimer);
      clearThinkingTimer();
      abortControllerRef.current = null;

      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();

      const intent = data.intent || "general";
      handleIntentRouting(intent, data);

      logTrace(traceId, "API_RESPONSE", data);

      const cleanedQuery =
        typeof data.cleaned_query === "string" && data.cleaned_query.trim()
          ? data.cleaned_query
          : "Voice input";

      const text =
        typeof data.message === "string" && data.message.trim()
          ? data.message
          : "No response received.";

      if (data.status === "error") {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === id
              ? {
                ...b,
                status: "error",
                errorMessage: "🎤 Didn’t catch that. Try again.",
              }
              : b
          )
        );

        setStatusText("Say your question clearly… I’m listening.");
        updateVoiceState("IDLE");
        return;
      }

      const sections = parseSections(text);

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
              ...b,
              query: cleanedQuery,
              status: "complete",
              sections: sections ?? undefined,
              rawText: sections ? undefined : text,
            }
            : b
        )
      );

      smoothScroll(id);

      if (data.audio) {
        playAudio(data.audio);
      } else {
        updateVoiceState("IDLE");
        setStatusText(null);
      }

    } catch (err: any) {
      logTrace(traceId, "ERROR", err?.message);

      clearTimeout(processingTimer);
      clearThinkingTimer();
      abortControllerRef.current = null;

      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        return;
      }

      const message =
        err.name === "AbortError"
          ? "Connection timed out. Please try again."
          : "Connection issue. Please try again.";

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
              ...b,
              status: "error",
              errorMessage: message,
            }
            : b
        )
      );

      setStatusText(message);
      updateVoiceState("IDLE");
    }
  };

  // ─── Keyboard query ───────────────────────────────────────────────────────

  const sendKeyboardQuery = async (query: string, traceId: string) => {
    // 🔒 Debounce (FIRST)
    const now = Date.now();
    if (now - lastSubmitRef.current < 300) return;
    lastSubmitRef.current = now;

    clearThinkingTimer();
    await stopAnyPlayback();

    // 🛑 Stop recording if active
    if (voiceStateRef.current === "RECORDING") {
      await cancelRecording();
    }

    // 🛑 Abort previous request if processing
    if (voiceStateRef.current === "PROCESSING") {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
      discardResponseRef.current = true;

      updateVoiceState("IDLE"); // required reset
    }

    Keyboard.dismiss();

    // ▶️ Move to processing
    updateVoiceState("PROCESSING");

    setStatusText("Thinking...");
    discardResponseRef.current = false;
    startThinkingTimer("Almost there...", 1500);

    // ✅ Use traceId as stable id
    const id = traceId;

    lastScrollIdRef.current = null;

    setInput("");
    logTrace(traceId, "UI_UPDATE_START");
    setBlocks((prev) => [...prev, { id, query, status: "loading", source: "text" }]);
    smoothScroll(id);
    logTrace(traceId, "UI_UPDATE_DONE");

    // 🌐 API setup
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    logTrace(traceId, "API_CALL_START");
    const startTime = Date.now();

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
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;
      logTrace(traceId, "API_LATENCY_MS", latency);

      clearTimeout(timeoutId);
      clearThinkingTimer();
      abortControllerRef.current = null;

      // 🚫 Ignore if cancelled
      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        return;
      }

      if (!res.ok) {
        logTrace(traceId, "API_HTTP_ERROR", res.status);
        throw new Error(`HTTP ${res.status}`);
      }

      const data = await res.json();
      logTrace(traceId, "RESPONSE_PARSED", data);
      logTrace(traceId, "API_STATUS_SUCCESS");

      const cleanedQuery =
        typeof data.cleaned_query === "string" &&
          data.cleaned_query.trim().length > 0
          ? data.cleaned_query
          : query;

      const text =
        typeof data.message === "string" && data.message.trim().length > 0
          ? data.message
          : "No response received.";

      const sections = parseSections(text);

      logTrace(traceId, "UI_UPDATE_START");

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
              ...b,
              query: cleanedQuery, // ✅ FIXED
              status: "complete",
              sections: sections ?? undefined,
              rawText: sections ? undefined : text,
            }
            : b
        )
      );

      smoothScroll(id);
      logTrace(traceId, "UI_UPDATE_DONE");

      updateVoiceState("IDLE");
      setStatusText(null);

    } catch (err: any) {
      logTrace(traceId, "ERROR", err?.message);

      clearTimeout(timeoutId);
      clearThinkingTimer();
      abortControllerRef.current = null;

      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        return;
      }

      const message =
        err.name === "AbortError"
          ? "Connection timed out. Please try again."
          : "Connection issue. Please try again.";

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
              ...b,
              query: b.query || query, // ✅ preserve
              status: "error",
              errorMessage: message,
            }
            : b
        )
      );

      setStatusText(message);
      updateVoiceState("IDLE");

      setTimeout(() => {
        setStatusText((cur) => (cur === message ? null : cur));
      }, 4000);
    }
  };

  // ─── Recording control ────────────────────────────────────────────────────

  const cancelRecording = async () => {
    isStoppingRef.current = true;

    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }

    clearThinkingTimer();

    const rec = activeRecordingRef.current;
    activeRecordingRef.current = null;

    if (rec) {
      try {
        await rec.stopAndUnloadAsync();
      } catch { }
    }

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch { }

    if (voiceStateRef.current === "RECORDING") {
      updateVoiceState("IDLE");
    }
    setStatusText(null);
  };

  const stopRecordingAndSend = async (isMaxDuration: boolean) => {
    try {
      console.log("⏱ AUTO STOP triggered");

      const rec = activeRecordingRef.current;
      if (!rec) {
        console.log("❌ No active recording");
        return;
      }

      activeRecordingRef.current = null;

      await rec.stopAndUnloadAsync();

      const uri = rec.getURI();
      console.log("📁 Audio URI:", uri);

      updateVoiceState("PROCESSING");

      await sendVoiceQuery(uri!, isMaxDuration);

    } catch (e) {
      console.log("❌ Auto stop error:", e);
      updateVoiceState("IDLE");
    }
  };

  // Parallel recording guard — spec §13.1
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

  isStoppingRef.current = false;
  lastSpeechTimeRef.current = Date.now();

  const initAudio = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
    } catch (e) {
      console.log(e);
    }
  };

  initAudio();

  // isMeteringEnabled: true required for silence detection — spec §13.1
  const startRecording = async () => {
    try {
      console.log("🎤 START pressed");

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        console.log("❌ Permission denied");
        return;
      }

      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      const rec = new Audio.Recording();

      const preset: Audio.RecordingOptions = {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      };

      await rec.prepareToRecordAsync(preset);
      await rec.startAsync();

      activeRecordingRef.current = rec;

      setInput("");
      updateVoiceState("RECORDING");
      setStatusText("Listening...");

      rec.setProgressUpdateInterval(200);

      rec.setOnRecordingStatusUpdate((status) => {
        if (!status.isRecording || isStoppingRef.current) return;

        const db: number = (status as any).metering ?? -160;

        if (db > SILENCE_DB_THRESHOLD) {
          lastSpeechTimeRef.current = Date.now();
          setStatusText("Listening...");
        } else {
          const silentFor = Date.now() - lastSpeechTimeRef.current;

          if (silentFor >= FINAL_PAUSE_MS && !isStoppingRef.current) {
            isStoppingRef.current = true;
            stopRecordingAndSend(false);
          } else if (silentFor >= SOFT_PAUSE_MS) {
            setStatusText("Still listening...");
          }
        }
      });

      maxDurationTimerRef.current = setTimeout(() => {
        if (!isStoppingRef.current && voiceStateRef.current === "RECORDING") {
          isStoppingRef.current = true;
          stopRecordingAndSend(true);
        }
      }, MAX_RECORDING_MS);

    } catch (err) {
      console.error("[startRecording] error:", err);
      clearThinkingTimer();
      activeRecordingRef.current = null;
      updateVoiceState("IDLE");
      setStatusText(null);
    }
  };

  // ─── Input handlers ───────────────────────────────────────────────────────

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
      await stopRecordingAndSend(false);   // 🔥 FIX
      return;
    }

    // PROCESSING → ignore
  };

  // 🔥 SIMPLE MEAL DETECTOR (fast heuristic)
  const looksLikeMeal = (text: string) => {
    const foodWords = [
      "rice", "dal", "roti", "chapati", "bread", "egg", "eggs",
      "chicken", "fish", "paneer", "tofu",
      "beans", "lentils", "salad", "vegetable", "sabzi",
      "saag", "curry", "oats", "idli", "dosa", "banana", "apple"
    ];

    const lower = text.toLowerCase();

    return foodWords.some(word => lower.includes(word));
  };

  const handleSendPress = () => {
    if (voiceStateRef.current === "PROCESSING") return;

    const query = input.trim();
    if (!query) return;

    // 🔥 STEP 1 — detect meal BEFORE API
    if (looksLikeMeal(query)) {
      setPendingMeal(query);
      setStatusText("Do you want to analyze a meal?");

      // ❌ DO NOT clear input here
      return;
    }

    // 🔥 STEP 2 — normal flow
    const traceId = createTraceId();
    logTrace(traceId, "KEYBOARD_START", query);

    sendKeyboardQuery(query, traceId);
  };

  const handleChip = (value: string) => {
    if (voiceStateRef.current === "PROCESSING") return;
    const traceId = createTraceId();
    logTrace(traceId, "KEYBOARD_START", value);
    sendKeyboardQuery(value, traceId);
  };

  // ─── App lifecycle ────────────────────────────────────────────────────────


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

  useFocusEffect(
    React.useCallback(() => {
      if (navigatedToMealRef.current) {
        setInput("");
        setPendingMeal(null);
        navigatedToMealRef.current = false;
      }
    }, [])
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  const isProcessing = voiceState === "PROCESSING";
  const isRecording = voiceState === "RECORDING";


  const isErrorStatus =
    statusText !== null &&
    (statusText.includes("timed out") ||
      statusText.includes("issue") ||
      statusText.includes("Could not") ||
      statusText.includes("Please say") ||
      statusText.includes("access is required"));


  if (checkingUser) return null;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View style={{ flex: 1, backgroundColor: "#0B0F14" }}>
        <AppHeader />

        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={80}
        >
          <View style={{ flex: 1 }}>

            {/* 🔥 HEADER (NON-SCROLLING) */}
            <View style={{ paddingHorizontal: 16, paddingTop: 6 }}>
              <Text style={{ color: C.text, fontSize: 22, fontWeight: "700", marginBottom: 4 }}>
                Lifestyle
              </Text>

              <Text style={{ color: C.muted, fontSize: 13, marginBottom: 12 }}>
                Lifestyle Chat
              </Text>
            </View>

            {/* 🔥 SCROLLABLE AREA */}
            <ScrollView
              ref={scrollRef}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              contentContainerStyle={{
                paddingHorizontal: 16,
                paddingBottom: 100,
              }}
            >
              {/* EMPTY STATE */}
              {blocks.length === 0 && (
                <View style={{ marginTop: 30 }}>
                  <Text
                    style={{
                      color: C.text,
                      fontSize: 16,
                      textAlign: "center",
                      marginBottom: 16,
                    }}
                  >
                    Ask anything about your lifestyle
                  </Text>

                  <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
                    {[
                      "How to control sugar spikes?",
                      "Best post-meal walk timing?",
                      "Healthy breakfast ideas",
                    ].map((q, i) => (
                      <TouchableOpacity
                        key={i}
                        onPress={() => handleChip(q)}
                        style={{
                          backgroundColor: C.surfaceAlt,
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 12,
                          margin: 4,
                        }}
                      >
                        <Text style={{ color: C.text, fontSize: 13 }}>{q}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              )}

              {/* CHAT BLOCKS */}
              {blocks.map((block) => (
                <View
                  key={block.id}
                  ref={(ref) => {
                    if (ref) blockRefs.current[block.id] = ref;
                    else delete blockRefs.current[block.id];
                  }}
                >
                  {/* Query bubble */}
                  {block.query && (
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
                  )}

                  {block.status === "loading" && (
                    <View style={{ padding: 10 }}>
                      <ActivityIndicator color={C.accent} />
                    </View>
                  )}

                  {block.status === "error" && (
                    <Text style={{ color: C.error, paddingVertical: 4 }}>
                      {block.errorMessage ?? "Something went wrong."}
                    </Text>
                  )}

                  {block.status === "complete" &&
                    block.sections?.map((s, i) => (
                      <SectionCard key={i} title={s.title} content={s.content} />
                    ))}

                  {block.status === "complete" && block.rawText && (
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
                  )}
                </View>
              ))}
            </ScrollView>

            {/* STATUS */}
            {statusText && (
              <View style={{ alignItems: "center", paddingVertical: 6 }}>
                <Text
                  style={{
                    color: isErrorStatus ? C.error : C.muted,
                    fontSize: 13,
                  }}
                >
                  {statusText}
                </Text>

                {/* 🔥 NEW: Action buttons for routing */}
                {statusText === "Do you want to analyze a meal?" && (
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "center",
                      marginTop: 8,
                    }}
                  >
                    <TouchableOpacity
                      onPress={() => {
                        if (!pendingMeal) return;

                        setStatusText(null);
                        navigatedToMealRef.current = true;

                        router.push(
                          `/meal-main?prefill=${encodeURIComponent(pendingMeal)}`
                        );
                      }}
                      style={{
                        backgroundColor: C.accent,
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 10,
                        marginRight: 8,
                      }}
                    >
                      <Text style={{ color: "#000", fontWeight: "600" }}>
                        Yes
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        setStatusText(null);
                        // input is unchanged; keep pendingMeal for Capture Meal
                      }}
                      style={{
                        backgroundColor: "#1E2A38",
                        paddingHorizontal: 16,
                        paddingVertical: 8,
                        borderRadius: 10
                      }}
                    >
                      <Text style={{ color: "#FFFFFF", fontWeight: "500" }}>
                        No
                      </Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            )}

            {/* CAPTURE BUTTON */}
            <View style={{ alignItems: "center", marginVertical: 10 }}>
              <TouchableOpacity
                onPress={() => {
                  navigatedToMealRef.current = true;
                  router.push("/meal-capture");
                }}
                style={{
                  backgroundColor: C.accent,
                  paddingVertical: 14,
                  paddingHorizontal: 24,
                  borderRadius: 14,
                  alignItems: "center",
                  minWidth: "40%",   // 🔥 balanced width
                  maxWidth: 320,     // 🔥 clean UI cap
                }}
              >
                <Text style={{ color: "#000", fontWeight: "600" }}>
                  📸 Capture Meal
                </Text>
              </TouchableOpacity>
            </View>

            {/* INPUT BAR */}
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
              <TextInput
                value={input}
                onChangeText={(v) => { setInput(v); if (pendingMeal) setPendingMeal(null); }}
                editable={!isProcessing}
                placeholder='Ask or speak… say “Go BuildJoy”'
                placeholderTextColor={C.muted}
                style={{ flex: 1, color: C.text }}
                onSubmitEditing={handleSendPress}
                returnKeyType="send"
              />

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
                  {voiceState === "RECORDING" || voiceState === "PLAYING"
                    ? "⏹"
                    : "🎤"}
                </Text>
              </TouchableOpacity>

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
  );
}

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