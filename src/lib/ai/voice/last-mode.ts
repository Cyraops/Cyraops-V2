"use client";

/**
 * The mode — voice or chat — each assistant was last used in.
 *
 * The bot workspace owns the `voiceOpen` switch (bot-workspace.tsx), while the
 * voice screen is the only component that reliably knows when it opened and
 * when the user explicitly left it. So the two sides share one localStorage
 * key, written here and read there:
 *
 *   key:   `cyraops:bot:lastMode`
 *   value: JSON object mapping an assistant scope to its last mode,
 *          `{ "<scope>": "voice" | "chat", ... }`
 *
 * Scope convention (the contract bot-workspace.tsx reads against):
 *   - VoiceMode records under the `assistantId` it is given — the assistant's
 *     own uuid. It falls back to the literal `"personal"` while no id has
 *     loaded yet (first paint, before /api/assistant/me answers).
 *   - Readers should probe candidate scopes in order, e.g.
 *     `readLastMode(storage, [me.assistant.id, "personal"])`, so an entry
 *     written either way is found.
 *   - VoiceMode writes "voice" the moment it opens (mount) and "chat" when the
 *     user leaves it with the end-call button. Unmounts that are not an
 *     explicit exit (switching assistant, navigating away) write nothing.
 *   - Voice mode exists only for the personal assistant today, so teammate
 *     entries are simply never written and teammates keep defaulting to chat.
 *
 * Any parser error (corrupt JSON, wrong shape) degrades to an empty store and
 * falls back to the default, never to a crash.
 */

export const LAST_MODE_KEY = "cyraops:bot:lastMode";

export type LastMode = "voice" | "chat";

export type LastModeStore = Record<string, LastMode>;

/** The narrowest storage surface the helpers need, for tests and SSR safety. */
export interface LastModeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Parse the stored map, dropping anything that is not a valid mode. */
export function parseLastModeStore(raw: string | null): LastModeStore {
  if (!raw) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const store: LastModeStore = {};
  for (const [scope, mode] of Object.entries(parsed as Record<string, unknown>)) {
    if (mode === "voice" || mode === "chat") store[scope] = mode;
  }
  return store;
}

/** First remembered mode among the candidate scopes, or null when unknown. */
export function readLastMode(storage: LastModeStorage, scopes: string[]): LastMode | null {
  const store = parseLastModeStore(storage.getItem(LAST_MODE_KEY));
  for (const scope of scopes) {
    const mode = store[scope];
    if (mode) return mode;
  }
  return null;
}

/** Remember one assistant's mode without disturbing the other entries. */
export function writeLastMode(storage: LastModeStorage, scope: string, mode: LastMode): void {
  const store = parseLastModeStore(storage.getItem(LAST_MODE_KEY));
  store[scope] = mode;
  storage.setItem(LAST_MODE_KEY, JSON.stringify(store));
}

/** The scope VoiceMode records under: its assistant id, or the personal assistant. */
export function lastModeScope(assistantId?: string): string {
  return assistantId?.trim() ? assistantId : "personal";
}
