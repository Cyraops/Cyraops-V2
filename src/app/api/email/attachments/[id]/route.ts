import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { EmailService } from "@/lib/email/service";
import { canReadMailboxMessage } from "@/lib/email/access";
import fs from "fs/promises";
import path from "path";

const MAX_ATTACHMENT_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.disabledAt) {
      return NextResponse.json({ error: "User is disabled" }, { status: 403 });
    }

    const { id } = await params;
    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "Invalid attachment identifier" }, { status: 400 });
    }

    const account = await EmailService.getOrCreateAccount();

    const attachment = await db.emailAttachment.findUnique({
      where: { id },
      include: {
        message: {
          select: { id: true, accountId: true, userId: true, isDraft: true },
        },
      },
    });

    if (!attachment || !attachment.message || attachment.message.accountId !== account.id) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    if (!canReadMailboxMessage(user, attachment.message)) {
      return NextResponse.json({ error: "Attachment not found" }, { status: 404 });
    }

    // Path traversal and directory jail validation
    const ATTACHMENTS_BASE = path.resolve(process.cwd(), "storage", "email-attachments");
    const resolvedStoragePath = path.resolve(attachment.storagePath);

    if (!resolvedStoragePath.startsWith(ATTACHMENTS_BASE + path.sep)) {
      return NextResponse.json({ error: "Access denied to attachment storage path" }, { status: 403 });
    }

    try {
      const fileStat = await fs.stat(resolvedStoragePath);
      if (!fileStat.isFile()) {
        return NextResponse.json({ error: "Attachment is not a valid file" }, { status: 404 });
      }

      if (fileStat.size > MAX_ATTACHMENT_DOWNLOAD_BYTES) {
        return NextResponse.json({ error: "Attachment exceeds maximum download size" }, { status: 400 });
      }

      const fileBuffer = await fs.readFile(resolvedStoragePath);

      // Sanitize filename and content-type for safe header transport
      const cleanFilename = path.basename(attachment.filename).replace(/[\r\n"\0]/g, "_") || "attachment";
      const safeEncoded = encodeURIComponent(cleanFilename);
      const cleanContentType = (attachment.contentType || "application/octet-stream")
        .replace(/[\r\n]/g, "")
        .slice(0, 100);

      return new NextResponse(fileBuffer, {
        headers: {
          "Content-Type": cleanContentType,
          "Content-Disposition": `attachment; filename="${cleanFilename}"; filename*=UTF-8''${safeEncoded}`,
          "Content-Length": String(fileBuffer.length),
          "X-Content-Type-Options": "nosniff",
          "Content-Security-Policy": "default-src 'none'",
          "Cache-Control": "private, no-cache, no-store, must-revalidate",
        },
      });
    } catch {
      return NextResponse.json({ error: "Attachment file missing from storage" }, { status: 404 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to download attachment" }, { status: 500 });
  }
}
