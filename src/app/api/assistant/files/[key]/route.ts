import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";

type Context = { params: Promise<{ key: string }> };

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { key } = await context.params;

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const attachment = await db.assistantAttachment.findFirst({
      where: { storageKey: key, assistantId: assistant.id },
    });
    if (!attachment) return jsonError("File not found", 404);

    const bytes = await storage.get(key);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": attachment.mimeType,
        "Content-Disposition": `inline; filename="${attachment.name.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (err: any) {
    console.error("[API:assistant/files] Failed:", err);
    return jsonError("File could not be read", 500);
  }
}
