import { db } from "@/lib/db";
import { EmailService } from "./service";
import { getMailboxConfig } from "./config";

export interface InviteMailResult {
  sent: boolean;
  reason?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Emails an account setup link to a newly invited teammate.
 *
 * Never throws: a mail failure must not fail the invitation itself, because the
 * setup link is still valid and the owner can share it manually. The caller
 * reports the outcome so the UI can say whether it was actually delivered.
 */
export async function sendInvitationEmail(params: {
  to: string | null | undefined;
  recipientName: string;
  setupUrl: string | null;
  invitedByName: string;
  inviterId: string;
  idempotencyKey: string;
}): Promise<InviteMailResult> {
  const to = (params.to || "").trim();

  if (!to) {
    return { sent: false, reason: "no email address is on file for this teammate" };
  }
  if (!params.setupUrl) {
    return { sent: false, reason: "no setup link could be generated for this server configuration" };
  }
  if (!getMailboxConfig().config.isConfigured) {
    return { sent: false, reason: "the shared company mailbox is not configured on this server" };
  }

  let workspaceName = "Cyraops";
  try {
    const workspace = await db.workspace.findUnique({ where: { id: "main" }, select: { name: true } });
    if (workspace?.name) workspaceName = workspace.name;
  } catch {
    // keep the default name
  }

  const safeName = escapeHtml(params.recipientName || "there");
  const safeCompany = escapeHtml(workspaceName);
  const safeInviter = escapeHtml(params.invitedByName || "your team");
  const safeUrl = escapeHtml(params.setupUrl);

  const subject = `Set up your ${workspaceName} account`;

  const bodyText = [
    `Hi ${params.recipientName || "there"},`,
    "",
    `${params.invitedByName || "Your team"} has invited you to ${workspaceName} on Cyraops.`,
    "",
    "Set your password using this link:",
    params.setupUrl,
    "",
    "This link expires in 48 hours and can only be used once.",
    "If you were not expecting this invitation, you can ignore this email.",
    "",
    `— ${workspaceName}`,
  ].join("\n");

  const bodyHtml = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:28px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e5ea;border-radius:14px;overflow:hidden;">
            <tr>
              <td style="padding:26px 26px 8px 26px;">
                <p style="margin:0 0 14px 0;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">${safeCompany}</p>
                <h1 style="margin:0 0 12px 0;font-size:20px;line-height:1.3;color:#111827;">Set up your account</h1>
                <p style="margin:0 0 6px 0;font-size:14px;line-height:1.6;color:#374151;">Hi ${safeName},</p>
                <p style="margin:0 0 20px 0;font-size:14px;line-height:1.6;color:#374151;">
                  ${safeInviter} has invited you to ${safeCompany} on Cyraops. Choose a password to activate your account.
                </p>
                <table role="presentation" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="border-radius:10px;background:#5b4fe0;">
                      <a href="${safeUrl}" style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">Set your password</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:20px 0 0 0;font-size:12px;line-height:1.6;color:#6b7280;">
                  This link expires in 48 hours and can only be used once. If the button does not work, paste this address into your browser:
                </p>
                <p style="margin:6px 0 0 0;font-size:12px;line-height:1.6;word-break:break-all;color:#5b4fe0;">${safeUrl}</p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 26px 26px 26px;">
                <p style="margin:0;font-size:11px;line-height:1.6;color:#9ca3af;border-top:1px solid #e5e5ea;padding-top:14px;">
                  If you were not expecting this invitation, you can safely ignore this email.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  try {
    await EmailService.sendEmail({
      to: [to],
      subject,
      bodyText,
      bodyHtml,
      userId: params.inviterId,
      idempotencyKey: params.idempotencyKey,
    });
    return { sent: true };
  } catch (err: any) {
    const message = String(err?.message || "unknown mail error");
    console.error("[InviteMail] Failed to send invitation email:", message);
    return { sent: false, reason: message.length > 160 ? `${message.slice(0, 160)}…` : message };
  }
}
