import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EmailService } from "@/lib/email/service";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { canPermanentlyDeleteSharedMail, emailMessageVisibilityWhere } from "@/lib/email/access";

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

    const { action, messageIds, folderType, targetFolderId } = body;

    if (!action || !Array.isArray(messageIds) || messageIds.length === 0) {
      return NextResponse.json({ error: "Action and messageIds are required" }, { status: 400 });
    }

    // Sanitize message IDs
    const cleanIds = messageIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length < 100);
    if (cleanIds.length === 0) {
      return NextResponse.json({ error: "No valid message IDs provided" }, { status: 400 });
    }

    if (action === "deletePermanent" && !canPermanentlyDeleteSharedMail(user)) {
      return NextResponse.json({ error: "Only an owner or admin can permanently delete shared mail." }, { status: 403 });
    }

    const account = await EmailService.getOrCreateAccount();
    const messageVisibility = emailMessageVisibilityWhere(user);

    const authorizedCount = await db.emailMessage.count({
      where: { id: { in: cleanIds }, accountId: account.id, ...messageVisibility },
    });

    if (authorizedCount === 0) {
      return NextResponse.json({ error: "No authorized messages found" }, { status: 404 });
    }

    const authorizedWhere = { id: { in: cleanIds }, accountId: account.id, ...messageVisibility };

    switch (action) {
      case "markRead": {
        await db.emailMessage.updateMany({
          where: authorizedWhere,
          data: { isRead: true },
        });
        void EmailService.syncFlagsToRemote({ messageIds: cleanIds, action: "markRead" });
        break;
      }
      case "markUnread": {
        await db.emailMessage.updateMany({
          where: authorizedWhere,
          data: { isRead: false },
        });
        void EmailService.syncFlagsToRemote({ messageIds: cleanIds, action: "markUnread" });
        break;
      }
      case "toggleStar": {
        const msg = await db.emailMessage.findFirst({
          where: { id: cleanIds[0], accountId: account.id, ...messageVisibility },
        });
        if (msg) {
          const updated = await db.emailMessage.update({
            where: { id: msg.id },
            data: { isStarred: !msg.isStarred },
          });
          void EmailService.syncFlagsToRemote({ messageIds: [updated.id], action: "toggleStar" });
        }
        break;
      }
      case "archive": {
        const archiveFolder = account.folders.find((f) => f.type === "ARCHIVE");
        await db.emailMessage.updateMany({
          where: authorizedWhere,
          data: { isArchived: true, folderId: archiveFolder?.id },
        });
        break;
      }
      case "trash": {
        const trashFolder = account.folders.find((f) => f.type === "TRASH");
        await db.emailMessage.updateMany({
          where: authorizedWhere,
          data: { folderId: trashFolder?.id },
        });
        break;
      }
      case "deletePermanent": {
        await db.emailMessage.deleteMany({
          where: authorizedWhere,
        });
        break;
      }
      case "move": {
        const target = targetFolderId
          ? account.folders.find((f) => f.id === targetFolderId)
          : account.folders.find((f) => f.type === folderType);
        if (target) {
          await db.emailMessage.updateMany({
            where: authorizedWhere,
            data: { folderId: target.id },
          });
        }
        break;
      }
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action, count: cleanIds.length });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to perform action" }, { status: 500 });
  }
}
