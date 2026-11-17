import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { getOrCreateAssistant } from "@/lib/ai/assistant/runtime";

const ALLOWED: Record<string, string> = {
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

const MAX_BYTES = 10 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("Choose a file to upload", 400);
  if (file.size < 1 || file.size > MAX_BYTES) return jsonError("Files must be between 1 byte and 10 MB", 413);

  const originalName = file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "upload";
  const extension = originalName.split(".").pop()?.toLowerCase() ?? "";
  const mimeType = ALLOWED[extension];
  if (!mimeType) return jsonError(`That file type is not supported. Allowed: ${Object.keys(ALLOWED).join(", ")}`, 415);

  try {
    const assistant = await getOrCreateAssistant(user.id);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const storageKey = `${randomUUID()}.${extension}`;
    await storage.put(storageKey, bytes);

    const attachment = await db.assistantAttachment.create({
      data: { assistantId: assistant.id, name: originalName, storageKey, mimeType, size: file.size },
      select: { id: true, name: true, mimeType: true, size: true, storageKey: true },
    });

    return NextResponse.json({
      attachment: { ...attachment, url: `/api/assistant/files/${storageKey}` },
    });
  } catch (err: any) {
    console.error("[API:assistant/upload] Failed:", err);
    return jsonError("Failed to upload the file", 500);
  }
}
