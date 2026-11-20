"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, CornerDownLeft, Loader2, Paperclip, PhoneOff, Volume2, VolumeX, X } from "lucide-react";
import { VoiceEarth, type EarthPhase } from "./voice-earth";
import { stripToolMarkup } from "@/lib/ai/tool-markup";
import { availableGenders, pickVoice, type VoiceGender } from "@/lib/ai/voice/preferred-voices";
import { recordUtterance, smoothLevel, toWav } from "@/lib/ai/voice/recorder";
import { lastModeScope, writeLastMode } from "@/lib/ai/voice/last-mode";
import { nextSentence } from "@/lib/ai/voice/sentences";
import { SHELL_DISABLED_REPLY } from "@/lib/harness/command-classifier";

type Phase = "idle" | "listening" | "thinking" | "speaking" | "error";

interface VoiceModeProps {
  assistantId?: string;
  conversationId?: string;
  onConversation?: (id: string) => void;
  onExit: () => void;

}

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: number;
  /** Tools the harness used during this assistant turn, for the collapsible tools line. */
  tools?: VoiceTool[];
}

interface Attachment {
  id: string;
  name: string;
  mimeType?: string;
  size?: number;
}

/** One tool step in a voice turn's timeline (mirrors chat's HarnessToolTimeline). */
interface VoiceTool {
  name: string;
  status: "running" | "completed" | "error";
  result?: string;
}

/** The muted status line: mode + shell on/off + root, from /api/bot/status. */
interface VoiceStatus {
  mode?: string;
  shell?: boolean;
  root?: string | null;
}

const SPEECH_LANG = "en-IN";

/**
 * True when text is the platform's "shell is disabled" capability answer
 * (either the exact shortcut reply or a platform error carrying the same
 * capability text). These are shown as a muted notice, never a red error.
 */
function isShellDisabledMessage(text: unknown): boolean {
  const value = String(text ?? "").trim();
  if (!value) return false;
  if (value === SHELL_DISABLED_REPLY) return true;
  return /shell/i.test(value) && /disabled/i.test(value);
}

/** Strip what should never be read or spoken: tool markup, emphasis, links. */
function plain(text: string): string {
  return stripToolMarkup(text ?? "")
    .replace(/```[\s\S]*?```/g, " (code) ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The collapsible tools line under a spoken reply — the same muted "N tools ·
 * names" trail the chat shows for harness turns.
 */
function VoiceToolTimeline({ tools, live = false }: { tools: VoiceTool[]; live?: boolean }) {
  if (tools.length === 0) return null;
  const names = tools.map((tool) => tool.name);
  const errored = tools.filter((tool) => tool.status === "error").length;
  return (
    <details
      open={live ? true : undefined}
      className="group mt-1.5 w-fit min-w-[190px] max-w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-meta text-[var(--muted)]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 font-medium transition hover:text-[var(--text)]">
        <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
        <span className="truncate">
          {tools.length} tool{tools.length > 1 ? "s" : ""}
          <span className="text-[var(--faint)]"> · </span>
          {names.join(", ")}
        </span>
        {errored > 0 && <span className="shrink-0 text-rose-600 dark:text-rose-400">{errored} error{errored > 1 ? "s" : ""}</span>}
      </summary>
      <div className="space-y-1 border-t border-[var(--border)] px-2 py-1.5">
        {tools.map((tool, index) => (
          <div key={`${tool.name}-${index}`} className="flex items-start gap-1.5 leading-5">
            {tool.status === "running" ? (
              <Loader2 size={10} className="mt-0.5 shrink-0 animate-spin text-amber-600 dark:text-amber-400" />
            ) : tool.status === "error" ? (
              <X size={10} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
            ) : (
              <Check size={10} className="mt-0.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
            <span className="min-w-0">
              <span className="block truncate font-mono text-[11px] text-[var(--text)]" title={tool.name}>
                {tool.name}
              </span>
              <span className="block text-caption text-[var(--muted)]">
                {tool.status === "running" ? "running…" : tool.status === "error" ? "error" : "completed"}
                {tool.result !== undefined && tool.status !== "running" && (
                  <span className="break-words"> · {tool.result}</span>
                )}
              </span>
            </span>
          </div>
        ))}
      </div>
    </details>
  );
}

/**
 * Voice conversation with the assistant, readable like a chat.
 *
 * It listens, answers aloud and carries on by itself; the same thread is shown
 * as a scrolling transcript so you can read what was said, scroll back through
 * earlier turns, or type (and attach a file) instead of speaking.
 */
export function VoiceMode({ assistantId, conversationId, onConversation, onExit }: VoiceModeProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [heard, setHeard] = useState("");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [personPulseAt, setPersonPulseAt] = useState(0);
  const [speakPulseAt, setSpeakPulseAt] = useState(0);
  const [streamingReply, setStreamingReply] = useState("");
  /** Tool steps of the in-flight turn, for the live "N tools" line while streaming. */
  const [streamingTools, setStreamingTools] = useState<VoiceTool[]>([]);
  /** The muted status line (mode · shell · root), fetched from /api/bot/status. */
  const [botStatus, setBotStatus] = useState<VoiceStatus | null>(null);
  /** A capability notice (e.g. "shell is disabled") shown muted instead of a red error. */
  const [capabilityNotice, setCapabilityNotice] = useState("");
  /** Smoothed microphone level 0..1, shown as a bar while listening. */
  const [micLevel, setMicLevel] = useState(0);
  /** Last time the level was pushed into state; the meter updates ~12x/s. */
  const levelStampRef = useRef(0);

  const recognitionRef = useRef<any>(null);
  const conversationRef = useRef(conversationId ?? "");
  const activeRef = useRef(true);
  const inFlightRef = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  const mutedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const draftRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const silentRoundsRef = useRef(0);
  /** What Chrome says it is hearing — the only way to tell silence from breakage. */
  const [micStatus, setMicStatus] = useState("mic off");
  const [hostedVoice, setHostedVoice] = useState<null | "deepseek" | "openai" | "elevenlabs">(null);
  const [serverAsr, setServerAsr] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<{ id: string; toolName: string; summary: string; via?: "harness" } | null>(null);
  const asrAvailableRef = useRef(false);
  const pendingApprovalRef = useRef<string | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceGender, setVoiceGender] = useState<VoiceGender>("female");
  const [speakingChunks, setSpeakingChunks] = useState(false);
  const micStatusRef = useRef("mic off");
  const genderRef = useRef<VoiceGender>("female");
  const queueRef = useRef<string[]>([]);
  const pumpingRef = useRef(false);
  const bargeRef = useRef<any>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speechGenRef = useRef(0);
  const serverVoiceRef = useRef(false);
  const spokenRef = useRef("");
  /** The one microphone stream for the whole voice session, reused per utterance. */
  const micStreamRef = useRef<MediaStream | null>(null);
  /** Identity of the turn currently allowed to stream text/speech; barge-in supersedes it. */
  const askGenRef = useRef(0);
  /** Where the pending approval's decision must go ("harness" → /api/harness/approve). */
  const pendingViaRef = useRef<"harness" | undefined>(undefined);
  /** One recording at a time: a second concurrent recorder would fight over the mic stream. */
  const recordingRef = useRef(false);
  /** Consecutive ASR rounds that came back without words; two strikes pauses the session. */
  const emptyAsrRoundsRef = useRef(0);

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
    // The meter only exists while listening; leaving clears its memory so the
    // next session starts from silence rather than a frozen bar.
    if (next !== "listening") setMicLevel(0);
  }, []);

  /** Read the live phase; as a function it never carries TS's flow narrowing. */
  const currentPhase = useCallback((): Phase => phaseRef.current, []);

  /**
   * Remember that this assistant was last used in voice mode, for the bot
   * workspace to restore next time. The voice screen is the only component
   * that reliably knows when it opened, so it writes the key itself; the
   * scope is the assistant's id (or "personal" before it has loaded).
   */
  const lastModeScopeRef = useRef(lastModeScope(assistantId));
  useEffect(() => {
    const scope = lastModeScope(assistantId);
    lastModeScopeRef.current = scope;
    try {
      writeLastMode(window.localStorage, scope, "voice");
    } catch {
      /* storage may be unavailable */
    }
  }, [assistantId]);

  /** Leaving the voice screen on purpose: the assistant's last mode is chat. */
  const exit = useCallback(() => {
    try {
      writeLastMode(window.localStorage, lastModeScopeRef.current, "chat");
    } catch {
      /* storage may be unavailable */
    }
    onExit();
  }, [onExit]);

  /**
   * One microphone acquisition per voice session. Chrome asks for permission
   * on the first getUserMedia and never again while these tracks stay live, so
   * every utterance records from this same stream — no permission flicker, no
   * device re-probe between turns. The tracks stop only on exit or a hard
   * microphone error.
   */
  const acquireMicStream = useCallback(async (): Promise<MediaStream> => {
    const existing = micStreamRef.current;
    if (existing && existing.getAudioTracks().some((track) => track.readyState === "live")) {
      return existing;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    micStreamRef.current = stream;
    return stream;
  }, []);

  const releaseMicStream = useCallback(() => {
    micStreamRef.current?.getTracks().forEach((track) => track.stop());
    micStreamRef.current = null;
  }, []);

  /** The voice to use: the most natural one of the chosen gender. */
  const chosenVoice = useCallback(
    (gender: VoiceGender) => pickVoice(voices.map((voice) => ({ name: voice.name, lang: voice.lang })), gender),
    [voices]
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => {
      const list = (window.speechSynthesis.getVoices() ?? []).filter((voice) => /^(en|hi)/i.test(voice.lang));
      if (!list.length) return;
      setVoices(list as SpeechSynthesisVoice[]);
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem("cyraops:voiceGender");
      } catch {
        stored = null;
      }
      const genders = availableGenders(list);
      const next: VoiceGender = stored === "male" || stored === "female" ? stored : genders.includes("female") ? "female" : genders[0] ?? "female";
      setVoiceGender(next);
      genderRef.current = next;
    };
    load();
    window.speechSynthesis.addEventListener?.("voiceschanged", load);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", load);
  }, []);

  useEffect(() => {
    void (async () => {
      const data = await fetch("/api/assistant/asr")
        .then((response) => response.json())
        .catch(() => ({}));
      asrAvailableRef.current = Boolean(data?.available);
      setServerAsr(Boolean(data?.available));
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      const data = await fetch("/api/assistant/tts")
        .then((response) => response.json())
        .catch(() => ({}));
      const provider = ["deepseek", "openai", "elevenlabs"].includes(data?.provider) ? (data.provider as "deepseek" | "openai" | "elevenlabs") : null;
      serverVoiceRef.current = Boolean(data?.available && provider);
      setHostedVoice(data?.available && provider ? provider : null);
    })();
  }, []);

  // The muted status line (Wave 1c voice parity): mode + shell on/off + root.
  // Primary source is the sibling's GET /api/bot/status; if it is not deployed
  // yet, degrade gracefully to the conversation's workspace root only.
  useEffect(() => {
    const id = conversationId ?? conversationRef.current;
    void (async () => {
      try {
        const query = id ? `?conversationId=${encodeURIComponent(id)}` : "";
        const data = await fetch(`/api/bot/status${query}`)
          .then((response) => response.json())
          .catch(() => ({}));
        if (data && (typeof data.mode === "string" || typeof data.effectiveMode === "string" || "shellEnabled" in data || "root" in data)) {
          setBotStatus({
            mode: typeof data.effectiveMode === "string" ? data.effectiveMode : typeof data.mode === "string" ? data.mode : undefined,
            shell: typeof data.shellEnabled === "boolean" ? data.shellEnabled : undefined,
            root: "root" in data ? (data.root ?? null) : undefined,
          });
          return;
        }
      } catch {
        /* fall through to the lightweight fallback below */
      }
      if (!id) {
        setBotStatus(null);
        return;
      }
      try {
        const data = await fetch(`/api/assistant/conversations/${encodeURIComponent(id)}/workspace`)
          .then((response) => response.json())
          .catch(() => ({}));
        const ws = data?.workspace ?? null;
        setBotStatus({ root: ws?.workspaceRootRealpath || ws?.workspaceRoot || null });
      } catch {
        setBotStatus(null);
      }
    })();
  }, [conversationId]);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted && typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    if (muted) stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [muted]);

  // Keep the newest turn in view, the way a chat does.
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [turns, streamingReply, heard]);

  const appendTurn = useCallback((role: Turn["role"], text: string, tools?: VoiceTool[]) => {
    setTurns((current) => [...current, { id: `${role}_${Date.now()}_${current.length}`, role, text, at: Date.now(), tools }]);
  }, []);

  // Earlier turns of this conversation, so the transcript is not empty on entry.
  useEffect(() => {
    const id = conversationId ?? conversationRef.current;
    if (!id) return;
    void (async () => {
      const data = await fetch(`/api/assistant/messages?conversationId=${encodeURIComponent(id)}`)
        .then((response) => response.json())
        .catch(() => ({}));
      if (!activeRef.current || !Array.isArray(data.messages)) return;
      setTurns(
        data.messages
          .filter((message: any) => message?.content)
          .slice(-40)
          .map((message: any) => ({
            id: message.id,
            role: message.role === "user" ? "user" : "assistant",
            text: String(message.content),
            at: new Date(message.createdAt ?? Date.now()).getTime(),
          }))
      );
    })();
  }, [conversationId]);

  const stopRecognition = useCallback(() => {
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    submitTimerRef.current = null;
    try {
      recognitionRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recognitionRef.current = null;
  }, []);

  const clearWatchdog = useCallback(() => {
    if (watchdogRef.current) clearTimeout(watchdogRef.current);
    watchdogRef.current = null;
  }, []);

  /**
   * One timer per listening session. Recognizers can end immediately and be
   * restarted in a loop; if each restart re-armed this, silence could last
   * forever without ever being reported.
   */
  const armWatchdog = useCallback(() => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      if (!activeRef.current || phaseRef.current !== "listening") return;
      const heardSomething = /hearing (sound|speech)/.test(micStatusRef.current);
      stopRecognition();
      setError(
        heardSomething
          ? "Chrome can hear you but can't turn it into words — its speech service looks blocked on this network. Tap the planet to retry, or type instead."
          : "I didn't hear anything — pick the right mic in Chrome's address bar, then tap the planet to try again."
      );
      setPhaseSafe("error");
    }, 12000);
  }, [clearWatchdog, setPhaseSafe, stopRecognition]);

  /**
   * Speech, in sentences, as they arrive.
   *
   * Speaking only after the whole reply had streamed in was most of why this felt
   * like a walkie-talkie. Chunks go into a queue and play back to back, so the
   * first words are heard while the rest is still being written.
   */
  /**
   * Speak one chunk with the browser's own voice. The fallback, used when this
   * deployment has no hosted voice or the request fails mid-conversation.
   */
  const browserUtter = useCallback(
    (text: string, advance: () => void) => {
      const utterance = new SpeechSynthesisUtterance(text);
      const wanted = chosenVoice(genderRef.current);
      const chosen = wanted ? voices.find((voice) => voice.name === wanted.name) ?? null : null;
      try {
        if (chosen) utterance.voice = chosen;
      } catch {
        /* default voice */
      }
      utterance.lang = chosen?.lang || SPEECH_LANG;
      utterance.rate = 1.0;
      utterance.pitch = genderRef.current === "male" ? 0.9 : 1.05;
      utterance.onboundary = () => setSpeakPulseAt(Date.now());
      utterance.onend = advance;
      utterance.onerror = advance;
      window.speechSynthesis.speak(utterance);
    },
    [chosenVoice, voices]
  );

  const pump = useCallback(() => {
    if (pumpingRef.current || !activeRef.current) return;
    const next = queueRef.current.shift();
    if (!next) {
      setSpeakingChunks(false);
      return;
    }
    pumpingRef.current = true;
    setSpeakingChunks(true);
    setPhaseSafe("speaking");

    const advance = () => {
      pumpingRef.current = false;
      if (!activeRef.current) return;
      if (queueRef.current.length) pump();
      else setSpeakingChunks(false);
    };

    if (mutedRef.current) {
      advance();
      return;
    }

    // Hosted voice first: same voice on every machine, nothing to install.
    if (serverVoiceRef.current && typeof window !== "undefined") {
      const generation = speechGenRef.current;
      void (async () => {
        try {
          const response = await fetch("/api/assistant/tts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: next, gender: genderRef.current }),
          });
          if (!response.ok) throw new Error("speech unavailable");
          const blob = await response.blob();
          if (generation !== speechGenRef.current) {
            // Superseded while we were fetching: say nothing.
            pumpingRef.current = false;
            return;
          }
          const url = URL.createObjectURL(blob);
          const audio = new Audio(url);
          audioRef.current = audio;
          const finish = () => {
            URL.revokeObjectURL(url);
            if (audioRef.current === audio) audioRef.current = null;
            advance();
          };
          audio.onended = finish;
          audio.onerror = finish;
          await audio.play();
        } catch {
          // Fall back for this chunk rather than going silent.
          if (typeof window === "undefined" || !window.speechSynthesis) {
            advance();
            return;
          }
          browserUtter(next, advance);
        }
      })();
      return;
    }

    if (typeof window === "undefined" || !window.speechSynthesis) {
      advance();
      return;
    }
    browserUtter(next, advance);
  }, [browserUtter, setPhaseSafe]);

  /** Queue a sentence; the queue plays itself. */
  const enqueueSpeech = useCallback(
    (text: string) => {
      const clean = plain(text).trim();
      if (!clean) return;
      spokenRef.current = `${spokenRef.current} ${clean}`.slice(-400);
      queueRef.current.push(clean.slice(0, 600));
      pump();
    },
    [pump]
  );

  const stopSpeaking = useCallback(() => {
    // Invalidate any audio still being fetched for this answer, so a chunk that
    // arrives late cannot start talking over the person who interrupted.
    speechGenRef.current += 1;
    queueRef.current = [];
    pumpingRef.current = false;
    setSpeakingChunks(false);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.currentTime = 0;
      audioRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
  }, []);

  const speak = useCallback(
    (text: string, thenListen: () => void) => {
      if (!text.trim() || mutedRef.current || typeof window === "undefined" || !window.speechSynthesis) {
        thenListen();
        return;
      }
      stopSpeaking();
      queueRef.current.push(plain(text).slice(0, 1200));
      // Wait for the queue to drain, then hand back to listening.
      const waitForEnd = () => {
        if (!activeRef.current) return;
        if (queueRef.current.length || pumpingRef.current) {
          setTimeout(waitForEnd, 150);
          return;
        }
        thenListen();
      };
      pump();
      waitForEnd();
    },
    [pump, stopSpeaking]
  );

  /**
   * Listen by recording, then let DeepSeek transcribe.
   *
   * The browser's recognizer mangles accents; this records wherever speech is
   * detected, sends one WAV, and gets back the words. The browser path below is
   * kept for deployments without a transcription key.
   */
  const listenWithServerAsr = useCallback(async () => {
    if (!activeRef.current || recordingRef.current) return;
    recordingRef.current = true;
    try {
      await recordOneUtterance();
    } finally {
      recordingRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setPhaseSafe]);

  /** One record → transcribe round, against the session's single mic stream. */
  const recordOneUtterance = useCallback(async () => {
    if (!activeRef.current) return;
    setPhaseSafe("listening");
    setHeard("");
    setError("");
    setMicLevel(0);
    levelStampRef.current = 0;
    try {
      const stream = await acquireMicStream();
      const { blob, hadSpeech } = await recordUtterance(stream, {
        silenceMs: 1300,
        maxUtteranceMs: 30000,
        // Feed the meter without re-rendering on every audio frame: the bar
        // shows the smoothed level, refreshed a dozen times a second.
        onLevel: (value) => {
          const now = performance.now();
          if (now - levelStampRef.current < 80) return;
          levelStampRef.current = now;
          setMicLevel((previous) => smoothLevel(previous, value));
        },
      });
      // The session stream stays live for the next utterance: only leaving the
      // voice screen or a hard microphone failure stops its tracks.
      if (!activeRef.current) return;
      // The planet was tapped to pause while this recording ran: say nothing.
      if (phaseRef.current === "idle" || phaseRef.current === "error") return;

      if (!hadSpeech || !blob) {
        // Nothing said: keep listening rather than declaring a fault on the
        // first quiet moment.
        silentRoundsRef.current += 1;
        setMicStatus("mic open, no sound yet");
        if (silentRoundsRef.current >= 3) {
          setError("I didn't hear anything — check Chrome's mic input, then tap the planet to try again.");
          setPhaseSafe("error");
          return;
        }
        // Round finished: the guard above was still held during this call, so
        // re-listen on a fresh tick rather than recursing into it. Only while
        // the round still owns the screen — a planet tap in this window parked
        // the session (idle/error), so do not drag it back into listening.
        setTimeout(() => {
          if (phaseRef.current === "listening") void listenWithServerAsr();
        }, 50);
        return;
      }

      silentRoundsRef.current = 0;
      setPhaseSafe("thinking");
      const wav = await toWav(blob);
      const form = new FormData();
      form.append("file", wav, "speech.wav");
      let data: Record<string, unknown> = {};
      try {
        const response = await fetch("/api/assistant/asr", { method: "POST", body: form });
        data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      } catch {
        // A failed transcription round is retried like an empty one below.
        data = {};
      }
      if (!activeRef.current) return;
      // The phase may have changed while the transcription ran (planet tap,
      // an error): re-read it before acting on the round's outcome.
      const phaseNow = currentPhase();
      if (phaseNow === "idle" || phaseNow === "error") return;
      const said = String(data?.text ?? "").trim();
      if (!said) {
        // Not the end of the conversation: keep the mic session alive and
        // listen again. Two consecutive wordless rounds pause the session and
        // offer the fallback rather than spinning forever on a broken mic.
        emptyAsrRoundsRef.current += 1;
        setMicStatus("heard something, no words");
        if (emptyAsrRoundsRef.current >= 2) {
          setError("Couldn't hear clearly — tap to retry, or type instead");
          setPhaseSafe("error");
          return;
        }
        // The re-listen is only wanted while the round still owns the screen
        // ("thinking"): a planet tap in this window parked the session, so do
        // not drag it back into listening.
        setTimeout(() => {
          if (phaseRef.current === "thinking") void listenWithServerAsr();
        }, 50);
        return;
      }
      emptyAsrRoundsRef.current = 0;
      void askRef.current?.(said);
    } catch (caught) {
      if (!activeRef.current) return;
      const name = (caught as DOMException)?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        releaseMicStream();
        setError("Tap the mic icon in Chrome's address bar to allow the microphone, then tap the planet to try again.");
      } else if (name === "NotFoundError") {
        releaseMicStream();
        setError("No microphone found — plug one in, then tap the planet to try again.");
      } else {
        setError((caught as Error)?.message || "Could not record from the microphone.");
      }
      setPhaseSafe("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [acquireMicStream, currentPhase, releaseMicStream, setPhaseSafe]);

  const listen = useCallback(() => {
    if (!activeRef.current) return;
    if (asrAvailableRef.current) {
      void listenWithServerAsr();
      return;
    }
    // Chrome allows a single recognizer per page: whichever starts aborts the
    // other with 'aborted'. The barge-in recognizer must therefore be stopped
    // before the listening one starts, or listening dies the moment it begins.
    try {
      bargeRef.current?.stop();
    } catch {
      /* already stopped */
    }
    bargeRef.current = null;
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) {
      setError("This browser cannot listen. Chrome or Safari work best.");
      setPhaseSafe("error");
      return;
    }
    stopRecognition();
    setHeard("");
    setPhaseSafe("listening");

    const recognition = new Ctor();
    recognition.lang = navigator.language?.toLowerCase().startsWith("hi") ? "hi-IN" : SPEECH_LANG;
    recognition.interimResults = true;
    // Continuous, so a breath in the middle of a sentence does not end the turn.
    // Chrome stops a non-continuous recognizer at the first pause, which cut
    // people off mid-sentence; now we decide when the sentence is over.
    recognition.continuous = true;

    let finalText = "";
    let lastInterim = "";

    /** Submit once the speaking has actually stopped, not at every breath. */
    const armSubmit = () => {
      if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
      submitTimerRef.current = setTimeout(() => {
        submitTimerRef.current = null;
        if (!activeRef.current || phaseRef.current !== "listening") return;
        if (recognitionRef.current !== recognition) return;
        const said = (finalText || lastInterim).trim();
        if (!said) return;
        void ask(said);
      }, 1500);
    };

    // Chrome reports its audio pipeline through these events: they separate
    // "microphone never opened" from "microphone open, no sound" from
    // "sound arrived but no words were recognised".
    const note = (value: string) => {
      micStatusRef.current = value;
      setMicStatus(value);
    };
    recognition.onaudiostart = () => note("mic open");
    recognition.onaudioend = () => note("mic closed");
    recognition.onsoundstart = () => note("hearing sound");
    recognition.onsoundend = () => note("sound stopped");
    recognition.onspeechstart = () => note("hearing speech");
    recognition.onspeechend = () => note("speech ended");

    recognition.onresult = (event: any) => {
      clearWatchdog();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) lastInterim = interim;
      silentRoundsRef.current = 0;
      setHeard((finalText || interim).trim());
      setPersonPulseAt(Date.now());
      armSubmit();
    };

    recognition.onerror = (event: any) => {
      const reason = event?.error ?? "";
      if (reason === "aborted") {
        // Something else took the microphone. If we are still meant to listen,
        // ask Chrome again rather than leaving a dead session on screen.
        if (activeRef.current && phaseRef.current === "listening") {
          setMicStatus("mic taken by another recognizer");
        }
        return;
      }
      if (reason === "no-speech") {
        // With continuous listening this means the microphone carried no speech
        // at all for a long stretch, which is worth mentioning after a while.
        silentRoundsRef.current += 1;
        note("mic open, no sound yet");
        if (silentRoundsRef.current >= 3) {
          setError("I didn't hear anything — check Chrome's mic input, then tap the planet to try again.");
          setPhaseSafe("error");
        }
        return;
      }
      const messages: Record<string, string> = {
        "not-allowed": "Tap the mic icon in Chrome's address bar to allow the microphone, then tap the planet to try again.",
        "service-not-allowed": "The browser's speech service is turned off on this device.",
        "audio-capture": "No microphone found — plug one in, then tap the planet to try again.",
        network: "Voice needs an internet connection in Chrome.",
      };
      if (reason === "language-not-supported" && recognition.lang !== "en-US") {
        recognition.lang = "en-US";
        try {
          recognition.start();
          return;
        } catch {
          /* fall through to the error below */
        }
      }
      setError(messages[reason] ?? `Listening stopped (${reason || "unknown reason"}).`);
      setPhaseSafe("error");
    };

    recognition.onend = () => {
      if (!activeRef.current || phaseRef.current !== "listening") return;
      if (recognitionRef.current !== recognition) return;
      const text = (finalText || lastInterim).trim();
      if (text) {
        void ask(text);
      } else {
        setTimeout(() => {
          if (activeRef.current && phaseRef.current === "listening") listen();
        }, 400);
      }
    };

    recognitionRef.current = recognition;

    try {
      recognition.start();
    } catch {
      setError("Could not start the microphone.");
      setPhaseSafe("error");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clearWatchdog, setPhaseSafe, stopRecognition]);

  /**
   * Hand back to listening after a turn. The 12s watchdog is for the browser
   * recognizer only: the recorder decides utterance ends itself (silence and
   * hard-stop timers), so arming it there would wrongly kill long recordings.
   */
  const resumeListening = useCallback(() => {
    if (!activeRef.current) return;
    if (asrAvailableRef.current) {
      listen();
      return;
    }
    armWatchdog();
    listen();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [armWatchdog, listen]);

  const ask = useCallback(
    async (text: string, files: Attachment[] = [], supersede = false) => {
      if (inFlightRef.current && !supersede) return;
      inFlightRef.current = true;
      // This turn's identity: a barge-in supersedes it, and everything the
      // open stream still delivers after that point is discarded.
      const gen = ++askGenRef.current;
      setPhaseSafe("thinking");
      clearWatchdog();
      stopRecognition();
      setError("");
      setHeard("");
      setStreamingReply("");
      setStreamingTools([]);
      setCapabilityNotice("");
      appendTurn("user", text);

      const controller = new AbortController();
      streamAbortRef.current = controller;
      try {
        const response = await fetch("/api/assistant/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            assistantId: assistantId || undefined,
            conversationId: conversationRef.current || undefined,
            content: text,
            attachmentIds: files.length ? files.map((file) => file.id) : undefined,
            voice: true,
          }),
        });
        if (!response.ok || !response.body) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "The assistant did not answer.");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let reply = "";
        let spokenUpTo = 0;
        const tools: VoiceTool[] = [];
        /** True when this turn was answered by a capability notice (shell disabled). */
        let capabilityReply = false;
        let pending: {
          id: string;
          toolName: string;
          summary?: string;
          reason?: string;
          canAlwaysAllow?: boolean;
          answered?: "allow" | "deny";
          via?: "harness";
        } | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            let payload: any;
            try {
              payload = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            if (payload.type === "token") {
              // Superseded by a barge-in while the stream was closing: these
              // tokens belong to a turn that no longer owns the screen.
              if (askGenRef.current !== gen) continue;
              // The platform's "shell is disabled" capability answer is shown as
              // a muted notice rather than read aloud or treated as a reply.
              if (isShellDisabledMessage(payload.content)) {
                capabilityReply = true;
                setCapabilityNotice(String(payload.content));
                continue;
              }
              reply += payload.content;
              setStreamingReply(reply);
              // Speak each finished sentence as it forms, rather than waiting for
              // the whole answer: the first words land while it is still writing.
              const split = nextSentence(reply.slice(spokenUpTo));
              if (split && split.sentence.trim().length >= 12) {
                spokenUpTo += split.consumed;
                enqueueSpeech(split.sentence);
              }
            } else if (payload.type === "tool") {
              // Show the tool step the moment it starts (voice parity with chat).
              if (askGenRef.current !== gen) continue;
              tools.push({ name: String(payload.name ?? "tool"), status: "running" });
              setStreamingTools([...tools]);
            } else if (payload.type === "tool_done") {
              if (askGenRef.current !== gen) continue;
              const entry = [...tools].reverse().find((tool) => tool.name === payload.name && tool.status === "running");
              if (entry) {
                entry.status = payload.status === "error" || payload.ok === false ? "error" : "completed";
                if (typeof payload.result === "string" && payload.result) entry.result = payload.result;
              }
              setStreamingTools([...tools]);
            } else if (payload.type === "approval") {
              // Harness approval mid-turn: the broker is waiting on the decision,
              // so the card's buttons must be able to answer it right now.
              pendingApprovalRef.current = payload.approvalId;
              pendingViaRef.current = "harness";
              setPendingApproval({ id: payload.approvalId, toolName: payload.toolName, summary: payload.summary, via: "harness" });
            } else if (payload.type === "done") {
              if (payload.reply) {
                // The shortcut command turn also mirrors the capability answer in
                // the done payload; keep it a notice, not a spoken turn.
                if (isShellDisabledMessage(payload.reply)) {
                  capabilityReply = true;
                  setCapabilityNotice(String(payload.reply));
                } else {
                  reply = payload.reply;
                }
              }
              if (payload.conversationId) {
                conversationRef.current = payload.conversationId;
                onConversation?.(payload.conversationId);
              }
              if (payload.pendingAction) pending = payload.pendingAction;
            } else if (payload.type === "error") {
              // A capability error ("shell is disabled") is a clean notice, not
              // a failure: show it muted and let the turn finish quietly.
              if (isShellDisabledMessage(payload.error)) {
                capabilityReply = true;
                setCapabilityNotice(String(payload.error));
                continue;
              }
              throw new Error(payload.error || "The assistant did not answer.");
            }
          }
        }

        // Superseded while the stream was closing: nothing from here on may
        // touch the screen, the transcript or the speech queue.
        if (askGenRef.current !== gen) return;

        setStreamingReply("");
        setStreamingTools([]);
        if (!capabilityReply && reply.trim()) appendTurn("assistant", reply, tools.length > 0 ? tools : undefined);

        // A tool needs a person. Ask here rather than throwing the person out
        // of the voice screen: the card appears above the composer and the
        // conversation carries on once it is answered. Harness approvals carry
        // their decision in `answered` (the mid-stream card already handled
        // them), so only an undecided action is put on the card.
        if (pending && !pending.answered) {
          pendingApprovalRef.current = pending.id;
          pendingViaRef.current = pending.via === "harness" ? "harness" : undefined;
          setPendingApproval({ id: pending.id, toolName: pending.toolName, summary: pending.summary ?? pending.toolName });
          setPhaseSafe("idle");
          enqueueSpeech(`${pending.toolName} needs your approval before I can do that.`);
          return;
        }
        if (pending && pendingApprovalRef.current === pending.id) {
          // The turn completed with the decision already made (broker timeout
          // or a mid-stream card): the card can no longer be answered.
          pendingApprovalRef.current = null;
          pendingViaRef.current = undefined;
          setPendingApproval(null);
        }

        const tail = reply.slice(spokenUpTo).trim();
        if (tail && !capabilityReply) enqueueSpeech(tail);
        const waitForSpeech = () => {
          if (!activeRef.current) return;
          if (queueRef.current.length || pumpingRef.current) {
            setTimeout(waitForSpeech, 150);
            return;
          }
          resumeListening();
        };
        if (queueRef.current.length || pumpingRef.current) waitForSpeech();
        else resumeListening();
      } catch (caught) {
        setStreamingReply("");
        setStreamingTools([]);
        // Aborted because the person spoke over it: that is not an error.
        if ((caught as { name?: string })?.name === "AbortError") return;
        // A superseded turn failing must not paint over the new turn's screen.
        if (askGenRef.current !== gen) return;
        setError(caught instanceof Error ? caught.message : "Something went wrong.");
        setPhaseSafe("error");
      } finally {
        // Only the current turn may release the in-flight flag: a superseded
        // turn's finally runs after the new turn already took over.
        if (askGenRef.current === gen) inFlightRef.current = false;
        if (streamAbortRef.current === controller) streamAbortRef.current = null;
      }
    },
    [appendTurn, armWatchdog, assistantId, clearWatchdog, enqueueSpeech, listen, onConversation, resumeListening, setPhaseSafe, stopRecognition]
  );
  // The recording round (memoized once) must always launch the LATEST ask:
  // otherwise recorder-initiated turns keep a closure from before the speech
  // voices loaded and lose the picked voice, among other staleness.
  const askRef = useRef(ask);
  askRef.current = ask;

  /**
   * Start listening. Recognition starts synchronously, inside the tap, so Chrome
   * treats it as user-initiated. With server transcription the recorder itself
   * acquires the session's one mic stream (and reports denials), so there is no
   * second probe here. The browser-recognizer path still probes in parallel to
   * explain a denial — and that probe's stream is stopped at once, because a
   * held audio track can starve the recognizer.
   */
  const start = useCallback(() => {
    setError("");
    // A tap is a fresh start: clear the wordless/silent streaks so a retry
    // after an error is judged on its own rounds, never on the ones before it.
    emptyAsrRoundsRef.current = 0;
    silentRoundsRef.current = 0;
    // With server transcription the recording decides when it ends; the watchdog
    // exists for the browser recognizer, which can fail silently.
    if (!asrAvailableRef.current) armWatchdog();
    listen();
    if (asrAvailableRef.current) return;
    void (async () => {
      try {
        const stream = await navigator.mediaDevices?.getUserMedia({ audio: true });
        stream?.getTracks().forEach((track) => track.stop());
      } catch (caught) {
        const name = (caught as DOMException)?.name ?? "";
        if (phaseRef.current === "listening") {
          stopRecognition();
          setError(
            name === "NotAllowedError"
              ? "Tap the mic icon in Chrome's address bar to allow the microphone, then tap the planet to try again."
              : name === "NotFoundError"
                ? "No microphone found — plug one in, then tap the planet to try again."
                : "Could not reach the microphone. Check your system input settings."
          );
          setPhaseSafe("error");
        }
      }
    })();
  }, [armWatchdog, listen, setPhaseSafe, stopRecognition]);

  useEffect(() => {
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      clearWatchdog();
      stopRecognition();
      // Leaving the voice screen ends the mic session: stop its tracks.
      micStreamRef.current?.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Barge-in, the way a conversation works.
   *
   * While it is talking, a second recognizer listens. The instant a voice is
   * heard the speech is paused — you should never have to wait for the bot to
   * finish a sentence it has already lost you on — and whatever you say becomes
   * the next turn. If the "voice" turns out to be the assistant's own output
   * through the speakers, the speech resumes where it left off.
   *
   * Only one recognizer can be live in Chrome, which is safe here: the listening
   * one is stopped before speech begins.
   */
  useEffect(() => {
    if (phase !== "speaking") {
      try {
        bargeRef.current?.stop();
      } catch {
        /* already stopped */
      }
      bargeRef.current = null;
      return;
    }
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = navigator.language?.toLowerCase().startsWith("hi") ? "hi-IN" : SPEECH_LANG;
    recognition.interimResults = true;
    recognition.continuous = true;

    const normalise = (value: string) =>
      value.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

    /** Its own voice, arriving back through the microphone. */
    const soundsLikeItself = (said: string) => {
      const spoken = normalise(spokenRef.current);
      const text = normalise(said);
      if (!text) return true;
      if (spoken.includes(text)) return true;
      const words = text.split(" ").filter(Boolean);
      const said_words = new Set(spoken.split(" ").filter(Boolean));
      const overlap = words.filter((word) => said_words.has(word)).length / Math.max(1, words.length);
      return overlap >= 0.6;
    };

    let finalText = "";
    let lastInterim = "";
    let ducked = false;
    let submitTimer: ReturnType<typeof setTimeout> | null = null;
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;

    const resume = () => {
      if (!ducked) return;
      ducked = false;
      void audioRef.current?.play().catch(() => {});
    };

    const submit = () => {
      if (submitTimer) clearTimeout(submitTimer);
      submitTimer = null;
      const said = (finalText || lastInterim).trim();
      finalText = "";
      lastInterim = "";
      if (!said || soundsLikeItself(said)) {
        // It heard itself: carry on speaking rather than interrupting.
        resume();
        return;
      }
      stopSpeaking();
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
      try {
        streamAbortRef.current?.abort();
      } catch {
        /* nothing in flight */
      }
      inFlightRef.current = false;
      void ask(said, [], true);
    };

    const armSubmit = () => {
      if (submitTimer) clearTimeout(submitTimer);
      submitTimer = setTimeout(submit, 1500);
    };

    recognition.onspeechstart = () => {
      // A voice — pause immediately, decide afterwards whether it was its own.
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
        ducked = true;
        if (resumeTimer) clearTimeout(resumeTimer);
        resumeTimer = setTimeout(resume, 2500);
      }
    };

    recognition.onresult = (event: any) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      if (interim) lastInterim = interim;
      if (resumeTimer) clearTimeout(resumeTimer);
      armSubmit();
    };

    recognition.onerror = () => {
      /* barge-in is opportunistic: never surface its failures */
    };

    bargeRef.current = recognition;
    const timer = setTimeout(() => {
      if (phaseRef.current !== "speaking") return;
      try {
        recognition.start();
      } catch {
        /* ignore */
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      if (submitTimer) clearTimeout(submitTimer);
      if (resumeTimer) clearTimeout(resumeTimer);
      try {
        recognition.stop();
      } catch {
        /* already stopped */
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const decideApproval = useCallback(
    async (approve: boolean) => {
      const actionId = pendingApprovalRef.current;
      if (!actionId) return;
      pendingApprovalRef.current = null;
      const via = pendingViaRef.current;
      pendingViaRef.current = undefined;
      setPendingApproval(null);
      setPhaseSafe("thinking");
      try {
        const endpoint = via === "harness" ? "/api/harness/approve" : "/api/assistant/actions/confirm";
        const body = via === "harness" ? JSON.stringify({ approvalId: actionId, approve }) : JSON.stringify({ actionId, approve });
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        const data = await response.json().catch(() => ({}));
        if (approve && (data.status === "FAILED" || data.error || data.result?.error)) {
          const reason = data.result?.error || data.error || "That action could not be completed.";
          setError(String(reason));
          appendTurn("assistant", `That didn't work: ${reason}`);
        } else if (via !== "harness") {
          // A harness decision is made while its turn is still streaming, and
          // that turn's own reply describes the outcome — no placeholder here.
          appendTurn(
            "assistant",
            approve
              ? `✅ ${data.result?.data?.message ?? data.result?.data?.ticket ?? `${data.toolName ?? "Done"}`}`
              : "↩️ Rejected — nothing was changed."
          );
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Could not confirm that action.");
      } finally {
        // While the harness turn is still streaming, its own completion hands
        // back to listening; only a finished turn needs the handoff here
        // (otherwise two recordings would fight over the mic stream).
        if (!inFlightRef.current) resumeListening();
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [appendTurn, resumeListening, setPhaseSafe]
  );

  const onPlanetTap = () => {
    if (phaseRef.current === "idle") {
      start();
      return;
    }
    if (phaseRef.current === "speaking") {
      // Interrupt, the same as barge-in: stop every sound, supersede the open
      // stream so nothing it still delivers can play, and go back to listening.
      stopSpeaking();
      askGenRef.current += 1;
      try {
        streamAbortRef.current?.abort();
      } catch {
        /* nothing in flight */
      }
      inFlightRef.current = false;
      setStreamingReply("");
      listen();
      return;
    }
    if (phaseRef.current === "listening") {
      clearWatchdog();
      stopRecognition();
      setPhaseSafe("idle");
      return;
    }
    start();
  };

  const submitDraft = (event?: React.FormEvent) => {
    event?.preventDefault();
    const text = draft.trim();
    if (!text || inFlightRef.current) return;
    setDraft("");
    const sent = attachments;
    setAttachments([]);
    void ask(text, sent);
  };

  const uploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    setError("");
    try {
      for (const file of Array.from(files).slice(0, 3)) {
        const form = new FormData();
        form.append("file", file);
        const response = await fetch("/api/assistant/upload", { method: "POST", body: form });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Upload failed");
        setAttachments((current) => [...current, data.attachment]);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not upload the file.");
    } finally {
      setUploading(false);
    }
  };

  const label =
    phase === "listening"
      ? "Listening — speak now"
      : phase === "thinking"
        ? "Thinking…"
        : phase === "speaking"
          ? "Speaking — tap the planet to interrupt"
          : phase === "error"
            ? "Paused — tap the planet to retry"
            : "Tap the planet to talk";

  // The muted status line (mode · shell · root), same info as the chat's strip.
  const statusParts: string[] = [];
  if (botStatus?.mode) statusParts.push(String(botStatus.mode).replace(/_/g, " ").toLowerCase());
  if (botStatus?.shell === true) statusParts.push("shell on");
  else if (botStatus?.shell === false) statusParts.push("shell off");
  if (botStatus && botStatus.root) statusParts.push(botStatus.root);
  else if (botStatus && botStatus.root === null) statusParts.push("no folder set — file work is disabled");
  const statusLine = statusParts.join(" · ");

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* Tiny muted status line (mode · shell · root), left of the floating planet. */}
      {statusLine && (
        <div className="pointer-events-none absolute left-3 top-2 z-20 max-w-[55%]">
          <p
            data-testid="voice-status"
            className="truncate rounded-full bg-[var(--surface)]/70 px-2.5 py-0.5 text-caption text-[var(--muted)] backdrop-blur-sm"
            title={statusLine}
          >
            {statusLine}
          </p>
        </div>
      )}
      {/* The planet floats over the conversation: the chat keeps the full pane
          and simply passes behind the Earth and the Moon. */}
      {/* Centred with left/translate rather than flex: this holds whatever the
          parent's width or display turns out to be. */}
      <div className="pointer-events-none absolute left-1/2 top-2 z-10 flex w-40 -translate-x-1/2 flex-col items-center gap-1">
        <VoiceEarth
          phase={phase as EarthPhase}
          personPulseAt={personPulseAt}
          speakPulseAt={speakPulseAt}
          onTap={onPlanetTap}
          className="pointer-events-auto h-40 w-40 drop-shadow-[0_18px_40px_rgba(30,30,80,0.22)]"
        />
        {phase === "idle" && (
          <p
            data-testid="voice-hint"
            className="rounded-full bg-[var(--surface)]/85 px-3 py-0.5 text-caption text-[var(--muted)] backdrop-blur-sm"
          >
            Tap the planet, then speak. It waits for real silence.
          </p>
        )}
        {phase === "listening" && (
          <div className="flex flex-col items-center gap-1">
            <p className="rounded-full bg-[var(--surface)]/85 px-2 py-0.5 text-caption font-semibold text-[var(--muted)] backdrop-blur-sm">
              {micStatus}
            </p>
            {/* The mic level: quiet until sound arrives, so anyone speaking can
                see they are being heard. */}
            <div
              data-testid="mic-level"
              role="meter"
              aria-label="Microphone level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(micLevel * 100)}
              className="h-[3px] w-28 overflow-hidden rounded-full bg-[var(--border)]/70"
            >
              <div
                data-testid="mic-level-fill"
                data-level={micLevel.toFixed(3)}
                className="h-full rounded-full bg-accent/80 transition-[width] duration-100 ease-linear"
                style={{ width: `${(micLevel * 100).toFixed(1)}%` }}
              />
            </div>
          </div>
        )}
        {/* While it is running, the planet's own motion shows the state; the words
            stay for anyone using a screen reader. */}
        <span className="sr-only" role="status" aria-live="polite">
          {phase === "idle" ? "" : label}
        </span>
      </div>

      {/* The conversation, readable and scrollable. */}
      <div ref={scrollRef} className="soft-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-2 pt-44">
        <div className="mx-auto max-w-3xl space-y-2">
          {turns.map((turn) => (
            <div key={turn.id} className={`flex ${turn.role === "user" ? "justify-end" : "justify-start"}`}>
              {turn.role === "assistant" ? (
                <div className="flex min-w-0 max-w-[85%] flex-col items-start">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-meta leading-relaxed text-[var(--text)]">
                    {plain(turn.text)}
                  </div>
                  {turn.tools && turn.tools.length > 0 && <VoiceToolTimeline tools={turn.tools} />}
                </div>
              ) : (
                <div className="max-w-[85%] rounded-2xl bg-accent px-3 py-2 text-meta leading-relaxed text-white">
                  {turn.text}
                </div>
              )}
            </div>
          ))}

          {streamingReply && (
            <div className="flex justify-start">
              <div className="flex min-w-0 max-w-[85%] flex-col items-start">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-meta leading-relaxed text-[var(--text)]">
                  {plain(streamingReply)}
                  <Loader2 size={11} className="ml-1 inline animate-spin text-[var(--muted)]" />
                </div>
                {streamingTools.length > 0 && <VoiceToolTimeline tools={streamingTools} live />}
              </div>
            </div>
          )}

          {phase === "listening" && heard && (
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-2xl border border-dashed border-accent/40 bg-accent/5 px-3 py-2 text-meta italic text-[var(--muted)]">
                {heard}
              </div>
            </div>
          )}

          {capabilityNotice && (
            <p className="rounded-lg bg-[var(--surface-2)] px-3 py-2 text-meta text-[var(--muted)]">
              {capabilityNotice}
            </p>
          )}

          {error && (
            <p role="alert" className="rounded-lg bg-rose-500/10 px-3 py-2 text-meta text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      </div>

      {pendingApproval && (
        <div className="mx-3 mb-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2">
          <p className="text-caption font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Approval required</p>
          <p className="mt-0.5 text-meta text-[var(--text)]">{pendingApproval.summary}</p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              onClick={() => void decideApproval(true)}
              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-caption font-semibold text-white transition hover:bg-emerald-700"
            >
              Approve & run
            </button>
            <button
              type="button"
              onClick={() => void decideApproval(false)}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)]"
            >
              Reject
            </button>
            <span className="text-caption text-[var(--muted)]">or say &ldquo;approve&rdquo;</span>
          </div>
        </div>
      )}

      {/* Composer: type, attach, mute, end, send. */}
      <form onSubmit={submitDraft} className="shrink-0 border-t border-[var(--border)] px-3 py-2">
        {attachments.length > 0 && (
          <div className="mb-1 flex flex-wrap gap-1">
            {attachments.map((attachment) => (
              <span
                key={attachment.id}
                className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-caption text-[var(--muted)]"
              >
                {attachment.name}
                <button
                  type="button"
                  onClick={() => setAttachments((current) => current.filter((item) => item.id !== attachment.id))}
                  aria-label={`Remove ${attachment.name}`}
                  className="text-[var(--muted)] hover:text-rose-600"
                >
                  <X size={10} />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="mx-auto flex max-w-3xl items-end gap-1.5">
          <textarea
            ref={draftRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submitDraft();
              }
            }}
            rows={1}
            placeholder="Type, or tap the planet to talk…"
            className="soft-scrollbar max-h-32 min-h-[38px] flex-1 resize-none rounded-xl border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-meta outline-none placeholder:text-[var(--muted)] focus:border-accent"
          />

          {availableGenders(voices.map((voice) => ({ name: voice.name, lang: voice.lang }))).length > 1 && (
            <span className="flex shrink-0 items-center gap-1" role="group" aria-label="Voice" title={hostedVoice ? `Hosted ${hostedVoice} voice` : "Using this computer's installed voices"}>
              {(["female", "male"] as VoiceGender[]).map((gender) => (
                <button
                  key={gender}
                  type="button"
                  onClick={() => {
                    setVoiceGender(gender);
                    genderRef.current = gender;
                    try {
                      window.localStorage.setItem("cyraops:voiceGender", gender);
                    } catch {
                      /* storage may be unavailable */
                    }
                  }}
                  aria-pressed={voiceGender === gender}
                  title={`${gender === "female" ? "Female" : "Male"} voice`}
                  className={`h-9 rounded-lg border px-2 text-caption font-semibold transition ${
                    voiceGender === gender
                      ? "border-accent bg-accent/10 text-accent"
                      : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
                  }`}
                >
                  {gender === "female" ? "Female" : "Male"}
                </button>
              ))}
            </span>
          )}

          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void uploadFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="Attach a file"
            title="Attach a file"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            {uploading ? <Loader2 size={15} className="animate-spin" /> : <Paperclip size={15} />}
          </button>

          <button
            type="button"
            onClick={() => setMuted((value) => !value)}
            aria-label={muted ? "Unmute replies" : "Mute replies"}
            title={muted ? "Unmute replies" : "Mute replies"}
            aria-pressed={muted}
            className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border transition ${
              muted
                ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
          </button>

          <button
            type="button"
            onClick={exit}
            aria-label="End voice chat"
            title="End voice chat"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-400"
          >
            <PhoneOff size={15} />
          </button>

          <button
            type="submit"
            disabled={!draft.trim()}
            aria-label="Send"
            title="Send"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-[#5345cc] disabled:opacity-40"
          >
            <CornerDownLeft size={15} />
          </button>
        </div>
      </form>
    </div>
  );
}
