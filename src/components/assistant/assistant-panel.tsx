"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, CornerDownLeft, Mic, MicOff, RefreshCw, Sparkles, Volume2, VolumeX, X } from "lucide-react";

interface AssistantMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: string | null;
  createdAt?: string;
}

interface AssistantPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

export function AssistantPanel({ isOpen, onClose }: AssistantPanelProps) {
  const [assistantId, setAssistantId] = useState<string>("");
  const [assistantName, setAssistantName] = useState<string>("Cyraops Assistant");
  const [messages, setMessages] = useState<AssistantMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const speakRepliesRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [me, history] = await Promise.all([
        fetch("/api/assistant/me").then((r) => r.json()),
        fetch("/api/assistant/messages").then((r) => r.json()),
      ]);
      if (me.assistant) setAssistantId(me.assistant.id);
      if (history.assistantName) setAssistantName(history.assistantName);
      if (Array.isArray(history.messages)) {
        setMessages(
          history.messages.map((message: any) => ({
            id: message.id,
            role: message.role,
            content: message.content,
            toolCalls: message.toolCalls,
            createdAt: message.createdAt,
          }))
        );
      }
    } catch {
      setError("Could not load your assistant. Reload the page and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    speakRepliesRef.current = speakReplies;
  }, [speakReplies]);

  const stopListening = useCallback(() => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // recognition may already be stopped
    }
    recognitionRef.current = null;
    setListening(false);
  }, []);

  const toggleListening = useCallback(() => {
    if (listening) {
      stopListening();
      return;
    }
    const SpeechRecognitionCtor =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      setError("This browser cannot do voice input. Chrome or Safari work best.");
      return;
    }
    setError(null);
    const recognition = new SpeechRecognitionCtor();
    recognition.lang = navigator.language?.toLowerCase().startsWith("hi") ? "hi-IN" : "en-IN";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.onresult = (event: any) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i][0].transcript;
      }
      if (transcript.trim()) setInput(transcript);
    };
    recognition.onerror = () => setListening(false);
    recognition.onend = () => setListening(false);
    recognitionRef.current = recognition;
    try {
      recognition.start();
      setListening(true);
    } catch {
      setListening(false);
      setError("Could not start the microphone. Check browser permissions.");
    }
  }, [listening, stopListening]);

  const speak = useCallback((text: string) => {
    if (!speakRepliesRef.current) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text.slice(0, 1200));
      const isHindi = /[\u0900-\u097F]/.test(text);
      utterance.lang = isHindi ? "hi-IN" : "en-IN";
      const voices = window.speechSynthesis.getVoices();
      const preferred = isHindi
        ? voices.find((voice) => voice.lang?.toLowerCase().startsWith("hi"))
        : voices.find((voice) => voice.lang === "en-IN") || voices.find((voice) => /IN/.test(voice.lang || ""));
      if (preferred) utterance.voice = preferred;
      window.speechSynthesis.speak(utterance);
    } catch {
      // speech synthesis is optional
    }
  }, []);

  useEffect(() => {
    if (isOpen) void load();
  }, [isOpen, load]);

  // Release the microphone and any speech when the panel closes.
  useEffect(() => {
    if (!isOpen) {
      stopListening();
      if (typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
    }
  }, [isOpen, stopListening]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, busy]);

  const send = async () => {
    const content = input.trim();
    if (!content || busy) return;

    setInput("");
    setBusy(true);
    setError(null);
    setMessages((prev) => [
      ...prev,
      { id: `local_${Date.now()}`, role: "user", content },
      { id: `pending_${Date.now()}`, role: "assistant", content: "" },
    ]);

    try {
      const response = await fetch("/api/assistant/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantId: assistantId || undefined, content }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "The assistant failed to reply.");

      setAssistantId((current) => current || "");
      setMessages((prev) => {
        const withoutPending = prev.filter((message) => !message.id.startsWith("pending_"));
        return [
          ...withoutPending,
          {
            id: `reply_${Date.now()}`,
            role: "assistant",
            content: data.reply,
            toolCalls: Array.isArray(data.toolCallsUsed) ? JSON.stringify(data.toolCallsUsed) : null,
          },
        ];
      });
      speak(data.reply || "");
    } catch (err: any) {
      setMessages((prev) => prev.filter((message) => !message.id.startsWith("pending_")));
      setError(err?.message || "The assistant failed to reply.");
    } finally {
      setBusy(false);
    }
  };

  if (!isOpen) return null;

  const toolChips = (toolCalls: string | null | undefined): string[] => {
    if (!toolCalls) return [];
    try {
      const parsed = JSON.parse(toolCalls);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(430px,calc(100vw-2rem))] flex-col">
      <div className="flex h-[min(620px,calc(100vh-6rem))] w-full flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e9f5ff] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              <Bot size={16} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">{assistantName}</h3>
              <p className="text-[10px] text-[var(--muted)]">Your personal assistant — remembers what you tell it</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label="Close assistant"
          >
            <X size={16} />
          </button>
        </div>

        {/* Messages */}
        <div ref={scrollRef} className="soft-scrollbar flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <div className="flex h-full items-center justify-center text-xs text-[var(--muted)]">Loading…</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#f0efff] text-accent">
                <Sparkles size={20} />
              </span>
              <p className="text-xs font-semibold text-[var(--text)]">This is your assistant</p>
              <p className="max-w-[260px] text-[11px] leading-relaxed text-[var(--muted)]">
                Ask it about your CRM, or tell it about yourself — it remembers across conversations.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-2 ${message.role === "user" ? "flex-row-reverse" : ""}`}>
                  {message.role === "assistant" && (
                    <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#e9f5ff] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
                      <Bot size={14} />
                    </span>
                  )}
                  <div className={`max-w-[80%] ${message.role === "user" ? "text-right" : ""}`}>
                    <div
                      className={`inline-block whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-5 ${
                        message.role === "user"
                          ? "rounded-tr-sm bg-accent text-white"
                          : "rounded-tl-sm bg-[var(--hover)] text-[var(--text)]"
                      }`}
                    >
                      {message.role === "assistant" && !message.content && busy ? (
                        <span className="flex items-center gap-1.5 text-[var(--muted)]">
                          <RefreshCw size={12} className="animate-spin" /> thinking…
                        </span>
                      ) : (
                        message.content
                      )}
                    </div>
                    {message.role === "assistant" && toolChips(message.toolCalls).length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {toolChips(message.toolCalls).map((tool) => (
                          <span
                            key={tool}
                            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-[10px] text-[var(--muted)]"
                          >
                            {tool}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="border-t border-rose-500/20 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-600 dark:text-rose-400">
            {error}
          </div>
        )}

        {/* Composer */}
        <div className="border-t border-[var(--border)] p-3">
          <div className="flex items-end gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-1.5 focus-within:border-[#aaa3e7]">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              placeholder={`Message ${assistantName}…`}
              rows={1}
              maxLength={5000}
              className="max-h-28 min-h-9 flex-1 resize-y bg-transparent px-2 py-1.5 text-[13px] outline-none placeholder:text-[var(--muted)]"
            />
            <button
              type="button"
              onClick={toggleListening}
              title={listening ? "Stop dictating" : "Dictate with your voice"}
              aria-label={listening ? "Stop dictating" : "Dictate with your voice"}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition ${
                listening ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              }`}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
            <button
              type="button"
              onClick={() => {
                setSpeakReplies((current) => {
                  const next = !current;
                  speakRepliesRef.current = next;
                  if (!next && typeof window !== "undefined" && window.speechSynthesis) window.speechSynthesis.cancel();
                  return next;
                });
              }}
              title={speakReplies ? "Stop speaking replies" : "Speak replies aloud"}
              aria-label={speakReplies ? "Stop speaking replies" : "Speak replies aloud"}
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] transition ${
                speakReplies ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              }`}
            >
              {speakReplies ? <Volume2 size={15} /> : <VolumeX size={15} />}
            </button>
            <button
              onClick={() => void send()}
              disabled={!input.trim() || busy}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-[#5345cc] disabled:opacity-40"
              aria-label="Send"
            >
              <CornerDownLeft size={15} />
            </button>
          </div>
          <p className="mt-1.5 px-1 text-[10px] text-[var(--muted)]">Enter to send · Shift + Enter for a new line · mic to dictate</p>
        </div>
      </div>
    </div>
  );
}
