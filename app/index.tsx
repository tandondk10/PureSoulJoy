import { C } from "@/constants/colors";
import { profiles } from "@/data/profiles";
import useKeyboardVisible from "@/hooks/useKeyboardVisible";
//import { loadUser, saveUser } from "@/utils/storage";
import { loadUser } from "@/utils/storage";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import React, { useEffect, useRef, useState } from "react";
import {
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
  View
} from "react-native";

import AppHeader from "@/components/AppHeader";
import { useUser } from "@/context/UserContext";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { normalizeQuery } from "../utils/mealParser";
import { getNormalizedUser } from "../utils/normalizeUser";
import { createTraceId, logTrace, nowISO, traceEnd, traceStart } from "../utils/trace";

const BACKEND_URL = "http://192.168.86.52:8003";


function getVoiceDisplayText(data?: any): string {
  return (typeof data?.transcript === "string" && data.transcript.trim().length > 0)
    ? data.transcript.trim()
    : "🎤 Voice input";
}

function getResponseText(data: any): string {
  return (typeof data?.chat === "string" && data.chat.trim().length > 0)
    ? data.chat
    : (typeof data?.text === "string" && data.text.trim().length > 0)
      ? data.text
      : (typeof data?.message === "string" && data.message.trim().length > 0)
        ? data.message
        : "I could not prepare a response. Please try again.";
}

const ACTION_TEXT_MAP: Record<string, string> = {
  walk_10min_now: "Take a 10-minute walk now",
  drink_water_now: "Drink a glass of water",
  next_meal_add_protein_and_fiber: "Add protein and fiber to your next meal",
  avoid_simple_carbs_now: "Avoid simple carbs for now",
  take_a_10min_walk: "Take a 10-minute walk",
  check_your_last_meal: "Review your last meal",
};


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
  context?: string;
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


  // ─── State machine ───────────────────────────────────────────────────────

  const updateVoiceState = (next: VoiceState) => {
    const current = voiceStateRef.current;
    if (current === next) return;
    const allowed = VALID_TRANSITIONS[current];
    if (!allowed.includes(next)) {
      if (TRACE_LEVEL >= 1) console.warn(`[${nowISO()}][no-trace] [VoiceState] Invalid transition: ${current} → ${next} — ignored`);
      return;
    }
    if (TRACE_LEVEL >= 1) console.log(`[${nowISO()}][no-trace] [VoiceState] ${current} → ${next}`);
    voiceStateRef.current = next;
    setVoiceState(next);
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

  const stopAllAudio = async () => {
    try {
      Speech.stop();

      if (activeSoundRef.current) {
        try {
          await activeSoundRef.current.stopAsync();
          await activeSoundRef.current.unloadAsync();
        } catch { }

        activeSoundRef.current = null; // 🔥 critical
      }
    } catch (e) {
      console.warn("STOP_AUDIO_FAILED", e);
    } finally {
      if (voiceStateRef.current !== "PROCESSING") {
        updateVoiceState("IDLE");
      }
    }
  };

  const playAudio = async (base64: string) => {
    await stopAllAudio();

    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });

      if (!base64 || typeof base64 !== "string" || base64.length < 50) {
        if (TRACE_LEVEL >= 1)
          console.warn(`[${nowISO()}][no-trace] [playAudio] invalid base64 — text-only fallback`);
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
        if (!status.isLoaded) return;

        if (status.didJustFinish) {
          if (activeSoundRef.current === sound) {
            activeSoundRef.current = null;

            sound.setOnPlaybackStatusUpdate(null);
            sound.unloadAsync().catch(() => { });

            updateVoiceState("IDLE");
            setStatusText(null);
          }
        }
      });

      // 🔥 THIS WAS MISSING OR MISPLACED
      await sound.playAsync();

    } catch (e) {
      console.warn("PLAY_AUDIO_FAILED", e);
      updateVoiceState("IDLE");
      setStatusText(null);
    }
  };

  const speakLocalPrompt = async (text: string) => {
    try {
      if (!text || !text.trim()) { updateVoiceState("IDLE"); return; }
      Speech.stop();
      updateVoiceState("PLAYING");
      await new Promise<void>((resolve) => {
        let resolved = false;
        const finish = () => { if (resolved) return; resolved = true; updateVoiceState("IDLE"); resolve(); };
        Speech.speak(text, { rate: 0.92, pitch: 1.0, onDone: finish, onStopped: finish, onError: finish });
      });
    } catch (e) { console.warn("LOCAL_TTS_FAILED", e); updateVoiceState("IDLE"); }
  };

  // ─── Voice query ─────────────────────────────────────────────────────────

  const sendVoiceQuery = async (uri: string, isMaxDuration: boolean) => {
    await stopAllAudio();

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
      if (prev.find((m) => m.id === userMsgId || m.id === assistantMsgId)) return prev;
      const next = [
        ...prev,
        { id: userMsgId, role: "user", text: "🎤 Voice input", source: "voice", status: "complete", traceId },
        { id: assistantMsgId, role: "assistant", text: "Thinking...", source: "voice", status: "loading", traceId },
      ];
      return next;
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

      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] → /query/voice`);
      const res = await fetch(`${BACKEND_URL}/query/voice`, {
        method: "POST",
        headers: { "x-trace-id": traceId },
        body: formData,
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;
      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] ← /query/voice ${latency}ms`);
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

      logTrace(traceId, "API_RESPONSE", data);

      const cleanedQuery = (() => {
        const candidate =
          (typeof data.cleaned_query === "string" ? data.cleaned_query.trim() : "") ||
          (typeof data.query === "string" ? data.query.trim() : "") ||
          (typeof data.transcript === "string" ? data.transcript.trim() : "");
        return candidate || "Voice Input";
      })();

      if (TRACE_LEVEL >= 2) {
        console.log("CHAT:", data.chat);
        console.log("TEXT:", data.text);
      }

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

      const rawActions: any[] = data?.top_actions || data?.actions || [];
      const topActionCodes: string[] = rawActions
        .map((a: any) => (typeof a === "string" ? a : (a.id ?? "")))
        .filter(Boolean);
      const topActions: string[] = rawActions.map((a: any) => {
        if (typeof a === "string") return ACTION_TEXT_MAP[a] || a;
        return a.label ?? ACTION_TEXT_MAP[a.id] ?? a.id ?? "Action";
      });

      const nextActionCodes: string[] =
        data.screen?.next_actions ||
        data.structured?.next_actions ||
        [];
      const nextActionLabels: string[] =
        data.screen?.next_action_labels ||
        data.structured?.next_action_labels ||
        [];

      const voiceDisplayText = getVoiceDisplayText(data);

      setMessages((prev) => {
        const next = prev.map((m) => {
          if (m.id === userMsgId) return { ...m, text: voiceDisplayText };
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
        });
        return next;
      });

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

  const sendKeyboardQuery = async (
    query: string,
    traceId: string,
    raw?: string,
    showUserBubble: boolean = true,
    context?: string   // ✅ ADD THIS
  ) => {
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

    lastScrollIdRef.current = assistantMsgId;

    setInput("");
    logTrace(traceId, "UI_UPDATE_START");

    setMessages(prev => [
      ...prev,
      ...(showUserBubble
        ? [{
          id: userMsgId,
          role: "user" as const,
          text: displayText,
          source: "text" as const,
          status: "complete" as const,
          traceId
        }]
        : []),
      {
        id: assistantMsgId,
        role: "assistant" as const,
        text: "Thinking...",
        source: "text" as const,
        status: "loading" as const,
        traceId,
        context: context || undefined
      },
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
      logTrace(traceId, "API_REQUEST_BODY", { query, voice: false, hasUserProfile: !!(user) });

      console.log("🔥 USER_PROFILE:", getNormalizedUser(user));
      console.log("🔥 USER_PROFILE SENT:", JSON.stringify(getNormalizedUser(user)));
      const timeoutId = setTimeout(() => controller.abort(), 20000);
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-trace-id": traceId },
        body: JSON.stringify({
          query,
          voice: false,
          lite: liteMode === true,
          user_profile: getNormalizedUser(user),
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

      logTrace(traceId, "API_RESPONSE_SUMMARY", {
        status: data?.status,
        input_domain: data?.input_domain,
        condition_focus: data?.condition_focus,
        timing: data?.timing,
        foods: data?.foods ?? [],
        levers: data?.levers ?? [],
        has_food: data?.has_food,
      });
      logTrace(traceId, "API_STATUS_SUCCESS");

      const cleanedQuery =
        typeof data.cleaned_query === "string" &&
          data.cleaned_query.trim().length > 0
          ? data.cleaned_query
          : query;

      if (TRACE_LEVEL >= 2) {
        console.log("CHAT:", data.chat);
        console.log("TEXT:", data.text);
      }

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

      const rawActions: any[] = data?.top_actions || data?.actions || [];
      const topActionCodes: string[] = rawActions
        .map((a: any) => (typeof a === "string" ? a : (a.id ?? "")))
        .filter(Boolean);
      const topActions: string[] = rawActions.map((a: any) => {
        if (typeof a === "string") return ACTION_TEXT_MAP[a] || a;
        return a.label ?? ACTION_TEXT_MAP[a.id] ?? a.id ?? "Action";
      });

      const nextActionCodes: string[] =
        data.screen?.next_actions ||
        data.structured?.next_actions ||
        [];
      const nextActionLabels: string[] =
        data.screen?.next_action_labels ||
        data.structured?.next_action_labels ||
        [];

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
      return data;

    } catch (err: any) {
      logTrace(traceId, "ERROR", err?.message);

      clearTimeout(timeoutId);
      clearThinkingTimer();
      abortControllerRef.current = null;

      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        return null;
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
      return null;
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
    await stopAllAudio();

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

  const handleStopPlayback = async () => {
    if (TRACE_LEVEL >= 1) {
      console.log(`[${nowISO()}][no-trace] 🔇 STOP playback pressed`);
    }
    await stopAllAudio();
    updateVoiceState("IDLE");
    setStatusText(null);
  };

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

  const handleSendPress = () => {
    if (voiceStateRef.current === "PROCESSING") return;

    const query = input.trim();
    if (!query) return;

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

  // ─── Assistant renderer ──────────────────────────────────────────────────

  const getAssistantDisplayText = (msg: Message): string => {
    if (msg.status === "loading") return "Thinking...";
    if (msg.status === "error") return msg.errorMessage || "Something went wrong.";
    const raw =
      typeof msg.rawText === "string" && msg.rawText.trim().length > 0
        ? msg.rawText.trim()
        : typeof msg.text === "string" && msg.text.trim().length > 0
          ? msg.text.trim()
          : "";
    return raw;
  };

  const renderAssistantMessage = (msg: Message) => {
    const isLoading = msg.status === "loading";
    const isError = msg.status === "error";
    const displayText = getAssistantDisplayText(msg);

    return (
      <View
        style={{
          alignSelf: "flex-start",
          backgroundColor: isError ? "#3A1A1A" : C.surfaceAlt,
          padding: 12,
          borderRadius: 14,
          marginVertical: 6,
          maxWidth: "85%",
        }}
      >
        {msg.context ? (
          <Text style={{ color: C.muted, fontSize: 12, marginBottom: 6 }}>
            {msg.context}
          </Text>
        ) : null}

        {isLoading ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <ActivityIndicator color={C.accent} />
            <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
              Thinking...
            </Text>
          </View>
        ) : isError ? (
          <Text style={{ color: C.error, fontSize: 16, lineHeight: 22 }}>
            {displayText}
          </Text>
        ) : msg.sections && msg.sections.length > 0 ? (
          <View>
            {msg.sections.map((s, i) => (
              <View key={`${msg.id}-s${i}`} style={{ marginBottom: i < msg.sections!.length - 1 ? 10 : 0 }}>
                <Text style={{ color: "white", fontWeight: "700", marginBottom: 4 }}>{s.title}</Text>
                <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>{s.content}</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={{ color: "#FFFFFF", fontSize: 16, lineHeight: 22 }}>
            {displayText || "I could not prepare a response. Please try again."}
          </Text>
        )}
      </View>
    );
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

                    {/* Assistant message — loading, error, sections, raw text */}
                    {msg.role === "assistant" && renderAssistantMessage(msg)}

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
                                activeOpacity={0.82}
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

              {/* Generic status text */}
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
                        console.log("Capture disabled for Day-1 platform test");
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
                  onChangeText={setInput}
                  editable={!isProcessing}
                  placeholder='Ask or speak… say “Go BuildJoy”'
                  placeholderTextColor={C.muted}
                  style={{ flex: 1, color: C.text }}
                  onSubmitEditing={handleSendPress}
                  returnKeyType="send"
                />

                {voiceState === "PLAYING" ? (
                  <TouchableOpacity
                    onPress={handleStopPlayback}
                    style={styles.stopVoiceButton}
                    activeOpacity={0.82}
                  >
                    <Text style={styles.stopVoiceButtonText}>Stop</Text>
                  </TouchableOpacity>
                ) : (
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
                      {voiceState === "RECORDING" ? "⏹" : "🎤"}
                    </Text>
                  </TouchableOpacity>
                )}

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
    </SafeAreaView >
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
  stopVoiceButton: {
    marginRight: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center",
    justifyContent: "center",
  },
  stopVoiceButtonText: {
    color: C.text,
    fontSize: 14,
    fontWeight: "700",
  },
});