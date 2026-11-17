import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { isAbortError } from "./runtime";

/**
 * Regression coverage for the real native boot host
 * (`vendor/tooling/vendored-boot/native-host.mjs`). The module is imported
 * lazily (dynamic import of a computed file URL, exactly how the native
 * runtime loads it) so the suite never pays for the vendored tree boot; only
 * the exported pure helpers are exercised here.
 */
interface NativeHostModule {
  parseEventLine(line: string): unknown;
  makeAbortError(message?: string): Error;
}

let hostPromise: Promise<NativeHostModule> | null = null;
function loadHost(): Promise<NativeHostModule> {
  hostPromise ??= import(
    pathToFileURL(join(process.cwd(), "vendor", "tooling", "vendored-boot", "native-host.mjs")).href
  ) as Promise<NativeHostModule>;
  return hostPromise;
}

test("native host: makeAbortError produces a strict-mode-safe AbortError", async () => {
  // Regression: the host is an ES module (strict mode), and in Node ≥22 the
  // DOMException prototype's `name` is a getter-only accessor, so the old
  // `error.name = "AbortError"` assignment crashed the whole process when the
  // turn's AbortSignal fired (TypeError: Cannot set property name ... which
  // has only a getter). The error must carry the AbortError name without
  // mutating the prototype accessor.
  const { makeAbortError } = await loadHost();
  const error = makeAbortError("stop now");
  assert.equal(error.name, "AbortError");
  assert.equal(error.message, "stop now");
  assert.equal(isAbortError(error), true);
  // The name must be readable again (own property shadows the getter).
  assert.equal(error.name, "AbortError");
});

test("native host: parseEventLine accepts NDJSON events and rejects diagnostics", async () => {
  const { parseEventLine } = await loadHost();
  assert.deepEqual(parseEventLine('{"type":"text","text":"hi"}'), { type: "text", text: "hi" });
  assert.deepEqual(parseEventLine(' {"type":"final","text":"banana"} '), { type: "final", text: "banana" });
  assert.equal(parseEventLine(""), null);
  assert.equal(parseEventLine("   "), null);
  assert.equal(parseEventLine("plain diagnostic line"), null);
  assert.equal(parseEventLine('{"noType":true}'), null);
});
