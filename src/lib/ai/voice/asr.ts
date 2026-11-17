/**
 * Speech to text, on the server.
 *
 * The browser's own speech recognition is quick to wire up and poor at accents:
 * Indian English and Hinglish come back mangled, which turns every command into
 * a guessing game. DeepSeek's ASR detects the language itself, accepts Hindi and
 * English, and hears 16-bit PCM WAV at 8–48 kHz.
 */

export type AsrProvider = "deepseek" | null;

export interface Transcription {
  text: string;
  durationMs?: number;
  provider: "deepseek";
}

export const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
export const MAX_AUDIO_SECONDS = 120;

export function asrProvider(): AsrProvider {
  return process.env.DEEPSEEK_API_KEY?.trim() ? "deepseek" : null;
}

export async function transcribeAudio(audio: Buffer, filename = "speech.wav"): Promise<Transcription> {
  if (!asrProvider()) throw new Error("No speech-to-text provider is configured");
  if (!audio.length) throw new Error("Empty audio");
  if (audio.length > MAX_AUDIO_BYTES) throw new Error("Audio is too large");

  const base = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1").replace(/\/$/, "");
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: "audio/wav" }), filename);

  const response = await fetch(`${base}/tools/asr`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: form,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech-to-text refused (${response.status}) ${detail.slice(0, 160)}`);
  }

  const data = (await response.json()) as { text?: string; duration_ms?: number };
  return { text: String(data.text ?? "").trim(), durationMs: data.duration_ms, provider: "deepseek" };
}
