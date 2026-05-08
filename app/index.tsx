import { C } from "@/constants/colors";
import { AssistantMessage } from "@/components/AssistantMessage";
import { UserMessage } from "@/components/UserMessage";
import { ActionCards } from "@/components/ActionCards";
import { profiles } from "@/data/profiles";
import useKeyboardVisible from "@/hooks/useKeyboardVisible";
import { loadUser } from "@/utils/storage";
import { Audio } from "expo-av";
import * as Speech from "expo-speech";
import React, { useEffect, useRef, useState } from "react";
import {
  AppState,
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
import type { ChatMessage } from "./types/coaching";
import {
  assistantCompleteFromResponse,
  assistantError,
  getVoiceUserText,
  getSafeErrorMessage,
  makeAssistantLoadingMessage,
  makeUserMessage,
} from "./utils/messageLifecycle";
import { sendKeyboardCoachingQuery, sendVoiceCoachingQuery } from "./services/coachingApi";

const BACKEND_URL = "http://192.168.86.52:8003";




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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
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

  const scrollToBlock = (_id?: string) => { }

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
      return [
        ...prev,
        makeUserMessage({ id: userMsgId, text: "🎤 Voice input", source: "voice", traceId }),
        makeAssistantLoadingMessage({ id: assistantMsgId, source: "voice", traceId }),
      ];
    });

    const initialStatus = isMaxDuration
      ? "Recording limit reached. Transcribing..."
      : "Transcribing...";

    setStatusText(initialStatus);

    const processingTimer = setTimeout(() => {
      if (voiceStateRef.current === "PROCESSING" && !discardResponseRef.current) {
        setStatusText((cur) => cur === "Transcribing..." ? "Processing..." : cur);
      }
    }, 5000);

    startThinkingTimer("Almost there...", 1500);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const startTime = Date.now();

    try {
      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] → /query/voice`);

      const data = await sendVoiceCoachingQuery({
        backendUrl: BACKEND_URL,
        audioUri: uri,
        traceId,
        extraFields: {
          lite: liteMode === true ? "true" : "false",
          traceId,
          user_profile: JSON.stringify(user ?? {}),
        },
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
        setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== assistantMsgId));
        return;
      }

      if (data.status === "error") {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId
              ? assistantError({ existing: m, errorMessage: "🎤 Didn’t catch that. Try again." })
              : m
          )
        );
        setStatusText("Say your question clearly… I’m listening.");
        updateVoiceState("IDLE");
        return;
      }

      const cleanedQuery =
        (typeof data.cleaned_query === "string" && data.cleaned_query.trim()) ||
        (typeof data.query === "string" && data.query.trim()) ||
        (typeof data.transcript === "string" && data.transcript.trim()) ||
        "Voice Input";

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

      setMessages((prev) =>
        prev.map((m) => {
          if (m.id === userMsgId) return { ...m, text: getVoiceUserText(data) };
          if (m.id === assistantMsgId) return assistantCompleteFromResponse({ existing: m, response: data, liteMode });
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
        setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== assistantMsgId));
        return;
      }

      const errMsg = getSafeErrorMessage(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId ? assistantError({ existing: m, errorMessage: errMsg }) : m
        )
      );
      setStatusText(errMsg);
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
        ? [makeUserMessage({ id: userMsgId, text: displayText, source: "keyboard", traceId })]
        : []),
      makeAssistantLoadingMessage({ id: assistantMsgId, source: "keyboard", traceId, context: context || undefined }),
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

      const data = await sendKeyboardCoachingQuery({
        backendUrl: BACKEND_URL,
        request: {
          query,
          voice: false,
          lite: liteMode === true,
          user_profile: getNormalizedUser(user),
          traceId,
        },
        signal: controller.signal,
      });

      const latency = Date.now() - startTime;
      if (TRACE_LEVEL >= 2) console.log(`[${nowISO()}][FE][API][${traceId}] ← /query ${latency}ms`);
      logTrace(traceId, "API_LATENCY_MS", latency);

      clearTimeout(timeoutId);
      clearThinkingTimer();
      abortControllerRef.current = null;

      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== assistantMsgId));
        return null;
      }

      logTrace(traceId, "API_RESPONSE_SUMMARY", {
        status: data?.status,
        input_domain: data?.input_domain,
        foods: data?.foods ?? [],
      });

      logTrace(traceId, "UI_UPDATE_START");

      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? assistantCompleteFromResponse({ existing: m, response: data, liteMode })
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
        setMessages(prev => prev.filter(m => m.id !== userMsgId && m.id !== assistantMsgId));
        return null;
      }

      const errMsg = getSafeErrorMessage(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? assistantError({ existing: m, errorMessage: errMsg })
            : m
        )
      );

      setStatusText(errMsg);
      updateVoiceState("IDLE");

      setTimeout(() => {
        setStatusText((cur) => (cur === errMsg ? null : cur));
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

      const p = id ? (profiles as Record<string, any>)[id] : null;
      if (!p) {
        setUser(null);
        router.replace("/login");
      } else {
        setUser(p);
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

  const sendFeedback = async (msg: ChatMessage, feedback: "helpful" | "not_helpful") => {
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

  const sendActionTaken = async (msg: ChatMessage) => {
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
                                borderColor: action === "Try Lite" ? C.accent : "#2D3748",
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
                  <View key={msg.id}>
                    {msg.role === "user" && (
                      <UserMessage msg={msg} colors={C} />
                    )}
                    {msg.role === "assistant" && (
                      <>
                        <AssistantMessage msg={msg} colors={C} />
                        <ActionCards
                          msg={msg}
                          colors={C}
                          onFeedback={sendFeedback}
                          onActionTaken={sendActionTaken}
                          onNextAction={(code) => {
                            const newTraceId = createTraceId();
                            sendKeyboardQuery(code, newTraceId);
                          }}
                        />
                      </>
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
    backgroundColor: C.bg,
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