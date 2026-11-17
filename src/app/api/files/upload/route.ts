import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const allowedTypes: Record<string, string[]> = {
  pdf: ["application/pdf"], docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip"], xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "application/zip"], pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation", "application/zip"], txt: ["text/plain"], csv: ["text/csv", "application/csv", "text/plain"], jpg: ["image/jpeg"], jpeg: ["image/jpeg"], png: ["image/png"], zip: ["application/zip", "application/x-zip-compressed"],
};
function validSignature(extension: string, bytes: Uint8Array) {
  if (extension === "pdf") return Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";
  if (extension === "png") return Buffer.from(bytes.slice(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (extension === "jpg" || extension === "jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (["zip", "docx", "xlsx", "pptx"].includes(extension)) return bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  if (extension === "txt" || extension === "csv") return !Buffer.from(bytes).includes(0);
  return false;
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  const projectId = typeof form?.get("projectId") === "string" ? String(form.get("projectId")) : "";
  if (!(file instanceof File)) return jsonError("Choose a file to upload", 400);
  if (!projectId) return jsonError("Choose a project for this file", 400);
  const project = await db.project.findFirst({
    where: { id: projectId, ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } }) },
    select: { id: true },
  });
  if (!project) return jsonError("Project not found", 404);
  const configuredLimit = Number(process.env.MAX_UPLOAD_SIZE_MB ?? 25);
  const maxBytes = (Number.isFinite(configuredLimit) && configuredLimit > 0 ? Math.min(configuredLimit, 100) : 25) * 1024 * 1024;
  if (file.size < 1 || file.size > maxBytes) return jsonError(`Files must be smaller than ${Math.floor(maxBytes / 1024 / 1024)} MB`, 413);
  const originalName = file.name.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f]/g, "").trim().slice(0, 240) || "upload";
  const extension = originalName.split(".").pop()?.toLowerCase() ?? "";
  if (!allowedTypes[extension] || !(allowedTypes[extension].includes(file.type) || file.type === "application/octet-stream")) return jsonError("That file type is not supported", 415);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!validSignature(extension, bytes)) return jsonError("The file content does not match its extension", 415);
  const canonicalMime: Record<string, string> = { pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation", txt: "text/plain", csv: "text/csv", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", zip: "application/zip" };
  const mimeType = canonicalMime[extension];
  const storageKey = `${randomUUID()}.${extension}`;
  await storage.put(storageKey, bytes);
  try {
    const saved = await db.driveFile.create({ data: { name: originalName, storageKey, mimeType, size: file.size, projectId, uploaderId: user.id }, select: { id: true, name: true, mimeType: true, size: true, projectId: true, createdAt: true, uploader: { select: { id: true, name: true } } } });
    await logActivity({ action: "uploaded", entity: "file", entityId: saved.id, summary: `uploaded ${saved.name}`, userId: user.id, projectId });
    return Response.json({ file: saved }, { status: 201 });
  } catch (error) {
    await storage.delete(storageKey).catch(() => undefined);
    throw error;
  }
}
