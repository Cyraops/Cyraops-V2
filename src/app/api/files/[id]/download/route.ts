import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { fileAccess } from "@/lib/drive";
import { storage } from "@/lib/storage";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

type Context = { params: Promise<{ id: string }> };
export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;
  const file = await db.driveFile.findFirst({ where: { id, deletedAt: null } });
  if (!file || !await fileAccess(file, user.id, user.role)) return jsonError("File not found", 404);
  if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(file.storageKey)) return jsonError("File not found", 404);
  try {
    const data = await storage.get(file.storageKey);
    const preview = request.nextUrl.searchParams.get("preview") === "1" && (file.mimeType === "application/pdf" || file.mimeType.startsWith("image/"));
    return new Response(new Uint8Array(data), { headers: { "Content-Type": file.mimeType, "Content-Length": String(data.byteLength), "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store" } });
  } catch { return jsonError("File is missing from storage", 404); }
}
