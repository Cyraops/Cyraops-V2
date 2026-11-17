/**
 * Running browser actions in the user's own browser.
 *
 * A server-side browser costs money every hour and cannot see the pages a person
 * is already signed into. This bridge hands actions to the browser they have
 * open: the request travels through the CRM tab (already authenticated), a small
 * extension performs it with the DevTools Protocol, and the result comes back the
 * same way.
 *
 * The queue lives in memory, per user, and every action times out — a closed
 * laptop must fail a tool call, not hang one.
 */

import { randomUUID } from "node:crypto";

export interface LocalAction {
  id: string;
  action: "navigate" | "click" | "type" | "screenshot" | "extract";
  url?: string;
  selector?: string;
  text?: string;
}

export interface LocalResult {
  ok: boolean;
  data?: { url?: string; title?: string; text?: string; image?: string; width?: number; height?: number };
  error?: string;
}

interface Waiter {
  resolve: (result: LocalResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

const queues = new Map<string, LocalAction[]>();
const waiters = new Map<string, Waiter>();
const lastSeen = new Map<string, number>();

const CONNECTED_WINDOW_MS = 6_000;
const ACTION_TIMEOUT_MS = 30_000;

/** Called by the client when it polls; presence is what makes the path available. */
export function markLocalBrowserSeen(userId: string) {
  lastSeen.set(userId, Date.now());
}

export function isLocalBrowserConnected(userId: string): boolean {
  const seen = lastSeen.get(userId) ?? 0;
  return Date.now() - seen < CONNECTED_WINDOW_MS;
}

/** Queue an action and wait for the browser to answer it. */
export function requestLocalAction(userId: string, action: Omit<LocalAction, "id">): Promise<LocalResult> {
  if (!isLocalBrowserConnected(userId)) {
    return Promise.resolve({
      ok: false,
      error: "No browser is connected. Open the Cyraops tab and turn on 'Use my browser'.",
    });
  }

  const queued: LocalAction = { ...action, id: randomUUID() };
  const queue = queues.get(userId) ?? [];
  queue.push(queued);
  queues.set(userId, queue);

  return new Promise<LocalResult>((resolve) => {
    const timer = setTimeout(() => {
      waiters.delete(queued.id);
      const remaining = (queues.get(userId) ?? []).filter((item) => item.id !== queued.id);
      queues.set(userId, remaining);
      resolve({ ok: false, error: "The browser did not answer in time." });
    }, ACTION_TIMEOUT_MS);
    waiters.set(queued.id, { resolve, timer });
  });
}

/** Next action for this user, if any. The client polls this. */
export function pullLocalAction(userId: string): LocalAction | null {
  const queue = queues.get(userId) ?? [];
  const next = queue.shift() ?? null;
  queues.set(userId, queue);
  return next;
}

export function completeLocalAction(id: string, result: LocalResult): boolean {
  const waiter = waiters.get(id);
  if (!waiter) return false;
  clearTimeout(waiter.timer);
  waiters.delete(id);
  waiter.resolve(result);
  return true;
}
