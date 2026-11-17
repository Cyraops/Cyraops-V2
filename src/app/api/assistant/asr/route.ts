import { NextRequest } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { asrProvider, MAX_AUDIO_BYTES, transcribeAudio } from "@/lib/ai/voice/asr";

/**
 * Transcription for the voice screen.
 *
 * The browser records one utterance, sends it here, and gets the words back.
 * GET reports whether the server can transcribe at all, so the client can fall
 * back to the browser's own recognizer when there is no key.
 */

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const provider = asrProvider();
  return Response.json({ available: Boolean(provider), provider, maxBytes: MAX_AUDIO_BYTES });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (!asrProvider()) return jsonError("Speech-to-text is not configured", 503);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") return jsonError("No audio was sent", 400);

  const buffer = Buffer.from(await file.arrayBuffer());
  if (buffer.length === 0) return jsonError("The recording was empty", 400);
  if (buffer.length > MAX_AUDIO_BYTES) return jsonError("That recording is too large", 413);

  try {
    const result = await transcribeAudio(buffer);
    return Response.json({ text: result.text, durationMs: result.durationMs, provider: result.provider });
  } catch (error) {
    console.error("[api:assistant/asr] failed:", (error as Error)?.message);
    return jsonError("Could not understand the recording", 503);
  }
}
