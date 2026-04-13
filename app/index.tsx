import { C } from "@/constants/colors";
import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system/legacy";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import SectionCard from "../components/SectionCard";

const BACKEND_URL = "http://192.168.40.138:8000";


// Voice thresholds — all configurable, no hardcoded values per spec §2.1
const SILENCE_DB_THRESHOLD = -40; // dBFS — below = silence
const SOFT_PAUSE_MS = 2000;       // 2s — show "Still listening..."
const FINAL_PAUSE_MS = 4000;      // 4s — stop and send
const MAX_RECORDING_MS = 20000;   // 20s — hard stop failsafe
const REQUEST_TIMEOUT_MS = 20000; // 20s — backend request timeout


type VoiceState = "IDLE" | "RECORDING" | "PROCESSING" | "PLAYING";

type Section = { title: string; content: string };

type QueryBlock = {
  id: string;
  query: string;
  status: "loading" | "complete" | "error";
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

  // Refs — readable inside callbacks, AppState handler, timers
  const voiceStateRef = useRef<VoiceState>("IDLE");
  const activeSoundRef = useRef<Audio.Sound | null>(null);
  const activeRecordingRef = useRef<Audio.Recording | null>(null);
  const isStoppingRef = useRef(false);
  const lastSpeechTimeRef = useRef(Date.now());
  const maxDurationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const discardResponseRef = useRef(false);

  const scrollRef = useRef<ScrollView>(null);
  const blockRefs = useRef<Record<string, View | null>>({});
  const lastScrollIdRef = useRef<string | null>(null);

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
    updateVoiceState("PROCESSING");
    discardResponseRef.current = false;

    const id = `${Date.now()}-${Math.random()}`;
    lastScrollIdRef.current = id;

    // Create block with empty query — updated to cleaned_query on response per spec §8.3
    setBlocks((prev) => [...prev, { id, query: "", status: "loading" }]);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBlock(id)));

    // Non-blocking warning if max duration was reached — spec §2.2
    const initialStatus = isMaxDuration
      ? "Recording limit reached. Transcribing..."
      : "Transcribing...";
    setStatusText(initialStatus);

    // Switch to "Processing..." after Whisper is likely done — spec §8.2
    const processingTimer = setTimeout(() => {
      if (voiceStateRef.current === "PROCESSING") {
        setStatusText("Processing...");
      }
    }, 5000);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const isCAF = uri.endsWith(".caf");
      const formData = new FormData();
      formData.append("audio_file", {
        uri,
        name: isCAF ? "audio.caf" : "audio.m4a",
        type: isCAF ? "audio/x-caf" : "audio/m4a",
      } as any);

      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      clearTimeout(processingTimer);
      abortControllerRef.current = null;

      // Discard if app was backgrounded during PROCESSING — spec §10.2
      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        console.log("[sendVoiceQuery] response discarded — app was backgrounded");
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const cleanedQuery =
        typeof data.cleaned_query === "string" ? data.cleaned_query : "";
      const text = typeof data.message === "string" ? data.message : "";

      // Always update query bubble with cleaned_query — unconditionally per spec §8.3
      if (data.status === "error") {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === id
              ? { ...b, query: cleanedQuery, status: "error", errorMessage: text }
              : b
          )
        );
        setStatusText(text);
        updateVoiceState("IDLE");
        setTimeout(
          () => setStatusText((cur) => (cur === text ? null : cur)),
          4000
        );
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
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToBlock(id)));

      console.log("AUDIO LENGTH:", data.audio?.length);

      // Play audio if returned and valid — spec §6.1
      if (data.audio) {
        await playAudio(data.audio);
      } else {
        updateVoiceState("IDLE");
        setStatusText(null);
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      clearTimeout(processingTimer);
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
          b.id === id ? { ...b, status: "error", errorMessage: message } : b
        )
      );
      setStatusText(message);
      updateVoiceState("IDLE");
      setTimeout(
        () => setStatusText((cur) => (cur === message ? null : cur)),
        4000
      );
    }
  };

  // ─── Keyboard query ───────────────────────────────────────────────────────

  const sendKeyboardQuery = async (query: string) => {
    // Global Interruption Rule — spec §4.4
    await stopAnyPlayback();

    if (voiceStateRef.current === "RECORDING") {
      await cancelRecording();
    }

    if (voiceStateRef.current === "PROCESSING") return;

    Keyboard.dismiss();
    updateVoiceState("PROCESSING");
    setStatusText("Processing...");
    discardResponseRef.current = false;

    const id = `${Date.now()}-${Math.random()}`;
    lastScrollIdRef.current = id;

    setInput("");
    setBlocks((prev) => [...prev, { id, query, status: "loading" }]);
    requestAnimationFrame(() => requestAnimationFrame(() => scrollToBlock(id)));

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch(`${BACKEND_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, voice: false }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      abortControllerRef.current = null;

      if (discardResponseRef.current) {
        discardResponseRef.current = false;
        return;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = await res.json();
      const text = typeof data.message === "string" ? data.message : "";
      const sections = parseSections(text);

      setBlocks((prev) =>
        prev.map((b) =>
          b.id === id
            ? {
              ...b,
              status: "complete",
              sections: sections ?? undefined,
              rawText: sections ? undefined : text,
            }
            : b
        )
      );
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToBlock(id)));

      // NEVER play audio for keyboard input — spec §6.1, §11 constraint 5
      updateVoiceState("IDLE");
      setStatusText(null);
    } catch (err: any) {
      clearTimeout(timeoutId);
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
          b.id === id ? { ...b, status: "error", errorMessage: message } : b
        )
      );
      setStatusText(message);
      updateVoiceState("IDLE");
      setTimeout(
        () => setStatusText((cur) => (cur === message ? null : cur)),
        4000
      );
    }
  };

  // ─── Recording control ────────────────────────────────────────────────────

  const cancelRecording = async () => {
    isStoppingRef.current = true;

    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }

    const rec = activeRecordingRef.current;
    activeRecordingRef.current = null;

    if (rec) {
      // stopAndUnloadAsync — single correct teardown, releases OS mic lock — spec §13.1
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
    if (maxDurationTimerRef.current) {
      clearTimeout(maxDurationTimerRef.current);
      maxDurationTimerRef.current = null;
    }

    const rec = activeRecordingRef.current;
    activeRecordingRef.current = null;

    if (!rec) return;

    // stopAndUnloadAsync — single correct teardown — spec §13.1, §11 constraint 7
    try {
      await rec.stopAndUnloadAsync();
    } catch (err) {
      console.error("[stopRecordingAndSend] stopAndUnloadAsync error:", err);
    }

    // Reset audio mode before playback path — spec §13.2
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
    } catch { }

    const uri = rec.getURI();

    if (!uri) {
      const msg = "Could not understand. Please try again.";
      setStatusText(msg);
      voiceStateRef.current = "IDLE";
      setVoiceState("IDLE");
      setTimeout(() => setStatusText((cur) => (cur === msg ? null : cur)), 4000);
      return;
    }

    // Pre-submit check: file must be non-empty — spec §3.3 (only frontend check)
    try {
      const info = await FileSystem.getInfoAsync(uri, { size: true });
      if (!info.exists || (info as any).size === 0) {
        const msg = "Could not understand. Please try again.";
        setStatusText(msg);
        voiceStateRef.current = "IDLE";
        setVoiceState("IDLE");
        setTimeout(() => setStatusText((cur) => (cur === msg ? null : cur)), 4000);
        return;
      }
    } catch {
      // Cannot check file info — proceed and let backend handle
    }

    await sendVoiceQuery(uri, isMaxDuration);
  };

  const startRecording = async () => {
    const state = voiceStateRef.current;

    // Precondition: must be IDLE or PLAYING — spec §5.1
    if (state !== "IDLE" && state !== "PLAYING") {
      console.warn(`[startRecording] mic tap ignored — state is ${state}`);
      return;
    }

    // Global Interruption Rule — stop any active playback first — spec §4.4
    await stopAnyPlayback();

    // Mic permission — spec §13.1
    const permission = await Audio.requestPermissionsAsync();
    if (!permission.granted) {
      const msg = "Microphone access is required for voice input.";
      setStatusText(msg);
      setTimeout(() => setStatusText((cur) => (cur === msg ? null : cur)), 4000);
      return;
    }

    // Parallel recording guard — spec §13.1
    const dangling = activeRecordingRef.current;
    if (dangling) {
      activeRecordingRef.current = null;
      try {
        await dangling.stopAndUnloadAsync();
      } catch { }
    }

    isStoppingRef.current = false;
    lastSpeechTimeRef.current = Date.now();

    try {
      // Required audio mode before recording on iOS — spec §13.1
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });

      // isMeteringEnabled: true required for silence detection — spec §13.1
      const preset: Audio.RecordingOptions = {
        ...Audio.RecordingOptionsPresets.HIGH_QUALITY,
        isMeteringEnabled: true,
      };

      // prepareToRecordAsync + startAsync per spec §13.1 — NOT createAsync
      const rec = new Audio.Recording();
      await rec.prepareToRecordAsync(preset);
      await rec.startAsync();

      activeRecordingRef.current = rec;

      // Input field clears on recording start — spec §8.1
      setInput("");
      updateVoiceState("RECORDING");
      setStatusText("Listening...");

      // Silence detection runs inside status callback — spec §13.1
      rec.setProgressUpdateInterval(200);
      rec.setOnRecordingStatusUpdate((status) => {
        if (!status.isRecording || isStoppingRef.current) return;

        const db: number = (status as any).metering ?? -160;

        if (db > SILENCE_DB_THRESHOLD) {
          // Speech detected — reset pause timer — spec §2.1
          lastSpeechTimeRef.current = Date.now();
          setStatusText("Listening...");
        } else {
          const silentFor = Date.now() - lastSpeechTimeRef.current;

          if (silentFor >= FINAL_PAUSE_MS && !isStoppingRef.current) {
            // Final silence threshold reached — stop and send — spec §2.2, §5.3
            isStoppingRef.current = true;
            stopRecordingAndSend(false);
          } else if (silentFor >= SOFT_PAUSE_MS) {
            // Soft pause — keep recording — spec §2.1, §8.2
            setStatusText("Still listening...");
          }
        }
      });

      // Max duration failsafe — spec §2.2, §5.3
      maxDurationTimerRef.current = setTimeout(() => {
        if (!isStoppingRef.current && voiceStateRef.current === "RECORDING") {
          isStoppingRef.current = true;
          stopRecordingAndSend(true);
        }
      }, MAX_RECORDING_MS);
    } catch (err) {
      console.error("[startRecording] error:", err);
      activeRecordingRef.current = null;
      // Force IDLE on any recording start failure — spec §9.1
      voiceStateRef.current = "IDLE";
      setVoiceState("IDLE");
      setStatusText(null);
    }
  };

  // ─── Input handlers ───────────────────────────────────────────────────────

  const handleMicPress = async () => {
    const state = voiceStateRef.current;

    if (state === "RECORDING") {
      await stopRecordingAndSend(false);
      return;
    }

    if (state === "PLAYING") {
      await stopAnyPlayback();
      updateVoiceState("IDLE");
      return;
    }

    if (state === "IDLE") {
      await startRecording();
      return;
    }

    // PROCESSING → ignore
  };

  const handleSendPress = () => {
    if (voiceStateRef.current === "PROCESSING") return;
    const query = input.trim();
    if (!query) return;
    sendKeyboardQuery(query);
  };

  const handleChip = (value: string) => {
    if (voiceStateRef.current === "PROCESSING") return;
    sendKeyboardQuery(value);
  };

  const handleActionChip = (label: string) => {
    console.log("Chip pressed:", label);

    if (label.toLowerCase().includes("analyze")) {
      router.push("/meal?intent=analyze_meal"); // 👈 your Analyze tab
    }
  };

  // ─── App lifecycle ────────────────────────────────────────────────────────

  useEffect(() => {
    const sub = AppState.addEventListener("change", async (nextAppState) => {
      if (nextAppState !== "background" && nextAppState !== "inactive") return;

      const state = voiceStateRef.current;
      console.log(`[AppState] background — voiceState was ${state}`);

      if (state === "RECORDING") {
        // Stop and discard silently — no error message — spec §10.1
        isStoppingRef.current = true;
        if (maxDurationTimerRef.current) {
          clearTimeout(maxDurationTimerRef.current);
          maxDurationTimerRef.current = null;
        }
        const rec = activeRecordingRef.current;
        activeRecordingRef.current = null;
        if (rec) {
          try {
            await rec.stopAndUnloadAsync();
          } catch { }
        }
        voiceStateRef.current = "IDLE";
        setVoiceState("IDLE");
        setStatusText(null);
      } else if (state === "PROCESSING") {
        // Cancel request and discard response — spec §10.2
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        discardResponseRef.current = true;
        voiceStateRef.current = "IDLE";
        setVoiceState("IDLE");
        setStatusText(null);
      } else if (state === "PLAYING") {
        // Stop and unload audio — spec §10.3
        await stopAnyPlayback();
        voiceStateRef.current = "IDLE";
        setVoiceState("IDLE");
        setStatusText(null);
      }
      // spec §10.4: no auto-resume on foreground return — system is IDLE in all cases
    });

    return () => sub.remove();
  }, []);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }}>
      <View
        style={{
          flex: 1,
          backgroundColor: "#0B0F14",
          padding: 20,
        }}
      >
        <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 6 }}>

          {/* HEADER */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",

              backgroundColor: C.surface,
              borderRadius: 22,
              paddingVertical: 12,
              paddingHorizontal: 16,

              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.08)",

              shadowColor: C.accent,
              shadowOpacity: 0.10,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 2 },
              marginBottom: 0,
            }}
          >
            {/* LEFT SIDE (existing title) */}
            <View style={{ flex: 1, backgroundColor: C.bg }}>
              <Text
                style={{
                  fontSize: 26,
                  letterSpacing: 0.5,
                  fontWeight: "500",
                }}
              >
                <Text style={{ color: C.text }}>Better</Text>
                <Text style={{ color: C.accent }}>Me</Text>
                <Text style={{ color: C.muted, opacity: 0.5 }}>
                  {" · Daily"}
                </Text>
              </Text>

              <Text
                style={{
                  color: C.muted,
                  fontSize: 13,
                  marginTop: 3,
                  opacity: 0.75,
                }}
              >
                Better meals. Better habits. Better you.
              </Text>
            </View>

            {/* RIGHT SIDE (NEW MENU BUTTON) */}
            <TouchableOpacity
              onPress={() => router.push("/menu")}
              style={{
                paddingVertical: 6,
                paddingHorizontal: 12,
                borderRadius: 10,
                backgroundColor: C.surfaceAlt,
              }}
            >
            </TouchableOpacity>
          </View>

          {/* PROFILE BELOW */}
          <View
            style={{
              backgroundColor: C.surfaceAlt,
              borderRadius: 20,
              paddingVertical: 8,
              paddingHorizontal: 12,

              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",

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
                  {/* Query bubble — always shows cleaned_query per spec §8.3 */}
                  {block.query ? (
                    <View
                      style={{
                        alignSelf: "flex-end",
                        backgroundColor: C.userBubble,
                        paddingVertical: 6,
                        paddingHorizontal: 10,
                        borderRadius: 14,
                        marginVertical: 3,
                        maxWidth: "80%",
                      }}
                    >
                      <Text style={{ color: C.textDark }}>
                        {block.query}
                      </Text>
                    </View>
                  ) : null}

                  {block.status === "loading" && (
                    <View style={{ padding: 10 }}>
                      <ActivityIndicator color={C.accent} />
                    </View>
                  )}

                  {block.status === "error" && (
                    <Text
                      style={{
                        color: C.error,
                        paddingVertical: 4,
                        paddingHorizontal: 2,
                      }}
                    >
                      {block.errorMessage ??
                        "Something went wrong. Please try again."}
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
                paddingHorizontal: 12,
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
                  "🍳 Build a meal",
                  "⚡ What should I do now",
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
                placeholder='Ask or speak… say “Go BetterMe”'
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
                  {isRecording ? "⏹" : "🎤"}
                  {voiceState === "PLAYING" ? "⏹" : "🎤"}
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
  );
}