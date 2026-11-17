import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { speechProvider, synthesizeSpeech, MAX_SPEECH_CHARS } from "./server-speech";

const saved = { ...process.env };
afterEach(() => {
  process.env = { ...saved };
});

function withKeys(keys: Record<string, string | undefined>) {
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.ELEVENLABS_API_KEY;
  for (const [key, value] of Object.entries(keys)) if (value !== undefined) process.env[key] = value;
}

test("no key means no hosted voice", () => {
  withKeys({});
  assert.equal(speechProvider(), null);
});

test("DeepSeek is preferred because we already hold that key", () => {
  withKeys({ DEEPSEEK_API_KEY: "ds-test", OPENAI_API_KEY: "sk-test", ELEVENLABS_API_KEY: "el-test" });
  assert.equal(speechProvider(), "deepseek");
});

test("OpenAI is the next choice when DeepSeek is absent", () => {
  withKeys({ OPENAI_API_KEY: "sk-test", ELEVENLABS_API_KEY: "el-test" });
  assert.equal(speechProvider(), "openai");
});

test("DeepSeek speaks with stella and tide", async () => {
  withKeys({ DEEPSEEK_API_KEY: "ds-test" });
  const calls: any[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200 });
  }) as any;

  const female = await synthesizeSpeech("Hello.", "female");
  await synthesizeSpeech("Hello.", "male");

  assert.equal(calls[0].url.split("deepseek.com")[1], "/v1/tools/tts");
  assert.equal(calls[0].body.voice_id, "stella");
  assert.equal(calls[1].body.voice_id, "tide");
  assert.equal(calls[0].body.format, "wav");
  assert.equal(calls[0].auth, "Bearer ds-test");
  assert.equal(female.contentType, "audio/wav");
  assert.equal(female.provider, "deepseek");
});

test("OpenAI request names a female or male voice and returns the audio", async () => {
  withKeys({ OPENAI_API_KEY: "sk-test" });
  const requests: any[] = [];
  globalThis.fetch = (async (url: string, init: any) => {
    requests.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
  }) as any;

  const female = await synthesizeSpeech("Hello there.", "female");
  const male = await synthesizeSpeech("Hello there.", "male");

  assert.equal(requests[0].url, "https://api.openai.com/v1/audio/speech");
  assert.equal(requests[0].body.voice, "nova");
  assert.equal(requests[1].body.voice, "onyx");
  assert.equal(requests[0].body.input, "Hello there.");
  assert.equal(requests[0].auth, "Bearer sk-test");
  assert.equal(female.contentType, "audio/mpeg");
  assert.deepEqual([...female.audio], [1, 2, 3]);
});

test("a refusing provider raises instead of returning silence", async () => {
  withKeys({ OPENAI_API_KEY: "sk-test" });
  globalThis.fetch = (async () => new Response("no", { status: 401 })) as any;
  await assert.rejects(() => synthesizeSpeech("Hello", "female"), /refused \(401\)/);
});

test("text is capped so one sentence cannot become a bill", async () => {
  withKeys({ ELEVENLABS_API_KEY: "el-test" });
  let sent = "";
  globalThis.fetch = (async (_url: string, init: any) => {
    sent = JSON.parse(init.body).text;
    return new Response(new Uint8Array([0]), { status: 200 });
  }) as any;

  await synthesizeSpeech("x".repeat(MAX_SPEECH_CHARS + 500), "female");
  assert.equal(sent.length, MAX_SPEECH_CHARS);
});

test("ElevenLabs uses the configured voice ids", async () => {
  withKeys({ ELEVENLABS_API_KEY: "el-test" });
  const urls: string[] = [];
  globalThis.fetch = (async (url: string) => {
    urls.push(url);
    return new Response(new Uint8Array([9]), { status: 200 });
  }) as any;

  await synthesizeSpeech("hi", "male");
  assert.match(urls[0], /api\.elevenlabs\.io\/v1\/text-to-speech\/pNInz6obpgDQGcFmaJgB/);
});
