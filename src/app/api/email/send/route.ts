import { NextRequest, NextResponse } from "next/server";
import { EmailService } from "@/lib/email/service";
import { sameOrigin, userFromRequest } from "@/lib/auth";

const DANGEROUS_EXTENSIONS = /\.(exe|bat|cmd|sh|vbs|scr|com|pif|msi|jar|ps1|hta|reg)$/i;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_TOTAL_RECIPIENTS = 50;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024; // 25MB

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.disabledAt) {
      return NextResponse.json({ error: "User account is disabled" }, { status: 403 });
    }

    // The company mailbox is shared: every active CRM user sends through this single address.

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { to, cc, bcc, subject, bodyText, bodyHtml, inReplyTo, references, attachments, idempotencyKey } = body;

    if (!to || !Array.isArray(to) || to.length === 0) {
      return NextResponse.json({ error: "At least one recipient address is required." }, { status: 400 });
    }

    const cleanTo = to.map((e: unknown) => String(e || "").trim()).filter(Boolean);
    const cleanCc = Array.isArray(cc) ? cc.map((e: unknown) => String(e || "").trim()).filter(Boolean) : [];
    const cleanBcc = Array.isArray(bcc) ? bcc.map((e: unknown) => String(e || "").trim()).filter(Boolean) : [];

    const totalRecipients = cleanTo.length + cleanCc.length + cleanBcc.length;
    if (totalRecipients > MAX_TOTAL_RECIPIENTS) {
      return NextResponse.json({ error: `Exceeded maximum recipient limit (${MAX_TOTAL_RECIPIENTS}).` }, { status: 400 });
    }

    for (const recipient of [...cleanTo, ...cleanCc, ...cleanBcc]) {
      if (!EMAIL_REGEX.test(recipient)) {
        return NextResponse.json({ error: `Invalid recipient email address: "${recipient}"` }, { status: 400 });
      }
    }

    if (!subject && !bodyText && !bodyHtml) {
      return NextResponse.json({ error: "Email must have either a subject or content." }, { status: 400 });
    }

    // Message size validation
    const totalBodySize = (bodyText ? Buffer.byteLength(String(bodyText), "utf8") : 0) +
                          (bodyHtml ? Buffer.byteLength(String(bodyHtml), "utf8") : 0);
    if (totalBodySize > MAX_BODY_BYTES) {
      return NextResponse.json({ error: "Email body exceeds maximum permitted size (2MB)." }, { status: 400 });
    }

    // Attachment validation
    let validatedAttachments: { filename: string; contentType?: string; content?: Buffer; path?: string }[] | undefined;
    if (Array.isArray(attachments) && attachments.length > 0) {
      if (attachments.length > 10) {
        return NextResponse.json({ error: "Maximum 10 attachments allowed per email." }, { status: 400 });
      }

      let totalAttSize = 0;
      validatedAttachments = [];

      for (const att of attachments) {
        if (!att || typeof att !== "object" || !att.filename) {
          return NextResponse.json({ error: "Invalid attachment metadata." }, { status: 400 });
        }

        const filename = String(att.filename).replace(/[\r\n\0]/g, "").trim();
        if (DANGEROUS_EXTENSIONS.test(filename)) {
          return NextResponse.json({ error: `Executable or dangerous attachment type blocked: ${filename}` }, { status: 400 });
        }

        let contentBuf: Buffer | undefined;
        let size = 0;
        if (att.content) {
          const buf = Buffer.isBuffer(att.content) ? att.content : Buffer.from(String(att.content), "base64");
          contentBuf = buf;
          size = buf.length;
        }

        if (size > MAX_ATTACHMENT_BYTES) {
          return NextResponse.json({ error: `Attachment "${filename}" exceeds 20MB limit.` }, { status: 400 });
        }

        totalAttSize += size;
        if (totalAttSize > MAX_TOTAL_ATTACHMENTS_BYTES) {
          return NextResponse.json({ error: "Combined attachment size exceeds 25MB limit." }, { status: 400 });
        }

        validatedAttachments.push({
          filename,
          contentType: att.contentType ? String(att.contentType).slice(0, 100) : "application/octet-stream",
          content: contentBuf,
        });
      }
    }

    const cleanSubject = typeof subject === "string" ? subject.trim().slice(0, 500) : "(No Subject)";

    const result = await EmailService.sendEmail({
      userId: user.id,
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey.slice(0, 100) : undefined,
      to: cleanTo,
      cc: cleanCc.length > 0 ? cleanCc : undefined,
      bcc: cleanBcc.length > 0 ? cleanBcc : undefined,
      subject: cleanSubject || "(No Subject)",
      bodyText: typeof bodyText === "string" ? bodyText : undefined,
      bodyHtml: typeof bodyHtml === "string" ? bodyHtml : undefined,
      inReplyTo: typeof inReplyTo === "string" ? inReplyTo.slice(0, 200) : undefined,
      references: typeof references === "string" ? references.slice(0, 500) : undefined,
      attachments: validatedAttachments,
    });

    return NextResponse.json({
      ok: true,
      messageId: result.messageId,
      savedMessage: result.savedMessage,
      deliveryStatus: result.deliveryStatus || result.savedMessage?.deliveryStatus || "SENT",
      imapAppendStatus: result.imapAppendStatus,
      isDuplicatePrevented: result.isDuplicatePrevented || false,
      warning: (result as any).warning,
    });
  } catch (err: any) {
    // Sanitize error message to prevent leaking secrets/passwords
    const rawError = err.message || "Failed to send email";
    const safeError = rawError.replace(/pass(word)?\s*[:=]\s*\S+/gi, "password=***");
    const status = err.statusCode || (err.deliveryStatus === "SENDING" || err.deliveryStatus === "DELIVERY_UNCERTAIN" ? 409 : 500);
    return NextResponse.json({ error: safeError, deliveryStatus: err.deliveryStatus }, { status });
  }
}
