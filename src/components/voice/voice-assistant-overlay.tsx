"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  X,
  RefreshCw,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  Send,
  CornerDownLeft,
  ChevronDown,
  Globe,
  Settings as SettingsIcon,
  StopCircle,
} from "lucide-react";
import { Cyraops3DLogo, VoiceLogoState } from "./cyraops-3d-logo";
import { PendingAction } from "@/lib/ai/voice/crm-tools";
import { SpeechAdapterService } from "@/lib/ai/voice/speech-adapters";
import { useRouter } from "next/navigation";

interface VoiceMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  tools?: any[];
  timestamp: Date;
}

interface VoiceAssistantOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  /** Current route, so the assistant knows which page the user is looking at. */
  pathname?: string;
  onStateChange?: (state: VoiceLogoState, amplitude: number) => void;
}

export function VoiceAssistantOverlay({
  isOpen,
  onClose,
  pathname,
  onStateChange,
}: VoiceAssistantOverlayProps) {
  const router = useRouter();
  const [minimized, setMinimized] = useState<boolean>(false);
  // Voice engine states
  const [voiceState, setVoiceState] = useState<VoiceLogoState>("IDLE");
  const [amplitude, setAmplitude] = useState<number>(0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [language, setLanguage] = useState<string>("auto");
  const [activeModel, setActiveModel] = useState<string>("deepseek-flash");
  const [voiceAiConfig, setVoiceAiConfig] = useState<"checking" | "ready" | "missing" | "error">("checking");

  // Conversation history
  const [messages, setMessages] = useState<VoiceMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content: "Namaste! Main aapka Cyraops Voice Assistant hoon. Aap Hindi ya English mein baat kar sakte hain. How can I help you today?",
      timestamp: new Date(),
    },
  ]);
  const [currentTranscript, setCurrentTranscript] = useState<string>("");
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionProcessing, setActionProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Audio Context & Recognition refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const voiceStateRef = useRef<VoiceLogoState>("IDLE");

  isMutedRef.current = isMuted;
  voiceStateRef.current = voiceState;

  // Sync state to parent nav button
  useEffect(() => {
    onStateChange?.(voiceState, amplitude);
  }, [voiceState, amplitude, onStateChange]);

  // Fetch voice settings on mount
  useEffect(() => {
    fetch("/api/voice/settings")
      .then(async (r) => {
        const data = await r.json();
        if (!r.ok || data.success !== true) {
          setVoiceAiConfig("error");
          return;
        }
        if (data.activeModel) setActiveModel(data.activeModel);
        setVoiceAiConfig(data.isConfigured ? "ready" : "missing");
      })
      .catch(() => setVoiceAiConfig("error"));
  }, []);

  // 1. Text-to-Speech Output Function
  const speakResponse = useCallback(
    (text: string) => {
      if (typeof window === "undefined" || !window.speechSynthesis) return;

      // Cancel any prior speech
      window.speechSynthesis.cancel();

      // Clean markdown symbols for natural speech
      const cleanText = text
        .replace(/\*\*(.*?)\*\*/g, "$1")
        .replace(/\*(.*?)\*/g, "$1")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/#+\s/g, "")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
        .trim();

      if (!cleanText) return;

      const utterance = new SpeechSynthesisUtterance(cleanText);
      utterance.rate = 1.0;
      utterance.pitch = 1.0;

      // Choose suitable Indian accent / Hindi voice if available
      const voices = window.speechSynthesis.getVoices();
      const hasDevanagari = /[\u0900-\u097F]/.test(cleanText);
      const isHindi = hasDevanagari || language === "hi-IN";

      if (isHindi) {
        const hindiVoice = voices.find((v) => v.lang.startsWith("hi") || v.name.includes("Hindi"));
        if (hindiVoice) utterance.voice = hindiVoice;
        utterance.lang = "hi-IN";
      } else {
        const indianEngVoice = voices.find((v) => v.lang === "en-IN" || v.name.includes("India"));
        if (indianEngVoice) utterance.voice = indianEngVoice;
        utterance.lang = "en-IN";
      }

      utterance.onstart = () => {
        isSpeakingRef.current = true;
        setVoiceState("ASSISTANT_SPEAKING");

        // Simulate reactive audio amplitude for TTS
        let ttsAmpInterval = setInterval(() => {
          if (!isSpeakingRef.current) {
            clearInterval(ttsAmpInterval);
            return;
          }
          const randomAmp = 0.3 + Math.random() * 0.5;
          setAmplitude(randomAmp);
        }, 100);
      };

      utterance.onend = () => {
        isSpeakingRef.current = false;
        setAmplitude(0);
        setVoiceState("LISTENING");
        // Resume listening if recognition stopped
        try {
          recognitionRef.current?.start();
        } catch {}
      };

      utterance.onerror = () => {
        isSpeakingRef.current = false;
        setAmplitude(0);
        setVoiceState("LISTENING");
      };

      window.speechSynthesis.speak(utterance);
    },
    [language]
  );

  // 2. Send transcript to DeepSeek Voice Chat API
  const sendToDeepSeek = useCallback(
    async (userText: string) => {
      if (!userText.trim()) return;

      setVoiceState("THINKING");
      setCurrentTranscript("");
      setErrorMsg(null);

      const userMessage: VoiceMessage = {
        id: `user_${Date.now()}`,
        role: "user",
        content: userText,
        timestamp: new Date(),
      };

      const updatedHistory = [...messages, userMessage];
      setMessages(updatedHistory);

      try {
        const response = await fetch("/api/voice/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: updatedHistory.map((m) => ({ role: m.role, content: m.content })),
            language,
            pageContext: {
              pathname: pathname || (typeof window !== "undefined" ? window.location.pathname : ""),
              query: typeof window !== "undefined" ? window.location.search : "",
            },
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data.error || "Failed to reach DeepSeek Voice Service.");
        }

        const assistantMsg: VoiceMessage = {
          id: `asst_${Date.now()}`,
          role: "assistant",
          content: data.response || "I have completed your request.",
          tools: data.toolExecutions,
          timestamp: new Date(),
        };

        setMessages((prev) => [...prev, assistantMsg]);

        if (data.requiresConfirmation && data.pendingAction) {
          setPendingAction(data.pendingAction);
        }

        // The assistant can move the user around the CRM. The page is already
        // docked beside it, so navigation never closes the conversation.
        if (typeof data.navigateTo === "string" && data.navigateTo.startsWith("/")) {
          router.push(data.navigateTo);
        }

        // Speak the assistant's reply
        speakResponse(assistantMsg.content);
      } catch (err: any) {
        setErrorMsg(err.message);
        setVoiceState("IDLE");
      }
    },
    [messages, language, speakResponse]
  );

  // 3. User barge-in / Interruption
  const handleUserInterruption = useCallback(() => {
    if (isSpeakingRef.current) {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
      isSpeakingRef.current = false;
      setVoiceState("INTERRUPTED");
      setTimeout(() => {
        setVoiceState("LISTENING");
      }, 300);
    }
  }, []);

  // 4. Start Microphone and Audio Analyser
  const startAudioEngine = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      stream.getAudioTracks().forEach((track) => {
        track.enabled = !isMutedRef.current;
      });
      micStreamRef.current = stream;

      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioContext;

      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      const checkAudioLevel = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteFrequencyData(dataArray);

        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        const normalizedAmp = Math.min(average / 128, 1.0);

        if (!isMutedRef.current && !isSpeakingRef.current) {
          setAmplitude(normalizedAmp);

          // Barge-in check: If speech detected while speaking, interrupt
          if (normalizedAmp > 0.12 && isSpeakingRef.current) {
            handleUserInterruption();
          }

          // State transition based on voice energy
          if (normalizedAmp > 0.08) {
            if (voiceStateRef.current === "LISTENING") {
              setVoiceState("USER_SPEAKING");
            }
          }
        }

        animationFrameRef.current = requestAnimationFrame(checkAudioLevel);
      };

      checkAudioLevel();
    } catch (err: any) {
      setErrorMsg("Microphone access denied or unsupported. Please allow microphone permissions.");
      setVoiceState("IDLE");
    }
  }, [handleUserInterruption]);

  // 5. Setup Continuous Speech Recognition
  const startRecognition = useCallback(() => {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setErrorMsg("Web Speech API is not supported in this browser. Please use Chrome, Edge, or Safari.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = SpeechAdapterService.normalizeLanguage(
      language,
      navigator.languages?.length ? navigator.languages : [navigator.language]
    );

    recognition.onresult = (event: any) => {
      if (isMutedRef.current) return;

      // Handle barge-in immediately
      if (isSpeakingRef.current) {
        handleUserInterruption();
      }

      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          final += transcript;
        } else {
          interim += transcript;
        }
      }

      if (interim) {
        setCurrentTranscript(interim);
        setVoiceState("USER_SPEAKING");

        // Reset silence timer
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      }

      if (final) {
        setCurrentTranscript(final);
        setVoiceState("TRANSCRIBING" as any);

        // VAD pause detection before dispatching to DeepSeek
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = setTimeout(() => {
          sendToDeepSeek(final);
        }, 1100);
      }
    };

    recognition.onerror = (event: any) => {
      if (event.error !== "no-speech") {
        // Soft recovery
      }
    };

    recognition.onend = () => {
      // Auto-restart if session is open and not speaking
      if (isOpen && !isSpeakingRef.current && !isMutedRef.current) {
        try {
          recognition.start();
        } catch {}
      }
    };

    try {
      recognition.start();
      recognitionRef.current = recognition;
      setVoiceState("LISTENING");
    } catch {}
  }, [isOpen, language, sendToDeepSeek, handleUserInterruption]);

  // 6. Stop and Clean Audio Engine
  const stopAudioEngine = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
      recognitionRef.current = null;
    }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isSpeakingRef.current = false;
    setVoiceState("ENDED");
    setTimeout(() => setVoiceState("IDLE"), 200);
    setAmplitude(0);
    setCurrentTranscript("");
  }, []);

  // Open/Close Lifecycle
  useEffect(() => {
    if (isOpen) {
      if (voiceAiConfig !== "ready") {
        setVoiceState("IDLE");
        setErrorMsg(
          voiceAiConfig === "missing"
            ? "Voice AI is not configured yet. An Owner or Admin must add the server-side DEEPSEEK_API_KEY. The microphone will stay off."
            : voiceAiConfig === "error"
              ? "Voice AI setup could not be checked. Reload the page and try again. The microphone will stay off."
              : "Checking Voice AI setup. The microphone will stay off until it is ready."
        );
        return;
      }
      setErrorMsg(null);
      startAudioEngine();
      if (!isMutedRef.current) startRecognition();
      return () => stopAudioEngine();
    } else {
      stopAudioEngine();
    }
  }, [isOpen, voiceAiConfig, startAudioEngine, startRecognition, stopAudioEngine]);

  // Toggle Mute
  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    isMutedRef.current = nextMuted;
    micStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setIsMuted(nextMuted);
    if (nextMuted) {
      setVoiceState("MUTED");
      try {
        recognitionRef.current?.stop();
      } catch {}
    } else {
      setVoiceState("LISTENING");
      try {
        recognitionRef.current?.start();
      } catch {}
    }
  };

  // Confirm or Cancel Pending Action
  const handleConfirmAction = async (confirmed: boolean) => {
    if (!pendingAction) return;
    setActionProcessing(true);
    try {
      const res = await fetch("/api/voice/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: pendingAction.id, confirmed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Confirmation failed.");

      const resultText = confirmed
        ? `Action confirmed: ${data.result?.message || "Execution successful."}`
        : "Action was cancelled.";

      const confirmMsg: VoiceMessage = {
        id: `conf_${Date.now()}`,
        role: "assistant",
        content: resultText,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, confirmMsg]);
      setPendingAction(null);
      speakResponse(resultText);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setActionProcessing(false);
    }
  };

  // Keyboard Escape handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  // Minimized: a slim docked bar that keeps the microphone session alive so the
  // assistant continues to run while the user works elsewhere.
  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-2xl border border-emerald-500/40 bg-[var(--surface)] px-2.5 py-2 shadow-2xl">
        <button
          type="button"
          onClick={() => setMinimized(false)}
          className="flex items-center gap-2 rounded-xl px-1 text-[11px] font-semibold text-[var(--text)] transition hover:bg-[var(--hover)]"
          aria-label="Expand voice assistant"
        >
          <span className="flex h-7 w-7 items-center justify-center overflow-hidden">
            <Cyraops3DLogo size="sm" state={voiceState} amplitude={amplitude} />
          </span>
          {voiceState === "USER_SPEAKING" || voiceState === "ASSISTANT_SPEAKING" ? "Listening…" : "Voice"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          aria-label="Close voice assistant"
        >
          <X size={15} />
        </button>
      </div>
    );
  }

  return (
    /* Docked panel, not a modal: the page underneath stays visible and usable. */
    <div
      className="fixed bottom-4 right-4 z-50 flex w-[min(440px,calc(100vw-2rem))] flex-col"
      role="dialog"
      aria-label="Cyraops AI Voice Assistant"
    >
      <div className="relative flex h-[min(660px,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-3">
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
            <h2 className="font-display text-base font-bold tracking-tight">Cyraops Voice Assistant</h2>
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
              {activeModel.includes("pro") ? "DeepSeek V4 Pro" : "DeepSeek V4 Flash"}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Language Switcher */}
            <div className="flex items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-xs">
              <Globe size={13} className="text-[var(--muted)]" />
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="bg-transparent text-[11px] font-medium outline-none"
              >
                <option value="auto">Auto (browser language)</option>
                <option value="hi-IN">Hindi (हिन्दी)</option>
                <option value="en-IN">Indian English</option>
                <option value="en-US">English (US)</option>
              </select>
            </div>

            {/* Minimize: keeps the session running in the docked bar */}
            <button
              onClick={() => setMinimized(true)}
              className="rounded-xl p-1.5 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              aria-label="Minimize voice assistant"
              title="Minimize"
            >
              <ChevronDown size={18} />
            </button>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="rounded-xl p-1.5 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              aria-label="Close voice assistant"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Central 3D Logo Sculpture Area */}
        <div className="relative flex flex-col items-center justify-center border-b border-[var(--border)] bg-gradient-to-b from-emerald-500/[0.04] to-transparent py-4">
          {/* Audio Visualizer Ring Waveform */}
          <div
            className="absolute h-56 w-56 rounded-full border border-emerald-400/20 transition-all duration-300"
            style={{
              transform: `scale(${1 + amplitude * 0.4})`,
              opacity: voiceState === "USER_SPEAKING" || voiceState === "ASSISTANT_SPEAKING" ? 0.7 : 0.2,
              boxShadow: `0 0 ${20 + amplitude * 40}px rgba(110, 231, 145, ${0.15 + amplitude * 0.3})`,
            }}
          />

          {/* Genuine 3D Cyraops Logo */}
          <div className="relative z-10">
            <Cyraops3DLogo
              size="lg"
              state={voiceState}
              amplitude={amplitude}
              interactive={true}
            />
          </div>

          {/* Status Badge */}
          <div className="mt-3 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--surface)] px-4 py-1.5 shadow-sm">
            {voiceAiConfig === "checking" && (
              <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">Checking Voice AI setup...</span>
            )}
            {voiceAiConfig === "missing" && (
              <span className="text-xs font-semibold text-amber-600 dark:text-amber-400">Voice AI setup required</span>
            )}
            {voiceAiConfig === "error" && (
              <span className="text-xs font-semibold text-rose-600 dark:text-rose-400">Voice AI setup unavailable</span>
            )}
            {voiceAiConfig === "ready" && voiceState === "LISTENING" && (
              <>
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Listening... (Aap bol sakte hain)
                </span>
              </>
            )}
            {voiceAiConfig === "ready" && voiceState === "USER_SPEAKING" && (
              <>
                <Mic size={13} className="text-emerald-500 animate-bounce" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Listening to your voice...
                </span>
              </>
            )}
            {voiceAiConfig === "ready" && voiceState === "THINKING" && (
              <>
                <RefreshCw size={13} className="animate-spin text-blue-500" />
                <span className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  DeepSeek Flash reasoning...
                </span>
              </>
            )}
            {voiceAiConfig === "ready" && voiceState === "ASSISTANT_SPEAKING" && (
              <>
                <Volume2 size={13} className="text-emerald-500 animate-pulse" />
                <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                  Cyraops is speaking...
                </span>
              </>
            )}
            {voiceAiConfig === "ready" && voiceState === "INTERRUPTED" && (
              <span className="text-xs font-semibold text-amber-500">Interrupted — Listening</span>
            )}
            {voiceAiConfig === "ready" && voiceState === "MUTED" && (
              <span className="text-xs font-semibold text-neutral-400">Microphone Muted</span>
            )}
            {voiceAiConfig === "ready" && voiceState === "IDLE" && (
              <span className="text-xs font-semibold text-[var(--muted)]">Ready</span>
            )}
          </div>
        </div>

        {/* Conversation Transcript & Action Area */}
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          {errorMsg && (
            <div className="flex items-center gap-3 rounded-xl border border-rose-500/20 bg-rose-500/10 p-3.5 text-xs text-rose-600 dark:text-rose-400">
              <AlertTriangle size={16} className="shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Pending High-Impact Action Confirmation Card */}
          {pendingAction && (
            <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-4 shadow-sm dark:bg-amber-950/20">
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-amber-500/20 p-2 text-amber-600 dark:text-amber-400">
                  <AlertTriangle size={18} />
                </div>
                <div className="flex-1">
                  <h4 className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                    High-Impact Action Confirmation Required
                  </h4>
                  <p className="mt-1 max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg border border-[var(--border)] bg-[var(--surface)] p-2.5 text-xs font-medium text-[var(--text)]">{pendingAction.summary}</p>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Action ID: <code className="font-mono">{pendingAction.id}</code> (Expires in 5 mins)
                  </p>

                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => handleConfirmAction(true)}
                      disabled={actionProcessing}
                      className="rounded-lg bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white shadow transition hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {actionProcessing ? "Executing..." : "Confirm & Execute"}
                    </button>
                    <button
                      onClick={() => handleConfirmAction(false)}
                      disabled={actionProcessing}
                      className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3.5 py-1.5 text-xs font-semibold transition hover:bg-[var(--hover)]"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Messages */}
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
            >
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  m.role === "user"
                    ? "bg-accent text-white"
                    : "border border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]"
                }`}
              >
                <p>{m.content}</p>

                {/* Tool Executions Info */}
                {m.tools && m.tools.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-t border-[var(--border)]/60 pt-2">
                    {m.tools.map((t: any) => (
                      <div
                        key={t.id}
                        className="flex items-center gap-2 rounded-md bg-black/5 px-2 py-1 text-[11px] font-mono dark:bg-white/5"
                      >
                        <CheckCircle2 size={12} className="text-emerald-500" />
                        <span className="font-semibold">{t.name}</span>
                        <span className="truncate text-[var(--muted)]">
                          {t.result?.message || "Executed"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <span className="mt-1 px-1 text-[10px] text-[var(--muted)]">
                {m.timestamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}

          {/* Live speech interim transcript */}
          {currentTranscript && (
            <div className="flex flex-col items-end">
              <div className="max-w-[85%] rounded-2xl border border-dashed border-emerald-500/50 bg-emerald-500/5 px-4 py-2.5 text-sm italic text-emerald-700 dark:text-emerald-300">
                "{currentTranscript}"
              </div>
            </div>
          )}
        </div>

        {/* Bottom Interactive Toolbar */}
        <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--surface-2)]/60 px-6 py-3.5 backdrop-blur-sm">
          <div className="flex items-center gap-2">
            {/* Mute Toggle */}
            <button
              onClick={handleToggleMute}
              className={`flex h-10 w-10 items-center justify-center rounded-xl border transition ${
                isMuted
                  ? "border-rose-500/30 bg-rose-50 text-rose-600 dark:bg-rose-950/40"
                  : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)] hover:bg-[var(--hover)]"
              }`}
              title={isMuted ? "Unmute Microphone" : "Mute Microphone"}
            >
              {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            {/* Stop Speaking / Interruption button */}
            {isSpeakingRef.current && (
              <button
                onClick={handleUserInterruption}
                className="flex items-center gap-1.5 rounded-xl border border-amber-500/30 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 transition hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <StopCircle size={15} />
                <span>Stop Speaking</span>
              </button>
            )}
          </div>

          {/* End Session Button */}
          <button
            onClick={onClose}
            className="flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700"
          >
            <span>End Session</span>
          </button>
        </div>
      </div>
    </div>
  );
}

