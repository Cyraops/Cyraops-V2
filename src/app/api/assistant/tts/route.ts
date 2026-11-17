import { NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { MAX_SPEECH_CHARS, speechProvider, synthesizeSpeech } from "@/lib/ai/voice/server-speech";

/**
 * The assistant's voice, generated on the server.
 *
 * GET says whether a hosted voice is available, so the client knows whether to
 * use it or the browser's. POST returns the audio for one sentence.
 */

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const provider = speechProvider();
  return Response.json({ available: Boolean(provider), provider });
}

const bodySchema = z.object({
  text: z.string().trim().min(1).max(MAX_SPEECH_CHARS),
  gender: z.enum(["female", "male"]).default("female"),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Check the text to speak", 400);

  try {
    const speech = await synthesizeSpeech(parsed.data.text, parsed.data.gender);
    return new Response(new Uint8Array(speech.audio), {
      status: 200,
      headers: {
        "Content-Type": speech.contentType,
        "Content-Length": String(speech.audio.byteLength),
        "Cache-Control": "no-store",
        "X-Speech-Provider": speech.provider,
      },
    });
  } catch (error) {
    // The client falls back to the browser voice; say why in the log, not to the
    // reader, so a missing key never interrupts a conversation.
    console.error("[api:assistant/tts] failed:", (error as Error)?.message);
    return jsonError("Speech is unavailable right now", 503);
  }
}
