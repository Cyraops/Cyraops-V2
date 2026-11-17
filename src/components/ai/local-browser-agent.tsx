"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Monitor, MonitorOff } from "lucide-react";

/**
 * Runs the assistant's browser actions in this person's own browser.
 *
 * When enabled, this polls for an action, hands it to the Cyraops extension
 * through window.postMessage, and reports the result back. Everything is opt-in:
 * with the toggle off nothing is polled and nothing is executed.
 */
export function LocalBrowserAgent() {
  const [enabled, setEnabled] = useState(false);
  const [extensionReady, setExtensionReady] = useState(false);
  const [lastAction, setLastAction] = useState<string | null>(null);
  const enabledRef = useRef(false);
  const pendingRef = useRef(new Map<string, (result: any) => void>());

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  // Remember the choice; a browser agent that turns itself on is not on.
  useEffect(() => {
    try {
      setEnabled(window.localStorage.getItem("cyraops:useMyBrowser") === "1");
    } catch {
      /* storage may be unavailable */
    }
  }, []);

  // The extension announces itself when the page loads.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data;
      if (data?.source !== "cyraops-extension") return;
      if (data.type === "local-browser:ready") setExtensionReady(true);
      if (data.type === "local-browser:result") {
        const resolve = pendingRef.current.get(data.id);
        if (resolve) {
          pendingRef.current.delete(data.id);
          resolve(data);
        }
      }
    };
    window.addEventListener("message", onMessage);
    // Ask the extension to introduce itself, in case it announced before we mounted.
    window.postMessage({ source: "cyraops-page", type: "local-browser:ping" }, window.location.origin);
    const retry = setInterval(() => {
      window.postMessage({ source: "cyraops-page", type: "local-browser:ping" }, window.location.origin);
    }, 3000);
    return () => {
      clearInterval(retry);
      window.removeEventListener("message", onMessage);
    };
  }, []);

  const runInExtension = useCallback((action: any) =>
    new Promise<any>((resolve) => {
      pendingRef.current.set(action.id, resolve);
      window.postMessage({ source: "cyraops-page", type: "local-browser:run", ...action }, window.location.origin);
      setTimeout(() => {
        if (pendingRef.current.has(action.id)) {
          pendingRef.current.delete(action.id);
          resolve({ ok: false, error: "The extension did not respond." });
        }
      }, 25000);
    }), []);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;

    const loop = async () => {
      while (!stopped && enabledRef.current) {
        try {
          const response = await fetch("/api/computer/local", { cache: "no-store" });
          if (!response.ok) {
            await new Promise((resolve) => setTimeout(resolve, 3000));
            continue;
          }
          const data = await response.json();
          const action = data?.action;
          if (!action) {
            await new Promise((resolve) => setTimeout(resolve, 700));
            continue;
          }
          setLastAction(`${action.action}${action.url ? ` ${action.url}` : ""}`);
          const result = await runInExtension(action);
          await fetch("/api/computer/local", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: action.id, ok: result.ok, data: result.data, error: result.error }),
          });
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    };

    void loop();
    return () => {
      stopped = true;
    };
  }, [enabled, runInExtension]);

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    try {
      window.localStorage.setItem("cyraops:useMyBrowser", next ? "1" : "0");
    } catch {
      /* storage may be unavailable */
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] px-2 py-1.5">
      <button
        onClick={toggle}
        aria-pressed={enabled}
        className={`flex w-full items-center gap-1.5 text-left text-caption font-semibold transition ${
          enabled ? "text-emerald-700 dark:text-emerald-400" : "text-[var(--muted)] hover:text-[var(--text)]"
        }`}
      >
        {enabled ? <Monitor size={11} /> : <MonitorOff size={11} />}
        <span className="flex-1">{enabled ? "Using my browser" : "Use my browser"}</span>
        <span className={`h-1.5 w-1.5 rounded-full ${enabled && extensionReady ? "bg-emerald-500" : "bg-[var(--muted)]"}`} />
      </button>
      <p className="mt-0.5 text-[10px] leading-snug text-[var(--muted)]">
        {enabled
          ? extensionReady
            ? lastAction
              ? `Ran: ${lastAction}`
              : "Ready — the assistant will use a tab in this browser."
            : "Waiting for the Cyraops extension. Load it from browser-extension/."
          : "Runs the assistant's browsing here instead of a server."}
      </p>
    </div>
  );
}
