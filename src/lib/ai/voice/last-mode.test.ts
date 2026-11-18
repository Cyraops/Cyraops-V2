import assert from "node:assert/strict";
import { test } from "node:test";
import { LAST_MODE_KEY, lastModeScope, parseLastModeStore, readLastMode, writeLastMode, type LastModeStorage } from "./last-mode";

/** A tiny in-memory storage with the real localStorage surface. */
function memoryStorage(initial: Record<string, string> = {}): LastModeStorage & { dump: () => Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => void map.set(key, value),
    dump: () => Object.fromEntries(map),
  };
}

test("parseLastModeStore: empty and corrupt values become an empty store", () => {
  assert.deepEqual(parseLastModeStore(null), {});
  assert.deepEqual(parseLastModeStore(""), {});
  assert.deepEqual(parseLastModeStore("not json"), {});
  assert.deepEqual(parseLastModeStore('"voice"'), {});
  assert.deepEqual(parseLastModeStore("[1,2]"), {});
});

test("parseLastModeStore: only voice/chat entries survive, others are dropped", () => {
  const store = parseLastModeStore('{"personal":"voice","a":"chat","b":"typo","c":7}');
  assert.deepEqual(store, { personal: "voice", a: "chat" });
});

test("readLastMode: probes candidate scopes in order and returns the first hit", () => {
  const storage = memoryStorage({ [LAST_MODE_KEY]: '{"personal":"voice","team-uuid":"chat"}' });
  assert.equal(readLastMode(storage, ["team-uuid", "personal"]), "chat");
  assert.equal(readLastMode(storage, ["missing", "personal"]), "voice");
  assert.equal(readLastMode(storage, ["missing"]), null);
});

test("readLastMode: a corrupt stored value reads as unknown, not a crash", () => {
  const storage = memoryStorage({ [LAST_MODE_KEY]: "{{{nope" });
  assert.equal(readLastMode(storage, ["personal"]), null);
});

test("writeLastMode: writes one assistant's mode without disturbing the others", () => {
  const storage = memoryStorage({ [LAST_MODE_KEY]: '{"other":"voice"}' });
  writeLastMode(storage, "personal", "chat");
  assert.deepEqual(parseLastModeStore(storage.getItem(LAST_MODE_KEY)), { other: "voice", personal: "chat" });
});

test("writeLastMode: overwrites an existing entry for the same scope", () => {
  const storage = memoryStorage();
  writeLastMode(storage, "personal", "voice");
  writeLastMode(storage, "personal", "chat");
  assert.equal(readLastMode(storage, ["personal"]), "chat");
});

test("writeLastMode: survives a corrupt previous value by starting fresh", () => {
  const storage = memoryStorage({ [LAST_MODE_KEY]: "corrupt" });
  writeLastMode(storage, "personal", "voice");
  assert.deepEqual(parseLastModeStore(storage.getItem(LAST_MODE_KEY)), { personal: "voice" });
});

test("lastModeScope: uses the assistant id when present, else the personal fallback", () => {
  assert.equal(lastModeScope("assistant-uuid"), "assistant-uuid");
  assert.equal(lastModeScope(""), "personal");
  assert.equal(lastModeScope(undefined), "personal");
  assert.equal(lastModeScope("   "), "personal");
});
