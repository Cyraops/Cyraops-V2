import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { fileAccess } from "@/lib/drive";
import { storage } from "@/lib/storage";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { isSpreadsheet, readSpreadsheet, writeSpreadsheet, xlsxMimeType } from "@/lib/files/spreadsheet";

/**
 * In-app file editing.
 *
 * GET  — what the viewer needs to render a file without leaving the product.
 * PUT  — save an edited spreadsheet back.
 *
 * The file is read from our own storage, parsed here, and written back here.
 * Nothing is fetched from or posted to a third party, which is the point: a
 * project's numbers are the client's data.
 */

type Context = { params: Promise<{ id: string }> };

const MAX_SAVE_BYTES = 12 * 1024 * 1024;

const saveSchema = z.object({
  sheets: z
    .array(
      z.object({
        name: z.string().max(120),
        rows: z.array(z.array(z.string().max(4000))).max(2001),
      })
    )
    .min(1)
    .max(20),
});

const textExtensions = /\.(txt|md|markdown|json|log|yml|yaml)$/i;
const MAX_TEXT_PREVIEW = 400_000;

export async function GET(request: NextRequest, context: Context) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const file = await db.driveFile.findFirst({ where: { id, deletedAt: null } });
  if (!file || !await fileAccess(file, user.id, user.role)) return jsonError("File not found", 404);

  let bytes: Buffer;
  try {
    bytes = await storage.get(file.storageKey);
  } catch {
    return jsonError("File is missing from storage", 404);
  }

  const mime = (file.mimeType || "").toLowerCase();

  if (isSpreadsheet(file.mimeType, file.name)) {
    try {
      const sheets = await readSpreadsheet({ bytes, mimeType: file.mimeType, name: file.name });
      return Response.json({
        kind: "sheet",
        sheets,
        editable: true,
        // Saved workbooks keep values, not styling. Better said up front.
        note: "Editing saves values only — cell colours, fonts and charts are not preserved.",
      });
    } catch (error: any) {
      console.error("[Files] Could not parse spreadsheet:", error?.message);
      return Response.json({ kind: "unsupported", mimeType: file.mimeType, reason: "This workbook could not be read." });
    }
  }

  if (mime.startsWith("image/")) {
    return Response.json({ kind: "image", url: `/api/files/${file.id}/download?preview=1`, mimeType: file.mimeType });
  }

  if (mime === "application/pdf") {
    return Response.json({ kind: "pdf", url: `/api/files/${file.id}/download?preview=1`, mimeType: file.mimeType });
  }

  if (mime.startsWith("text/") || textExtensions.test(file.name)) {
    return Response.json({
      kind: "text",
      text: bytes.subarray(0, MAX_TEXT_PREVIEW).toString("utf8"),
      truncated: bytes.byteLength > MAX_TEXT_PREVIEW,
      editable: false,
    });
  }

  return Response.json({ kind: "unsupported", mimeType: file.mimeType });
}

export async function PUT(request: NextRequest, context: Context) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { id } = await context.params;

  const file = await db.driveFile.findFirst({ where: { id, deletedAt: null } });
  // Editing is a write: only an editor may do it.
  if (!file || await fileAccess(file, user.id, user.role) !== "EDITOR") return jsonError("File not found", 404);

  if (!isSpreadsheet(file.mimeType, file.name)) {
    return jsonError("Only spreadsheets can be edited here for now", 400);
  }

  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("The edited sheet was not understood", 400);

  const written = await writeSpreadsheet({
    sheets: parsed.data.sheets,
    mimeType: file.mimeType,
    name: file.name,
  });
  if (written.bytes.byteLength > MAX_SAVE_BYTES) return jsonError("That workbook is too large to save", 413);

  // Write the new bytes before touching the row, so a failure cannot leave a
  // record pointing at content that was never written. The old key is removed
  // only after the row is updated.
  const extension = /\.csv$/i.test(file.name) ? "csv" : "xlsx";
  const newKey = `${crypto.randomUUID()}.${extension}`;
  await storage.put(newKey, written.bytes);

  const oldKey = file.storageKey;
  const updated = await db.driveFile.update({
    where: { id },
    data: {
      storageKey: newKey,
      size: written.bytes.byteLength,
      mimeType: written.mimeType || xlsxMimeType(),
    },
    select: { id: true, name: true, size: true, mimeType: true, createdAt: true },
  });

  await storage.delete(oldKey).catch(() => {
    /* the leftover blob is swept by the storage layer, not the user's problem */
  });

  await logActivity({
    action: "updated",
    entity: "file",
    entityId: id,
    summary: `edited ${file.name}`,
    userId: user.id,
    projectId: file.projectId,
  });

  return Response.json({ file: updated });
}
