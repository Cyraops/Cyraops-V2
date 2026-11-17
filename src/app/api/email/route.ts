import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { EmailService } from "@/lib/email/service";
import { getMailboxConfig } from "@/lib/email/config";
import { userFromRequest } from "@/lib/auth";
import { emailSyncWorker } from "@/lib/email/sync-worker";
import { emailFolderVisibilityWhere } from "@/lib/email/access";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (user.disabledAt) {
      return NextResponse.json({ error: "User is disabled" }, { status: 403 });
    }

    const account = await EmailService.getOrCreateAccount();
    const { config } = getMailboxConfig();

    const { searchParams } = new URL(req.url);
    const folderType = (searchParams.get("folder") || "INBOX").toUpperCase();
    const searchQuery = searchParams.get("q")?.trim() || "";
    const isStarredOnly = searchParams.get("starred") === "true";
    const isUnreadOnly = searchParams.get("unread") === "true";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "40", 10)));
    const skip = (page - 1) * limit;

    // Resolve target folder
    let folder = account.folders.find((f) => f.type === folderType || f.rawPath.toUpperCase() === folderType);
    if (!folder && folderType !== "ALL" && !isStarredOnly) {
      folder = account.folders.find((f) => f.type === "INBOX");
    }

    // Build Prisma query filter
    const where: any = {
      accountId: account.id,
      ...emailFolderVisibilityWhere(user, folderType),
    };

    if (isStarredOnly) {
      where.isStarred = true;
    } else if (folder) {
      if (folder.type === "STARRED") {
        where.isStarred = true;
      } else {
        where.folderId = folder.id;
      }
    }

    if (isUnreadOnly) {
      where.isRead = false;
    }

    if (searchQuery) {
      const searchConditions = [
        { subject: { contains: searchQuery, mode: "insensitive" } },
        { fromEmail: { contains: searchQuery, mode: "insensitive" } },
        { fromName: { contains: searchQuery, mode: "insensitive" } },
        { toRecipients: { contains: searchQuery, mode: "insensitive" } },
        { snippet: { contains: searchQuery, mode: "insensitive" } },
        { bodyText: { contains: searchQuery, mode: "insensitive" } },
      ];
      where.AND = where.AND || [];
      where.AND.push({ OR: searchConditions });
    }

    const [messages, totalCount] = await Promise.all([
      db.emailMessage.findMany({
        where,
        select: {
          id: true,
          messageId: true,
          userId: true,
          fromName: true,
          fromEmail: true,
          toRecipients: true,
          subject: true,
          snippet: true,
          isRead: true,
          isStarred: true,
          isDraft: true,
          hasAttachments: true,
          sentAt: true,
          receivedAt: true,
          sizeBytes: true,
          deliveryStatus: true,
          imapAppendStatus: true,
          folder: {
            select: { id: true, name: true, type: true },
          },
        },
        orderBy: { receivedAt: "desc" },
        skip,
        take: limit,
      }),
      db.emailMessage.count({ where }),
    ]);

    // Calculate unread counts per folder (scoped to user)
    const folderStats = await Promise.all(
      account.folders.map(async (f) => {
        const folderVisibility = emailFolderVisibilityWhere(user, f.type);
        const unread = f.type === "STARRED"
          ? await db.emailMessage.count({ where: { accountId: account.id, isStarred: true, isRead: false, ...folderVisibility } })
          : await db.emailMessage.count({ where: { folderId: f.id, isRead: false, ...folderVisibility } });

        const total = f.type === "STARRED"
          ? await db.emailMessage.count({ where: { accountId: account.id, isStarred: true, ...folderVisibility } })
          : await db.emailMessage.count({ where: { folderId: f.id, ...folderVisibility } });

        return {
          id: f.id,
          name: f.name,
          type: f.type,
          unreadCount: unread,
          totalCount: total,
        };
      })
    );

    const workerStatus = emailSyncWorker.getStatus();

    return NextResponse.json({
      account: {
        id: account.id,
        email: config.email,
        name: account.name,
        isConfigured: config.isConfigured,
        imapHost: config.imapHost,
        imapPort: config.imapPort,
        smtpHost: config.smtpHost,
        smtpPort: config.smtpPort,
        lastSyncedAt: account.lastSyncedAt,
        lastError: account.lastError,
        backgroundSync: workerStatus,
      },
      currentFolder: folder?.type || folderType,
      folders: folderStats,
      messages,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load emails" }, { status: 500 });
  }
}
