"use client";

/**
 * Recording one spoken utterance.
 *
 * The browser's speech recognizer is what made every command a guess. This
 * records the microphone instead, decides when the speaker has finished, and
 * hands back a WAV the server can transcribe properly.
 */

export interface RecordOptions {
  /** Silence that ends the utterance. */
  silenceMs?: number;
  /** Speech shorter than this is a cough, not a sentence. */
  minSpeechMs?: number;
  /** Hard stop, so a noisy room cannot record forever. */
  maxUtteranceMs?: number;
  /** Input level above which we call it speech. */
  threshold?: number;
  onLevel?: (level: number) => void;
  onSpeechStart?: () => void;
}

export interface RecordResult {
  blob: Blob | null;
  hadSpeech: boolean;
}

/** Decode whatever the recorder produced and re-encode it as 16-bit PCM WAV. */
export async function toWav(blob: Blob): Promise<Blob> {
  const arrayBuffer = await blob.arrayBuffer();
  const context = new OfflineAudioContext(1, 1, 48000);
  const decoded = await context.decodeAudioData(arrayBuffer.slice(0));
  const channel = decoded.getChannelData(0);
  const sampleRate = decoded.sampleRate;
  const length = channel.length;
  const buffer = new ArrayBuffer(44 + length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, length * 2, true);

  let offset = 44;
  for (let i = 0; i < length; i += 1) {
    const sample = Math.max(-1, Math.min(1, channel[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

/**
 * One smoothing step for a live microphone level, for meters.
 *
 * Attack is instant — the bar jumps up the moment sound arrives, which is what
 * tells the person they are being heard — and release is eased so the bar
 * fades between syllables instead of flickering. Both inputs and the result
 * are clamped to 0..1.
 */
export function smoothLevel(previous: number, raw: number, decay = 0.85): number {
  const prev = Number.isFinite(previous) ? Math.min(1, Math.max(0, previous)) : 0;
  if (!Number.isFinite(raw)) return prev;
  const value = Math.min(1, Math.max(0, raw));
  return value >= prev ? value : prev * decay;
}

/**
 * Records until the speaker stops talking.
 *
 * Speech is detected from the microphone's own level rather than from a fixed
 * timer, so a sentence full of pauses stays one utterance and a silent room ends
 * promptly instead of recording nothing for ten seconds.
 */
export async function recordUtterance(stream: MediaStream, options: RecordOptions = {}): Promise<RecordResult> {
  const silenceMs = options.silenceMs ?? 1200;
  const minSpeechMs = options.minSpeechMs ?? 250;
  const maxUtteranceMs = options.maxUtteranceMs ?? 20000;
  const threshold = options.threshold ?? 0.02;

  const context = new AudioContext();
  await context.resume().catch(() => {});
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  const source = context.createMediaStreamSource(stream);
  source.connect(analyser);

  const recorder = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size) chunks.push(event.data);
  };

  const started = performance.now();
  let speechStartedAt = 0;
  let lastLoudAt = 0;
  const buffer = new Uint8Array(analyser.fftSize);

  const level = () => {
    analyser.getByteTimeDomainData(buffer);
    let peak = 0;
    for (let i = 0; i < buffer.length; i += 1) peak = Math.max(peak, Math.abs(buffer[i] - 128));
    return peak / 128;
  };

  recorder.start();

  const decide = new Promise<{ hadSpeech: boolean }>((resolve) => {
    const tick = () => {
      const now = performance.now();
      const value = level();
      options.onLevel?.(value);

      if (value >= threshold) {
        if (!speechStartedAt) {
          speechStartedAt = now;
          options.onSpeechStart?.();
        }
        lastLoudAt = now;
      }

      const spokeEnough = speechStartedAt && now - speechStartedAt >= minSpeechMs;
      const quietLongEnough = spokeEnough && lastLoudAt && now - lastLoudAt >= silenceMs;
      const tooLong = now - started >= maxUtteranceMs;

      if (quietLongEnough || tooLong) {
        recorder.stop();
        resolve({ hadSpeech: Boolean(spokeEnough) });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });

  const decision = await decide;
  await stopped;
  source.disconnect();
  void context.close().catch(() => {});
  const hadSpeech = decision.hadSpeech && chunks.length > 0;
  return {
    blob: hadSpeech ? new Blob(chunks, { type: chunks[0]?.type || "audio/webm" }) : null,
    hadSpeech,
  };
}
