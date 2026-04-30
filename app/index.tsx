import { C } from "@/constants/colors";
import { profiles } from "@/data/profiles";
import useKeyboardVisible from "@/hooks/useKeyboardVisible";
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
  TouchableWithoutFeedback,
  View,
} from "react-native";

import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { createTraceId, logTrace, nowISO, traceEnd, traceStart } from "../utils/trace";
import { normalizeQuery, parseMealItems } from "./utils/mealParser";

const BACKEND_URL = "http://192.168.40.138:8000";


// Voice thresholds — all configurable, no hardcoded values per spec §2.1
const SILENCE_DB_THRESHOLD = -40; // dBFS — below = silence
const SOFT_PAUSE_MS = 2000;       // 2s — show "Still listening..."
const FINAL_PAUSE_MS = 4000;      // 4s — stop and send
const MAX_RECORDING_MS = 20000;   // 20s — hard stop failsafe
const REQUEST_TIMEOUT_MS = 40000; // from 20s tp 40s — backend request timeout
const UX_RUNMODE = process.env.EXPO_PUBLIC_UX_RUNMODE || "screen";
const TRACE_LEVEL = parseInt(process.env.EXPO_PUBLIC_TRACE_LEVEL || "1", 10);

if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] UX_RUNMODE:`, UX_RUNMODE);


type VoiceState = "IDLE" | "RECORDING" | "PROCESSING" | "PLAYING";

type Section = { title: string; content: string };

type Message = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  status?: "loading" | "complete" | "error";
  source?: "voice" | "text";
  sections?: Section[];
  rawText?: string;
  errorMessage?: string;
  topActions?: string[];
  topActionCodes?: string[];
  nextActionLabels?: string[];
  nextActionCodes?: string[];
  traceId?: string;
  feedbackSent?: "helpful" | "not_helpful";
  actionTaken?: boolean;
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
  const [liteMode, setLiteMode] = useState<null | boolean>(null);
  const [litePromptShown, setLitePromptShown] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>("IDLE");
  const [statusText, setStatusText] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
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
      if (TRACE_LEVEL >= 1) console.warn(`[${nowISO()}][no-trace] [VoiceState] Invalid transition: ${current} → ${next} — ignored`);
      return;
    }
    if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] [VoiceState] ${current} → ${next}`);
    voiceStateRef.current = next;
    setVoiceState(next);
  };

  const handleIntentRouting = (intent: string, data: any) => {
    if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] 🧠 Routing intent:`, intent);

    if (intent === "glucose") {
      setStatusText("Do you want to analyze a meal?");
      return;
    }

    // future:
    // cholesterol → meal-main?intent=cholesterol
    // weight → meal-main?intent=weight
  };

  // ─── Utilities ───────────────────────────────────────────────────────────

  const parseVoiceIntent = (transcript: string): "helpful" | "not_helpful" | "action_taken" | null => {
    const t = transcript.trim().toLowerCase();
    if (["yes", "yeah", "yep", "yup"].includes(t)) return "helpful";
    if (["no", "nope", "nah"].includes(t)) return "not_helpful";
    if (["do it", "i will", "i'll do it", "i'll do this"].includes(t)) return "action_taken";
    return null;
  };

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
  const scrollToBlock = () => { }

  //  const scrollToBlock = (id: string) => {
  //    requestAnimationFrame(() => {
  //      const block = blockRefs.current[id];
  //      const sv = scrollRef.current;
  //      if (!block || !sv) return;
  //      block.measureLayout(
  //       sv as any,
  //        (_x: number, y: number) =>
  //          sv.scrollTo({ y: Math.max(0, y - 20), animated: true }),
  //       () => { }
  //      );
  //   });
  //  };
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
        if (TRACE_LEVEL >= 1) console.warn(`[${nowISO()}][no-trace] [playAudio] invalid base64 — text-only fallback`);
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
      if (TRACE_LEVEL >= 1) console.error(`[${nowISO()}][no-trace] [playAudio] load/play error:`, err);

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
    const t0 = traceStart(traceId, "sendVoiceQuery", TRACE_LEVEL);
    logTrace(traceId, "VOICE_START");

    if (voiceStateRef.current !== "PROCESSING") {
      updateVoiceState("PROCESSING");
    }

    discardResponseRef.current = false;

    const userMsgId = `${traceId}-user`;
    const assistantMsgId = `${traceId}-assistant`;
    lastScrollIdRef.current = null;

    setMessages((prev) => {
      if (prev.find((m) => m.id === userMsgId)) return prev;
      return [
        ...prev,
        { id: userMsgId, role: "user", text: "🎤 Voice input...", source: "voice", status: "complete" },
        { id: assistantMsgId, role: "assistant", text: "", source: "voice", status: "loading" },
      ];
    });

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

      formData.append("lite", liteMode === true ? "true" : "false");
      formData.append("traceId", traceId);
      formData.append("user_profile", JSON.stringify(user ?? {}));

      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] → /query voice`);
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "x-trace-id": traceId },
        body: formData,
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;
      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] ← /query ${latency}ms`);
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

      console.log("FULL RESPONSE:", JSON.stringify(data));
      console.log("CHAT:", data.chat);
      console.log("TEXT:", data.text);
      console.log("MESSAGE:", data.message);

      const text =
        (typeof data.chat === "string" && data.chat.trim())
          ? data.chat
          : (typeof data.text === "string" && data.text.trim())
            ? data.text
            : (typeof data.message === "string" && data.message.trim())
              ? data.message
              : "No response received.";

      if (!text || text.trim() === "") {
        console.warn("Empty response", data);
      }

      if (data.status === "error") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? { ...m, status: "error", errorMessage: "🎤 Didn’t catch that. Try again." }
              : m
          )
        );

        setStatusText("Say your question clearly… I’m listening.");
        updateVoiceState("IDLE");
        return;
      }

      // Check if transcript is a voice intent response to the previous message
      const lastAssistant = [...messages].reverse().find(m => m.role === "assistant" && m.status === "complete");
      const voiceIntent = parseVoiceIntent(cleanedQuery);
      if (voiceIntent && lastAssistant?.traceId) {
        if (voiceIntent === "helpful" || voiceIntent === "not_helpful") {
          sendFeedback(lastAssistant, voiceIntent);
        } else if (voiceIntent === "action_taken") {
          sendActionTaken(lastAssistant);
        }
        setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== assistantMsgId));
        updateVoiceState("IDLE");
        setStatusText(null);
        return;
      }

      const sections = parseSections(text);
      const topActions: string[] =
        data.screen?.top_action_labels ||
        data.structured?.top_action_labels ||
        data.screen?.top_actions ||
        data.structured?.top_actions ||
        [];
      const topActionCodes: string[] =
        data.screen?.top_actions ||
        data.structured?.top_actions ||
        [];
      console.log("PARSED ACTION CODES:", topActionCodes);
      const nextActionCodes: string[] =
        data.screen?.next_actions ||
        data.structured?.next_actions ||
        [];
      const nextActionLabels: string[] =
        data.screen?.next_action_labels ||
        data.structured?.next_action_labels ||
        [];

      // TODO: remove after validation
      console.log("VOICE HANDLER HIT");
      console.log("[VOICE] ACTION CODES:", topActionCodes);
      console.log("[VOICE] DISPLAY ACTIONS:", topActions);

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === userMsgId) return { ...m, text: cleanedQuery || m.text };
          if (m.id === assistantMsgId) return {
            ...m,
            status: "complete",
            text,
            sections: liteMode === true ? undefined : sections ?? undefined,
            rawText: liteMode === true ? text : (sections ? undefined : text),
            topActions,
            topActionCodes,
            nextActionCodes,
            nextActionLabels,
            traceId,
          };
          return m;
        })
      );

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

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? { ...m, status: "error", errorMessage: message } : m
        )
      );

      setStatusText(message);
      updateVoiceState("IDLE");
    } finally {
      traceEnd(traceId, "sendVoiceQuery", t0, TRACE_LEVEL);
    }
  };

  // ─── Keyboard query ───────────────────────────────────────────────────────

  const sendKeyboardQuery = async (query: string, traceId: string, raw?: string) => {
    const t0 = traceStart(traceId, "sendKeyboardQuery", TRACE_LEVEL);
    const displayText = raw ?? query;
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

    const userMsgId = `${traceId}-user`;
    const assistantMsgId = `${traceId}-assistant`;

    lastScrollIdRef.current = null;

    setInput("");
    logTrace(traceId, "UI_UPDATE_START");
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", text: displayText, source: "text", status: "complete" },
      { id: assistantMsgId, role: "assistant", text: "", source: "text", status: "loading" },
    ]);
    logTrace(traceId, "UI_UPDATE_DONE");

    // 🌐 API setup
    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    logTrace(traceId, "API_CALL_START");
    const startTime = Date.now();

    try {
      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] → /query keyboard`);
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trace-id": traceId },
        body: JSON.stringify({
          query,
          voice: false,
          lite: liteMode === true,
          user_profile: user ?? {},
          traceId,
        }),
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;
      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] ← /query ${latency}ms`);
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

      logTrace(
        traceId,
        "RESPONSE_PARSED",
        {
          ...data,
          _trace: data._trace
            ? JSON.stringify(data._trace, null, 2)
            : null,
        }
      );

      logTrace(traceId, "API_STATUS_SUCCESS");

      const cleanedQuery =
        typeof data.cleaned_query === "string" &&
          data.cleaned_query.trim().length > 0
          ? data.cleaned_query
          : query;

      console.log("FULL RESPONSE:", JSON.stringify(data));
      console.log("CHAT:", data.chat);
      console.log("TEXT:", data.text);
      console.log("MESSAGE:", data.message);

      const text =
        (typeof data.chat === "string" && data.chat.trim().length > 0)
          ? data.chat
          : (typeof data.text === "string" && data.text.trim().length > 0)
            ? data.text
            : (typeof data.message === "string" && data.message.trim().length > 0)
              ? data.message
              : "No response received.";

      if (!text || text.trim() === "") {
        console.warn("Empty response", data);
      }

      const sections = parseSections(text);
      const topActions: string[] =
        data.screen?.top_action_labels ||
        data.structured?.top_action_labels ||
        data.screen?.top_actions ||
        data.structured?.top_actions ||
        [];
      const topActionCodes: string[] =
        data.screen?.top_actions ||
        data.structured?.top_actions ||
        [];
      const nextActionCodes: string[] =
        data.screen?.next_actions ||
        data.structured?.next_actions ||
        [];
      const nextActionLabels: string[] =
        data.screen?.next_action_labels ||
        data.structured?.next_action_labels ||
        [];

      // TODO: remove after validation
      console.log("[KB] ACTION CODES:", topActionCodes);
      console.log("[KB] DISPLAY ACTIONS:", topActions);

      logTrace(traceId, "UI_UPDATE_START");

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? {
              ...m,
              status: "complete",
              text,
              sections: liteMode ? undefined : sections ?? undefined,
              rawText: liteMode ? text : (sections ? undefined : text),
              topActions,
              topActionCodes,
              nextActionCodes,
              nextActionLabels,
              traceId,
            }
            : m
        )
      );

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

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, status: "error", errorMessage: message }
            : m
        )
      );

      setStatusText(message);
      updateVoiceState("IDLE");

      setTimeout(() => {
        setStatusText((cur) => (cur === message ? null : cur));
      }, 4000);
    } finally {
      traceEnd(traceId, "sendKeyboardQuery", t0, TRACE_LEVEL);
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
      if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] ⏱ AUTO STOP triggered`);

      const rec = activeRecordingRef.current;
      if (!rec) {
        if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] ❌ No active recording`);
        return;
      }

      activeRecordingRef.current = null;

      await rec.stopAndUnloadAsync();

      const uri = rec.getURI();
      if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] 📁 Audio URI:`, uri);

      updateVoiceState("PROCESSING");

      await sendVoiceQuery(uri!, isMaxDuration);

    } catch (e) {
      if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] ❌ Auto stop error:`, e);
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
          if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] cleanup error`, e);
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
      if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] initAudio error:`, e);
    }
  };

  initAudio();

  // isMeteringEnabled: true required for silence detection — spec §13.1
  const startRecording = async () => {
    try {
      if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] 🎤 START pressed`);

      const permission = await Audio.requestPermissionsAsync();
      if (!permission.granted) {
        if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] ❌ Permission denied`);
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
      if (TRACE_LEVEL >= 1) console.error(`[${nowISO()}][no-trace] [startRecording] error:`, err);
      clearThinkingTimer();
      activeRecordingRef.current = null;
      updateVoiceState("IDLE");
      setStatusText(null);
    }
  };

  // ─── Input handlers ───────────────────────────────────────────────────────

  const handleMicPress = async () => {
    if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] 🎤 MIC PRESSED, state:`, voiceStateRef.current);

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

  // 🔥 MEAL DETECTOR — dual detection on raw input
  const looksLikeMeal = (text: string): boolean => {
    const lower = text.toLowerCase();

    // Signal 1: consumption phrases
    const consumptionPhrases = [
      /\bi (just )?(ate|had|consumed)\b/i,
      /\bmy meal was\b/i,
      /\bfor (breakfast|lunch|dinner)\b/i,
    ];
    if (consumptionPhrases.some(p => p.test(lower))) return true;

    // Signal 2: parseMealItems returns multiple distinct items
    if (parseMealItems(text).length >= 2) return true;

    // Signal 3: fallback single food keyword
    const foodWords = [
      "rice", "dal", "roti", "chapati", "bread", "egg", "eggs",
      "chicken", "fish", "paneer", "tofu", "beans", "lentils",
      "salad", "vegetable", "sabzi", "saag", "curry", "oats",
      "idli", "dosa", "banana", "apple",
    ];
    return foodWords.some(w => lower.includes(w));
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
      if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] LOADED USER:`, id);

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

  useEffect(() => {
    if (messages.length === 0) return;
    requestAnimationFrame(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, [messages]);

  const [showModePrompt, setShowModePrompt] = useState(false);

  useEffect(() => {
    if (checkingUser) return;
    if (litePromptShown) return;
    setShowModePrompt(true);
    setLitePromptShown(true);
  }, [checkingUser]);

  const sendFeedback = async (msg: Message, feedback: "helpful" | "not_helpful") => {
    if (!msg.traceId || !msg.topActionCodes?.length) return;
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, feedbackSent: feedback } : m
    ));
    const rawQuery = messages.find(m => m.role === "user" && m.id === `${msg.traceId}-user`)?.text;
    try {
      await fetch(`${BACKEND_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trace_id: msg.traceId,
          action: msg.topActionCodes![0],
          feedback,
          raw_query: rawQuery,
          normalized_query: rawQuery ? normalizeQuery(rawQuery) : undefined,
        }),
      });
    } catch (e) {
      if (TRACE_LEVEL >= 1) console.warn("[FE] feedback POST failed:", e);
    }
  };

  const sendActionTaken = async (msg: Message) => {
    if (!msg.traceId || !msg.topActionCodes?.length) return;
    setMessages(prev => prev.map(m =>
      m.id === msg.id ? { ...m, actionTaken: true } : m
    ));
    const rawQuery = messages.find(m => m.role === "user" && m.id === `${msg.traceId}-user`)?.text;
    try {
      await fetch(`${BACKEND_URL}/feedback`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trace-id": msg.traceId },
        body: JSON.stringify({
          trace_id: msg.traceId,
          action: msg.topActionCodes![0],
          action_taken: "yes",
          raw_query: rawQuery,
          normalized_query: rawQuery ? normalizeQuery(rawQuery) : undefined,
        }),
      });
    } catch (e) {
      if (TRACE_LEVEL >= 1) console.warn("[FE] action_taken POST failed:", e);
    }
  };

  const handleNextAction = (value: string) => {
    // Cancel any in-flight request before switching modes
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
      discardResponseRef.current = true;
    }

    if (value === "Try Lite") {
      setLiteMode(true);
      setMessages([]);
      setShowModePrompt(false);
    } else if (value === "Stay Detailed") {
      setLiteMode(false);
      setMessages([]);
      setShowModePrompt(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const isProcessing = voiceState === "PROCESSING";
  const isRecording = voiceState === "RECORDING";
  const isKeyboardVisible = useKeyboardVisible();


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
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
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
                style={{ flex: 1 }}
                keyboardShouldPersistTaps="always"
                keyboardDismissMode="on-drag"
                contentContainerStyle={{
                  paddingHorizontal: 16,
                  paddingBottom: 100,
                }}
              >
                {/* DISCOVERY MODE — no messages yet */}
                {messages.length === 0 && (
                  <View style={{ marginTop: 30 }}>
                    <Text style={{ color: C.text, fontSize: 16, textAlign: "center", marginBottom: 16 }}>
                      Ask anything about your lifestyle
                    </Text>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center" }}>
                      {[
                        "How to control sugar spikes?",
                        "Best post meal walk timing",
                        "Healthy breakfast ideas",
                        "What should I eat with ice cream?",
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

                    {/* Mode prompt — shown before first query */}
                    {showModePrompt && (
                      <View style={{ marginTop: 24, alignItems: "center" }}>
                        <Text style={{ color: C.muted, fontSize: 14, marginBottom: 12 }}>
                          Want simpler, voice-friendly answers?
                        </Text>
                        <View style={{ flexDirection: "row", gap: 10 }}>
                          {["Try Lite", "Stay Detailed"].map((action) => (
                            <TouchableOpacity
                              key={action}
                              onPress={() => handleNextAction(action)}
                              style={{
                                backgroundColor: action === "Try Lite" ? C.accent : C.surface,
                                paddingHorizontal: 18,
                                paddingVertical: 10,
                                borderRadius: 10,
                                borderWidth: 1,
                                borderColor: action === "Try Lite" ? C.accent : C.border,
                              }}
                            >
                              <Text style={{ color: action === "Try Lite" ? "#000" : C.text, fontWeight: "600", fontSize: 14 }}>
                                {action}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      </View>
                    )}
                  </View>
                )}

                {/* CONVERSATION MODE — messages exist */}
                {messages.map((msg) => (
                  <View
                    key={msg.id}
                  >
                    {/* User bubble */}
                    {msg.role === "user" && (
                      <View
                        style={{
                          alignSelf: "flex-end",
                          backgroundColor: msg.source === "voice" ? "#CDEBCC" : C.userBubble,
                          paddingVertical: 6,
                          paddingHorizontal: 10,
                          borderRadius: 14,
                          marginVertical: 3,
                          maxWidth: "80%",
                        }}
                      >
                        <Text style={{ color: C.textDark }}>{msg.text}</Text>
                      </View>
                    )}

                    {/* Assistant loading */}
                    {msg.role === "assistant" && msg.status === "loading" && (
                      <View style={{ padding: 10 }}>
                        <ActivityIndicator color={C.accent} />
                      </View>
                    )}

                    {/* Assistant error */}
                    {msg.role === "assistant" && msg.status === "error" && (
                      <Text style={{ color: C.error, paddingVertical: 4 }}>
                        {msg.errorMessage ?? "Something went wrong."}
                      </Text>
                    )}

                    {/* Safety assertion — both should never coexist */}
                    {msg.role === "assistant" && msg.status === "complete" && msg.rawText && msg.sections &&
                      (() => { console.error("INVALID STATE: both rawText and sections present", { id: msg.id }); return null; })()}

                    {/* Assistant sections (full mode only — never renders when rawText is set) */}
                    {msg.role === "assistant" && msg.status === "complete" && !msg.rawText &&
                      msg.sections?.map((s, i) => (
                        <View key={i} style={{ padding: 10 }}>
                          <Text style={{ color: "white" }}>{s.title}</Text>
                          <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
                            {s.content}
                          </Text>
                        </View>
                      ))}

                    {/* Assistant raw text (lite mode) */}
                    {msg.role === "assistant" && msg.status === "complete" && msg.rawText &&
                      (() => { console.log("RAW:", msg.rawText); console.log("SECTIONS:", msg.sections); return true; })() && (
                        <View
                          style={{
                            backgroundColor: C.surfaceAlt,
                            padding: 12,
                            borderRadius: 14,
                            marginVertical: 6,
                          }}
                        >
                          <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
                            {msg.rawText}
                          </Text>
                        </View>
                      )}

                    {/* Actions block — deterministic from backend, never from LLM */}
                    {msg.role === "assistant" && msg.status === "complete" &&
                      msg.topActions && msg.topActions.length > 0 && (
                        <View
                          style={{
                            backgroundColor: C.surface,
                            borderRadius: 14,
                            padding: 12,
                            marginTop: 8,
                          }}
                        >
                          <Text style={{ color: C.muted, fontSize: 13, marginBottom: 6, fontWeight: "600" }}>
                            Do this now:
                          </Text>
                          <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
                            {msg.topActions.join("\n")}
                          </Text>
                        </View>
                      )}

                    {/* Feedback buttons */}
                    {msg.role === "assistant" && msg.status === "complete" &&
                      msg.topActions && msg.topActions.length > 0 && (
                        <View style={{ flexDirection: "row", marginTop: 8, gap: 8 }}>
                          {msg.feedbackSent ? (
                            <Text style={{ color: C.muted, fontSize: 13 }}>
                              {msg.feedbackSent === "helpful" ? "Thanks for the feedback!" : "Got it, we'll improve."}
                            </Text>
                          ) : (
                            <>
                              <TouchableOpacity
                                onPress={() => sendFeedback(msg, "helpful")}
                                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#2D3748" }}
                              >
                                <Text style={{ color: C.text, fontSize: 14 }}>👍 Helpful</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => sendFeedback(msg, "not_helpful")}
                                style={{ paddingHorizontal: 14, paddingVertical: 6, borderRadius: 20, borderWidth: 1, borderColor: "#2D3748" }}
                              >
                                <Text style={{ color: C.text, fontSize: 14 }}>👎 Not helpful</Text>
                              </TouchableOpacity>
                            </>
                          )}
                        </View>
                      )}

                    {/* Action commitment button */}
                    {msg.role === "assistant" && msg.status === "complete" &&
                      msg.topActionCodes && msg.topActionCodes.length > 0 && (
                        <TouchableOpacity
                          onPress={() => sendActionTaken(msg)}
                          disabled={msg.actionTaken}
                          style={{
                            marginTop: 8,
                            paddingHorizontal: 16,
                            paddingVertical: 8,
                            borderRadius: 20,
                            backgroundColor: msg.actionTaken ? "#1A2A1A" : "#1A3A1A",
                            alignSelf: "flex-start",
                          }}
                        >
                          <Text style={{ color: msg.actionTaken ? C.muted : "#4ADE80", fontSize: 14, fontWeight: "600" }}>
                            {msg.actionTaken ? "✔ You committed — start now" : "⚡ I'll do this"}
                          </Text>
                        </TouchableOpacity>
                      )}

                    {/* Next actions — continuation options */}
                    {msg.role === "assistant" && msg.status === "complete" &&
                      msg.nextActionCodes && msg.nextActionCodes.length > 0 && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 6, fontWeight: "600", textTransform: "uppercase", letterSpacing: 0.5 }}>
                            What's next?
                          </Text>
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                            {msg.nextActionCodes.map((code, idx) => (
                              <TouchableOpacity
                                key={code}
                                onPress={() => {
                                  const newTraceId = createTraceId();
                                  sendKeyboardQuery(code, newTraceId);
                                }}
                                style={{
                                  paddingHorizontal: 14,
                                  paddingVertical: 7,
                                  borderRadius: 20,
                                  borderWidth: 1,
                                  borderColor: "#2D3748",
                                  backgroundColor: C.surface,
                                }}
                              >
                                <Text style={{ color: C.text, fontSize: 13 }}>
                                  {msg.nextActionLabels?.[idx] ?? code.replace(/_/g, " ")}
                                </Text>
                              </TouchableOpacity>
                            ))}
                          </View>
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

                          const parsed = parseMealItems(pendingMeal).join(", ");
                          router.push(
                            `/meal-main?prefill=${encodeURIComponent(parsed)}`
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
                          const raw = pendingMeal;
                          setStatusText(null);
                          setPendingMeal(null);
                          if (raw) {
                            const parsed = parseMealItems(raw).join(", ");
                            const traceId = createTraceId();
                            logTrace(traceId, "KEYBOARD_START", parsed);
                            sendKeyboardQuery(parsed, traceId, raw);
                          }
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
              {!isKeyboardVisible && (
                <View
                  pointerEvents="box-none"
                  style={{ alignItems: "center", paddingHorizontal: 16, marginVertical: 10 }}
                >
                  <View style={{ width: 260 }} pointerEvents="box-none">
                    <TouchableOpacity
                      onPress={() => {
                        navigatedToMealRef.current = true;
                        router.push("/meal-capture");
                      }}
                      style={{
                        backgroundColor: C.accent,
                        paddingVertical: 16,
                        paddingHorizontal: 20,
                        borderRadius: 12,
                        alignItems: "center",
                        width: "100%",
                        elevation: 2,
                      }}
                    >
                      <Text style={{ color: "#000", fontWeight: "600", fontSize: 15 }}>
                        📸 Capture Meal
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

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
          </TouchableWithoutFeedback>
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