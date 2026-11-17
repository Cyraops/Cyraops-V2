import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

/**
 * Files a teammate can drop into a conversation. Images render inline; the
 * rest become downloadable cards. Kept deliberately tight: no archives, no
 * executables, nothing the browser cannot safely preview.
 */
const ALLOWED: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  md: "text/markdown",
  json: "application/json",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  // Reject before parsing the body: formData() buffers the whole multipart
  // payload, so the old order let one huge upload exhaust the container's
  // memory before the size check ever ran.
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024) return jsonError("Files must be 15 MB or smaller", 413);

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return jsonError("Choose a file to upload", 400);
  if (file.size < 1) return jsonError("That file is empty", 400);
  if (file.size > MAX_BYTES) return jsonError("Files must be 15 MB or smaller", 413);

  const originalName =
    file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 200) || "attachment";
  const extension = originalName.includes(".") ? originalName.split(".").pop()!.toLowerCase() : "";
  const mimeType = ALLOWED[extension];
  if (!mimeType) {
    return jsonError(`That file type is not supported. Allowed: ${Object.keys(ALLOWED).join(", ")}`, 415);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const storageKey = `${randomUUID()}.${extension}`;

    let attachment: { id: string; name: string; mimeType: string; size: number };
    try {
      attachment = await db.messageAttachment.create({
        data: { uploadedById: user.id, name: originalName, storageKey, mimeType, size: file.size },
        select: { id: true, name: true, mimeType: true, size: true },
      });
    } catch (dbErr) {
      throw dbErr;
    }

    try {
      await storage.put(storageKey, bytes);
    } catch (putErr) {
      // The row is created before the blob so a failed write can be rolled
      // back; the old order left an orphaned file whenever the DB failed.
      await db.messageAttachment.delete({ where: { id: attachment.id } }).catch(() => {});
      throw putErr;
    }

    return NextResponse.json({ attachment: { ...attachment, url: `/api/chat/attachments/${attachment.id}` } });
  } catch (err: any) {
    console.error("[API:chat/attachments] Upload failed:", err);
    return jsonError("Failed to upload the file", 500);
  }
}
