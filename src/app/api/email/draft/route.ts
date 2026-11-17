import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EmailService } from "@/lib/email/service";
import { sameOrigin, userFromRequest } from "@/lib/auth";

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
      return NextResponse.json({ error: "User is disabled" }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid request payload" }, { status: 400 });
    }

    const { id, to, cc, bcc, subject, bodyText, bodyHtml } = body;

    const account = await EmailService.getOrCreateAccount();
    const draftFolder = account.folders.find((f) => f.type === "DRAFTS");

    const toRecipients = Array.isArray(to) ? JSON.stringify(to.map((t: unknown) => String(t || "").trim()).filter(Boolean)) : "[]";
    const ccRecipients = Array.isArray(cc) ? JSON.stringify(cc.map((c: unknown) => String(c || "").trim()).filter(Boolean)) : null;
    const bccRecipients = Array.isArray(bcc) ? JSON.stringify(bcc.map((b: unknown) => String(b || "").trim()).filter(Boolean)) : null;

    const isPrivileged = user.role === "OWNER" || user.role === "ADMIN";
    const draftUserScope = isPrivileged ? {} : { userId: user.id };

    let draft;
    if (id && typeof id === "string") {
      const existing = await db.emailMessage.findFirst({
        where: { id, accountId: account.id, ...draftUserScope },
      });
      if (!existing) {
        return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      }

      draft = await db.emailMessage.update({
        where: { id: existing.id },
        data: {
          toRecipients,
          ccRecipients,
          bccRecipients,
          subject: typeof subject === "string" ? subject.slice(0, 500) : "(Draft)",
          snippet: typeof bodyText === "string" ? bodyText.slice(0, 180) : "",
          bodyText: typeof bodyText === "string" ? bodyText : "",
          bodyHtml: typeof bodyHtml === "string" ? bodyHtml : null,
          isDraft: true,
          updatedAt: new Date(),
        },
      });
    } else {
      draft = await db.emailMessage.create({
        data: {
          accountId: account.id,
          folderId: draftFolder?.id,
          userId: user.id,
          messageId: `draft_${Date.now()}@cyraops.com`,
          fromName: account.name,
          fromEmail: account.email,
          toRecipients,
          ccRecipients,
          bccRecipients,
          subject: typeof subject === "string" ? subject.slice(0, 500) : "(Draft)",
          snippet: typeof bodyText === "string" ? bodyText.slice(0, 180) : "",
          bodyText: typeof bodyText === "string" ? bodyText : "",
          bodyHtml: typeof bodyHtml === "string" ? bodyHtml : null,
          isDraft: true,
          isRead: true,
        },
      });
    }

    return NextResponse.json({ ok: true, draft });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save draft" }, { status: 500 });
  }
}
