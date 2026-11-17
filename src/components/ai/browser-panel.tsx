"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MousePointerClick, RefreshCw, RotateCcw, X } from "lucide-react";

interface Frame {
  configured: boolean;
  error?: string;
  image?: string;
  url?: string;
  title?: string;
  width?: number;
  height?: number;
}

/**
 * Live view of the browser the assistant is driving, plus human takeover:
 * clicking or typing here acts on the same session, so you can step in
 * mid-task and hand it back.
 */
export function BrowserPanel({ onClose, embedded = false }: { onClose?: () => void; embedded?: boolean }) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [paused, setPaused] = useState(false);
  const [takeover, setTakeover] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const imageRef = useRef<HTMLImageElement>(null);
  const keyboardRef = useRef<HTMLInputElement>(null);

  const poll = useCallback(async () => {
    try {
      const response = await fetch("/api/computer/frame", { cache: "no-store" });
      const data: Frame = await response.json();
      setFrame(data);
      if (data.error) setError(data.error);
      else setError("");
    } catch {
      setError("Lost contact with the browser");
    }
  }, []);

  useEffect(() => {
    void poll();
  }, [poll]);

  useEffect(() => {
    // Keep polling through transient errors with a longer interval: stopping
    // on the first error used to freeze the view until a manual refresh.
    if (paused || frame?.configured === false) return;
    const interval = frame?.error ? 4000 : 1200;
    const timer = setInterval(() => void poll(), interval);
    return () => clearInterval(timer);
  }, [paused, poll, frame?.error, frame?.configured]);

  const send = useCallback(async (body: Record<string, unknown>) => {
    setPending(true);
    try {
      const response = await fetch("/api/computer/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error ?? "That action failed");
      } else {
        setError("");
        setTimeout(() => void poll(), 350);
      }
    } catch {
      setError("That action could not be sent");
    } finally {
      setPending(false);
    }
  }, [poll]);

  const clickAt = (event: React.MouseEvent<HTMLImageElement>) => {
    if (!takeover || !frame?.width || !frame?.height || !imageRef.current) return;
    const rect = imageRef.current.getBoundingClientRect();
    const x = Math.round(((event.clientX - rect.left) / rect.width) * frame.width);
    const y = Math.round(((event.clientY - rect.top) / rect.height) * frame.height);
    void send({ type: "click", x, y });
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    // Send every key straight through; the input is only a focus target.
    const named = ["Enter", "Tab", "Backspace", "Escape", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Delete"];
    if (named.includes(event.key) || event.key.length === 1) {
      event.preventDefault();
      void send({ type: "key", text: event.key });
    }
  };

  return (
    <aside
      className={
        embedded
          ? "flex w-full shrink-0 flex-col overflow-hidden bg-[var(--surface)]"
          : "absolute inset-y-0 right-0 z-30 flex w-full max-w-[620px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      }
    >
      <header className={`flex shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] ${embedded ? "h-9 px-2" : "h-[52px] px-3"}`}>
        {embedded ? (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-[#e9f5ff] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              <MousePointerClick size={11} />
            </span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${frame?.image ? "bg-emerald-500" : "bg-[var(--muted)]"}`} />
          </span>
        ) : (
          <span className="flex min-w-0 items-center gap-2">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#e9f5ff] text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">
              <MousePointerClick size={13} />
            </span>
            <span className="min-w-0">
              <b className="block truncate text-xs text-[var(--text)]">{frame?.title || "Live browser"}</b>
              <span className="block max-w-[240px] truncate text-caption text-[var(--muted)]">
                {frame?.url || "Waiting for the assistant to open something…"}
              </span>
            </span>
          </span>
        )}
        <span className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setTakeover((value) => !value)}
            className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-caption font-semibold transition ${
              takeover
                ? "border-accent bg-accent text-white"
                : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
            }`}
            title="Take control of the browser"
          >
            <MousePointerClick size={11} />
            {embedded ? (takeover ? "In control" : "Control") : takeover ? "In control" : "Take over"}
          </button>
          <button
            onClick={() => void send({ type: "back" })}
            disabled={pending}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            title="Back"
          >
            <RotateCcw size={12} />
          </button>
          <button
            onClick={() => void poll()}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            title="Refresh frame"
          >
            <RefreshCw size={12} />
          </button>
          {!embedded && (
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              aria-label="Close browser"
            >
              <X size={14} />
            </button>
          )}
        </span>
      </header>

      <div
        className={
          embedded
            ? "soft-scrollbar relative w-full overflow-hidden bg-[var(--surface-2)]"
            : "soft-scrollbar relative min-h-0 flex-1 overflow-auto bg-[var(--surface-2)] p-2"
        }
        style={embedded ? { aspectRatio: "16 / 10" } : undefined}
      >
        {frame?.image ? (
          // eslint-disable-next-line @next/next/no-img-element -- live frame, not an optimizable asset
          <img
            ref={imageRef}
            src={frame.image}
            alt="Live browser view"
            onClick={clickAt}
            draggable={false}
            className={`w-full rounded-lg border border-[var(--border)] bg-white ${takeover ? "cursor-crosshair" : "cursor-default"}`}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            {frame?.configured === false || frame?.error ? (
              <p className="max-w-[320px] text-meta text-[var(--muted)]">{frame?.error ?? "The browser is not available."}</p>
            ) : (
              <>
                <Loader2 size={16} className="animate-spin text-[var(--muted)]" />
                <p className="text-meta text-[var(--muted)]">Connecting to the assistant&apos;s browser…</p>
              </>
            )}
          </div>
        )}
        {pending && (
          <span className="pointer-events-none absolute right-3 top-3 flex items-center gap-1 rounded-full bg-black/60 px-2 py-1 text-caption text-white">
            <Loader2 size={10} className="animate-spin" /> sending
          </span>
        )}
      </div>

      <div className="shrink-0 border-t border-[var(--border)] px-3 py-2">
        {error && !embedded && <p className="mb-1 text-caption text-rose-600 dark:text-rose-400">{error}</p>}
        <input
          ref={keyboardRef}
          onKeyDown={onKeyDown}
          disabled={!takeover}
          placeholder={takeover ? "Type to drive the page — Enter, Tab and arrows work" : "Take over to type"}
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-meta outline-none placeholder:text-[var(--muted)] disabled:opacity-60"
        />
        <div className={`mt-1 flex items-center justify-between text-caption text-[var(--muted)] ${embedded ? "gap-1" : ""}`}>
          {!embedded && (
            <span>
              {takeover ? "You have control — the assistant sees the same page." : "Read-only view of what the assistant is doing."}
            </span>
          )}
          <button onClick={() => setPaused((value) => !value)} className="shrink-0 font-semibold text-accent">
            {paused ? "Resume live" : "Pause"}
          </button>
        </div>
      </div>
    </aside>
  );
}
