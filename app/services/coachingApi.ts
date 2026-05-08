import type { CoachingRequest, CoachingResponse } from "../types/coaching";

export async function sendKeyboardCoachingQuery(args: {
  backendUrl: string;
  request: CoachingRequest;
  signal?: AbortSignal;
}): Promise<CoachingResponse> {
  const res = await fetch(`${args.backendUrl}/query`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trace-id": args.request.traceId || "",
    },
    body: JSON.stringify(args.request),
    signal: args.signal,
  });

  let data: CoachingResponse;
  try {
    data = await res.json();
  } catch {
    throw new Error("Invalid backend response.");
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return data;
}

export async function sendVoiceCoachingQuery(args: {
  backendUrl: string;
  audioUri: string;
  traceId: string;
  extraFields?: Record<string, string>;
  signal?: AbortSignal;
}): Promise<CoachingResponse> {
  const isCAF = args.audioUri.endsWith(".caf");
  const form = new FormData();
  form.append("audio_file", {
    uri: args.audioUri,
    name: isCAF ? "audio.caf" : "audio.m4a",
    type: isCAF ? "audio/x-caf" : "audio/m4a",
  } as any);

  if (args.extraFields) {
    for (const [k, v] of Object.entries(args.extraFields)) {
      form.append(k, v);
    }
  }

  const res = await fetch(`${args.backendUrl}/query/voice`, {
    method: "POST",
    headers: { "x-trace-id": args.traceId },
    body: form,
    signal: args.signal,
  });

  let data: CoachingResponse;
  try {
    data = await res.json();
  } catch {
    throw new Error("Invalid backend response.");
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  return data;
}
