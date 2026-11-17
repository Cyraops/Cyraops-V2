/**
 * Server-side speech, so the voice is ours rather than the machine's.
 *
 * Browser speech depends on which voices happen to be installed, which is why it
 * often sounds like a 2005 screen reader. A hosted synthesizer has one good voice
 * per gender that sounds the same on every computer, needs nothing downloaded,
 * and is available the moment the page loads — the same arrangement ChatGPT uses.
 *
 * The provider is chosen from whichever key is present; with no key the caller
 * falls back to the browser voice, so nothing breaks.
 */

export type SpeechGender = "female" | "male";

export interface SynthesizedSpeech {
  audio: Buffer;
  contentType: string;
  provider: "deepseek" | "openai" | "elevenlabs";
}

/**
 * DeepSeek speaks too, as of its 2026 tool APIs, and we already hold that key —
 * so it is tried first. Stella is the female voice, Tide the male one.
 */
const DEEPSEEK_VOICES: Record<SpeechGender, string> = {
  female: process.env.DEEPSEEK_TTS_VOICE_FEMALE?.trim() || "stella",
  male: process.env.DEEPSEEK_TTS_VOICE_MALE?.trim() || "tide",
};

const OPENAI_VOICES: Record<SpeechGender, string> = {
  female: process.env.OPENAI_TTS_VOICE_FEMALE?.trim() || "nova",
  male: process.env.OPENAI_TTS_VOICE_MALE?.trim() || "onyx",
};

/** ElevenLabs voice ids: Rachel and Adam, overridable. */
const ELEVENLABS_VOICES: Record<SpeechGender, string> = {
  female: process.env.ELEVENLABS_VOICE_FEMALE?.trim() || "21m00Tcm4TlvDq8ikWAM",
  male: process.env.ELEVENLABS_VOICE_MALE?.trim() || "pNInz6obpgDQGcFmaJgB",
};

export type SpeechProvider = "deepseek" | "openai" | "elevenlabs" | null;

/** Which provider this deployment can use, if any. */
export function speechProvider(): SpeechProvider {
  if (process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
  if (process.env.OPENAI_API_KEY?.trim()) return "openai";
  if (process.env.ELEVENLABS_API_KEY?.trim()) return "elevenlabs";
  return null;
}

/** Long enough for a sentence, short enough to keep latency and cost sane. */
export const MAX_SPEECH_CHARS = 700;

export async function synthesizeSpeech(text: string, gender: SpeechGender): Promise<SynthesizedSpeech> {
  const provider = speechProvider();
  if (!provider) throw new Error("No speech provider is configured");
  const input = text.trim().slice(0, MAX_SPEECH_CHARS);
  if (!input) throw new Error("Nothing to say");

  if (provider === "deepseek") {
    const base = (process.env.DEEPSEEK_BASE_URL?.trim() || "https://api.deepseek.com/v1").replace(/\/$/, "");
    const response = await fetch(`${base}/tools/tts`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: input,
        voice_id: DEEPSEEK_VOICES[gender],
        format: "wav",
        filter_markdown: true,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Speech provider refused (${response.status}) ${detail.slice(0, 160)}`);
    }
    return { audio: Buffer.from(await response.arrayBuffer()), contentType: "audio/wav", provider };
  }

  if (provider === "openai") {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_TTS_MODEL?.trim() || "gpt-4o-mini-tts",
        voice: OPENAI_VOICES[gender],
        input,
        response_format: "mp3",
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Speech provider refused (${response.status}) ${detail.slice(0, 160)}`);
    }
    return { audio: Buffer.from(await response.arrayBuffer()), contentType: "audio/mpeg", provider };
  }

  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICES[gender]}`, {
    method: "POST",
    headers: {
      "xi-api-key": process.env.ELEVENLABS_API_KEY ?? "",
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text: input,
      model_id: process.env.ELEVENLABS_MODEL?.trim() || "eleven_turbo_v2_5",
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Speech provider refused (${response.status}) ${detail.slice(0, 160)}`);
  }
  return { audio: Buffer.from(await response.arrayBuffer()), contentType: "audio/mpeg", provider };
}
