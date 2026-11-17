import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

type Context = { params: Promise<{ id: string }> };

/**
 * Serves a chat attachment. Authorisation is by conversation membership, so a
 * file is never readable by guessing its id. An attachment that has not been
 * sent yet is visible only to the teammate who uploaded it.
 */
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await context.params;
  const attachment = await db.messageAttachment.findUnique({
    where: { id },
    select: {
      name: true,
      storageKey: true,
      mimeType: true,
      uploadedById: true,
      message: { select: { conversationId: true } },
    },
  });
  if (!attachment) return jsonError("Attachment not found", 404);

  const allowed = attachment.message
    ? Boolean(
        await db.conversationMember.findUnique({
          where: {
            conversationId_userId: {
              conversationId: attachment.message.conversationId,
              userId: user.id,
            },
          },
          select: { userId: true },
        })
      )
    : attachment.uploadedById === user.id;

  if (!allowed) return jsonError("Attachment not found", 404);

  let bytes: Buffer;
  try {
    bytes = await storage.get(attachment.storageKey);
  } catch {
    return jsonError("That file is no longer available", 410);
  }

  const download = request.nextUrl.searchParams.get("download") === "1";
  const filename = attachment.name.replace(/["\\\r\n]/g, "");
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Length": String(bytes.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      // Uploaded files must never execute as a document in our origin.
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
