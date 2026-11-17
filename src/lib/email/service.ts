import { ImapFlow } from "imapflow";
import nodemailer, { type SendMailOptions, type Transporter } from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer";
import { simpleParser } from "mailparser";
import { db } from "@/lib/db";
import { getMailboxConfig } from "./config";
import { sanitizeEmailHtml } from "./sanitize";
import fs from "fs/promises";
import path from "path";
import { triggerOnEmail } from "@/lib/ai/automation/triggers";

const ATTACHMENTS_DIR = path.join(process.cwd(), "storage", "email-attachments");

export interface SendMailParams {
  userId?: string;
  idempotencyKey?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyText?: string;
  bodyHtml?: string;
  inReplyTo?: string;
  references?: string;
  attachments?: {
    filename: string;
    contentType?: string;
    content?: Buffer | string;
    path?: string;
  }[];
  transportOverride?: Transporter;
}

export class EmailService {
  /**
   * Ensure EmailAccount and standard folders exist (optionally user-scoped)
   */
  static async getOrCreateAccount(userId?: string) {
    const { config } = getMailboxConfig();

    let account = await db.emailAccount.findFirst({
      where: userId ? { userId } : { isDefault: true },
      include: { folders: true },
    });

    if (!account) {
      account = await db.emailAccount.create({
        data: {
          userId: userId || null,
          workspaceId: "main",
          email: config.email,
          name: config.name,
          imapHost: config.imapHost,
          imapPort: config.imapPort,
          imapTls: config.imapTls,
          smtpHost: config.smtpHost,
          smtpPort: config.smtpPort,
          smtpTls: config.smtpTls,
          isDefault: !userId,
          isActive: config.isConfigured,
        },
        include: { folders: true },
      });
    } else if (config.email && config.email !== account.email && !userId) {
      account = await db.emailAccount.update({
        where: { id: account.id },
        data: {
          email: config.email,
          isActive: config.isConfigured,
        },
        include: { folders: true },
      });
    }

    // Ensure system folders exist
    const standardFolders = [
      { name: "Inbox", rawPath: "INBOX", type: "INBOX" as const, specialUse: "\\Inbox" },
      { name: "Sent", rawPath: "Sent", type: "SENT" as const, specialUse: "\\Sent" },
      { name: "Drafts", rawPath: "Drafts", type: "DRAFTS" as const, specialUse: "\\Drafts" },
      { name: "Starred", rawPath: "Starred", type: "STARRED" as const, specialUse: "\\Flagged" },
      { name: "Archive", rawPath: "Archive", type: "ARCHIVE" as const, specialUse: "\\Archive" },
      { name: "Spam", rawPath: "Spam", type: "SPAM" as const, specialUse: "\\Junk" },
      { name: "Trash", rawPath: "Trash", type: "TRASH" as const, specialUse: "\\Trash" },
    ];

    for (const f of standardFolders) {
      const exists = account.folders.some((ef) => ef.rawPath.toLowerCase() === f.rawPath.toLowerCase() || ef.type === f.type);
      if (!exists) {
        await db.emailFolder.create({
          data: {
            accountId: account.id,
            name: f.name,
            rawPath: f.rawPath,
            type: f.type,
            specialUse: f.specialUse,
          },
        });
      }
    }

    // Refresh folders
    return db.emailAccount.findUniqueOrThrow({
      where: { id: account.id },
      include: {
        folders: {
          orderBy: { name: "asc" },
        },
      },
    });
  }

  /**
   * Test IMAP and SMTP connectivity
   */
  static async testConnection(): Promise<{
    imap: { ok: boolean; message: string };
    smtp: { ok: boolean; message: string };
  }> {
    const { config, password } = getMailboxConfig();

    if (!config.isConfigured || !password) {
      return {
        imap: { ok: false, message: "GoDaddy mailbox credentials not configured in environment (GODADDY_EMAIL_ADDRESS / GODADDY_EMAIL_PASSWORD)" },
        smtp: { ok: false, message: "GoDaddy mailbox credentials not configured in environment" },
      };
    }

    let imapResult = { ok: false, message: "Pending" };
    let smtpResult = { ok: false, message: "Pending" };

    // 1. Test IMAP
    const imapClient = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapTls,
      auth: {
        user: config.email,
        pass: password,
      },
      logger: false,
    });

    try {
      await imapClient.connect();
      imapResult = { ok: true, message: `Connected to IMAP ${config.imapHost}:${config.imapPort} successfully.` };
      await imapClient.logout();
    } catch (err: any) {
      imapResult = { ok: false, message: `IMAP connection failed: ${err.message || String(err)}` };
    }

    // 2. Test SMTP
    const transporter = nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpTls,
      auth: {
        user: config.email,
        pass: password,
      },
    });

    try {
      await transporter.verify();
      smtpResult = { ok: true, message: `Connected to SMTP ${config.smtpHost}:${config.smtpPort} successfully.` };
    } catch (err: any) {
      smtpResult = { ok: false, message: `SMTP connection failed: ${err.message || String(err)}` };
    }

    return { imap: imapResult, smtp: smtpResult };
  }

  /**
   * Append an RFC 822 MIME message to the remote GoDaddy IMAP Sent folder
   */
  static async appendEmailToSent(rawMime: Buffer): Promise<{ ok: boolean; folder?: string; error?: string }> {
    const { config, password } = getMailboxConfig();
    if (!config.isConfigured || !password) {
      return { ok: false, error: "GoDaddy mailbox credentials not configured" };
    }

    const imapClient = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapTls,
      auth: { user: config.email, pass: password },
      logger: false,
    });

    try {
      await imapClient.connect();

      // Discover Sent folder dynamically via specialUse or path heuristics
      const mailboxes = await imapClient.list();
      const sentMailbox = mailboxes.find(
        (m) => m.specialUse === "\\Sent" || /^sent(\s*(items|messages))?$/i.test(m.path) || /sent/i.test(m.name)
      );
      const sentPath = sentMailbox?.path || "Sent";

      await imapClient.append(sentPath, rawMime, ["\\Seen"]);
      await imapClient.logout();

      return { ok: true, folder: sentPath };
    } catch (err: any) {
      try { await imapClient.logout(); } catch { /* ignore */ }
      return { ok: false, error: err.message || String(err) };
    }
  }

  /**
   * Synchronize local read/unread or star/unstar flag changes back to remote GoDaddy IMAP
   */
  static async syncFlagsToRemote(params: {
    messageIds: string[];
    action: "markRead" | "markUnread" | "toggleStar";
  }) {
    const { config, password } = getMailboxConfig();
    if (!config.isConfigured || !password) return;

    const messages = await db.emailMessage.findMany({
      where: { id: { in: params.messageIds }, uid: { not: null } },
      include: { folder: true },
    });

    if (messages.length === 0) return;

    const imapClient = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapTls,
      auth: { user: config.email, pass: password },
      logger: false,
    });

    try {
      await imapClient.connect();

      // Group messages by folder
      const byFolder = new Map<string, typeof messages>();
      for (const msg of messages) {
        const folderPath = msg.folder?.rawPath || "INBOX";
        if (!byFolder.has(folderPath)) byFolder.set(folderPath, []);
        byFolder.get(folderPath)!.push(msg);
      }

      for (const [folderPath, msgs] of byFolder.entries()) {
        const lock = await imapClient.getMailboxLock(folderPath);
        try {
          const uids = msgs.map((m) => m.uid!).filter(Boolean);
          if (uids.length === 0) continue;

          if (params.action === "markRead") {
            await imapClient.messageFlagsAdd(uids.join(","), ["\\Seen"], { uid: true });
          } else if (params.action === "markUnread") {
            await imapClient.messageFlagsRemove(uids.join(","), ["\\Seen"], { uid: true });
          } else if (params.action === "toggleStar") {
            for (const msg of msgs) {
              if (msg.isStarred) {
                await imapClient.messageFlagsAdd(String(msg.uid), ["\\Flagged"], { uid: true });
              } else {
                await imapClient.messageFlagsRemove(String(msg.uid), ["\\Flagged"], { uid: true });
              }
            }
          }
        } finally {
          lock.release();
        }
      }

      await imapClient.logout();
    } catch (err) {
      console.error("IMAP remote flag sync warning:", err);
      try { await imapClient.logout(); } catch { /* ignore */ }
    }
  }

  /**
   * Synchronize mailbox messages incrementally using IMAP UIDs, with flag and deletion reconciliation
   */
  static async syncMailbox(options: { folderPath?: string; limit?: number } = {}) {
    const { config, password } = getMailboxConfig();
    const account = await this.getOrCreateAccount();

    if (!config.isConfigured || !password) {
      return {
        ok: false,
        syncedCount: 0,
        message: "Mailbox credentials not configured. Please add GODADDY_EMAIL_ADDRESS and GODADDY_EMAIL_PASSWORD to .env.",
        isConfigured: false,
      };
    }

    const folderPath = options.folderPath || "INBOX";
    const limit = options.limit || 50;

    const imapClient = new ImapFlow({
      host: config.imapHost,
      port: config.imapPort,
      secure: config.imapTls,
      auth: {
        user: config.email,
        pass: password,
      },
      logger: false,
    });

    let syncedCount = 0;

    try {
      await imapClient.connect();

      // Open target folder
      const lock = await imapClient.getMailboxLock(folderPath);

      try {
        const mailbox = imapClient.mailbox;
        if (!mailbox) {
          throw new Error(`Folder ${folderPath} not found`);
        }

        const uidValidity = String(mailbox.uidValidity || "");
        const totalMessages = mailbox.exists || 0;

        // Find or create sync state
        const syncState = await db.emailSyncState.findUnique({
          where: {
            accountId_folderName: {
              accountId: account.id,
              folderName: folderPath,
            },
          },
        });

        let highestUid = syncState?.highestUid || 0;
        if (syncState && syncState.uidValidity !== uidValidity) {
          // UIDVALIDITY changed; reset sync checkpoint safely
          highestUid = 0;
        }

        // Find the matching database folder
        const targetFolder = account.folders.find(
          (f) => f.rawPath.toLowerCase() === folderPath.toLowerCase() || (folderPath === "INBOX" && f.type === "INBOX")
        );

        const activeUids = new Set<number>();

        if (totalMessages > 0) {
          // 1. Inbound Flag Reconciliation: Fetch flags on existing messages
          try {
            for await (const msg of imapClient.fetch("1:*", { uid: true, flags: true })) {
              activeUids.add(msg.uid);
              const isRead = Boolean(msg.flags?.has("\\Seen"));
              const isStarred = Boolean(msg.flags?.has("\\Flagged"));

              // Check if already in DB
              const existingInDb = await db.emailMessage.findFirst({
                where: { accountId: account.id, uid: msg.uid, folderId: targetFolder?.id },
                select: { id: true, isRead: true, isStarred: true },
              });

              if (existingInDb && (existingInDb.isRead !== isRead || existingInDb.isStarred !== isStarred)) {
                await db.emailMessage.update({
                  where: { id: existingInDb.id },
                  data: { isRead, isStarred },
                });
              }
            }
          } catch {
            // Non-fatal if folder is empty or range unsupported
          }

          // 2. Fetch new messages above highestUid
          const range = highestUid > 0 ? `${highestUid + 1}:*` : `${Math.max(1, totalMessages - limit + 1)}:*`;

          for await (const message of imapClient.fetch(range, {
            uid: true,
            flags: true,
            envelope: true,
            source: true,
          })) {
            if (message.uid <= highestUid && highestUid > 0) continue;

            try {
              if (!message.source) continue;
              // Parse MIME content
              const parsed = await simpleParser(message.source);

              const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text?.split("<")[0]?.trim() || "";
              const fromEmail = parsed.from?.value?.[0]?.address || account.email;
              const toRecipients = JSON.stringify(
                parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]).flatMap((t) => t.value.map((v) => v.address)) : []
              );
              const ccRecipients = parsed.cc
                ? JSON.stringify((Array.isArray(parsed.cc) ? parsed.cc : [parsed.cc]).flatMap((c) => c.value.map((v) => v.address)))
                : null;
              const bccRecipients = parsed.bcc
                ? JSON.stringify((Array.isArray(parsed.bcc) ? parsed.bcc : [parsed.bcc]).flatMap((b) => b.value.map((v) => v.address)))
                : null;

              const isRead = Boolean(message.flags?.has("\\Seen"));
              const isStarred = Boolean(message.flags?.has("\\Flagged"));
              const isDraft = Boolean(message.flags?.has("\\Draft"));

              const sanitizedHtml = sanitizeEmailHtml(parsed.html || null);
              const snippet = (parsed.text || "").replace(/\s+/g, " ").trim().slice(0, 180);

              // Check if message already exists
              const existing = await db.emailMessage.findFirst({
                where: {
                  accountId: account.id,
                  OR: [
                    { uid: message.uid, folderId: targetFolder?.id },
                    parsed.messageId ? { messageId: parsed.messageId } : { uid: message.uid },
                  ],
                },
              });

              let savedMessage;
              if (existing) {
                savedMessage = await db.emailMessage.update({
                  where: { id: existing.id },
                  data: {
                    isRead,
                    isStarred,
                    folderId: targetFolder?.id,
                    uid: message.uid,
                  },
                });
              } else {
                savedMessage = await db.emailMessage.create({
                  data: {
                    accountId: account.id,
                    folderId: targetFolder?.id,
                    messageId: parsed.messageId || `msg_${Date.now()}_${message.uid}@cyraops.com`,
                    threadId: parsed.inReplyTo || parsed.messageId,
                    uid: message.uid,
                    fromName,
                    fromEmail,
                    replyTo: parsed.replyTo?.value?.[0]?.address || null,
                    toRecipients,
                    ccRecipients,
                    bccRecipients,
                    subject: parsed.subject || "(No Subject)",
                    snippet,
                    bodyText: parsed.text || "",
                    bodyHtml: sanitizedHtml || null,
                    isRead,
                    isStarred,
                    isDraft,
                    hasAttachments: Boolean(parsed.attachments && parsed.attachments.length > 0),
                    sentAt: parsed.date || new Date(),
                    receivedAt: message.internalDate || new Date(),
                    sizeBytes: message.size || 0,
                  },
                });
                syncedCount++;
                // A new message can be a trigger: routines watching this sender
                // queue a run through the durable runner. Best effort — mail
                // sync must never fail because a routine could not be queued.
                void triggerOnEmail({ fromAddress: fromEmail }).catch((error) => {
                  console.warn("[Email] Trigger dispatch failed:", error);
                });
              }

              // Handle attachments if any
              if (parsed.attachments && parsed.attachments.length > 0 && !existing) {
                await fs.mkdir(ATTACHMENTS_DIR, { recursive: true });
                for (const att of parsed.attachments) {
                  const filename = att.filename || "attachment";
                  const safeStorageName = `${savedMessage.id}_${Date.now()}_${path.basename(filename)}`;
                  const storagePath = path.join(ATTACHMENTS_DIR, safeStorageName);

                  await fs.writeFile(storagePath, att.content);

                  await db.emailAttachment.create({
                    data: {
                      messageId: savedMessage.id,
                      filename,
                      contentType: att.contentType || "application/octet-stream",
                      sizeBytes: att.size || att.content.length,
                      contentId: att.cid || null,
                      storagePath,
                    },
                  });
                }
              }

              if (message.uid > highestUid) {
                highestUid = message.uid;
              }
            } catch (msgErr) {
              console.error(`Error parsing message UID ${message.uid}:`, msgErr);
            }
          }

          // 3. Deletion / Move Reconciliation: Detect messages expunged from remote folder
          if (activeUids.size > 0 && targetFolder) {
            const localMessages = await db.emailMessage.findMany({
              where: {
                accountId: account.id,
                folderId: targetFolder.id,
                uid: { not: null, lte: highestUid },
              },
              select: { id: true, uid: true },
            });

            const trashFolder = account.folders.find((f) => f.type === "TRASH");
            for (const localMsg of localMessages) {
              if (localMsg.uid && !activeUids.has(localMsg.uid)) {
                // Moved to trash or archived
                await db.emailMessage.update({
                  where: { id: localMsg.id },
                  data: {
                    folderId: trashFolder?.id || targetFolder.id,
                    isArchived: true,
                  },
                });
              }
            }
          }
        }

        // Update sync state
        await db.emailSyncState.upsert({
          where: {
            accountId_folderName: {
              accountId: account.id,
              folderName: folderPath,
            },
          },
          create: {
            accountId: account.id,
            folderName: folderPath,
            uidValidity,
            highestUid,
            lastSyncedAt: new Date(),
          },
          update: {
            uidValidity,
            highestUid,
            lastSyncedAt: new Date(),
          },
        });

        // Update folder stats
        if (targetFolder) {
          const unreadCount = await db.emailMessage.count({
            where: { folderId: targetFolder.id, isRead: false },
          });
          const totalCount = await db.emailMessage.count({
            where: { folderId: targetFolder.id },
          });
          await db.emailFolder.update({
            where: { id: targetFolder.id },
            data: { unreadCount, totalCount },
          });
        }
      } finally {
        lock.release();
      }

      await imapClient.logout();

      await db.emailAccount.update({
        where: { id: account.id },
        data: { lastSyncedAt: new Date(), lastError: null },
      });

      return {
        ok: true,
        syncedCount,
        message: `Successfully synchronized ${syncedCount} new messages from ${folderPath}.`,
        isConfigured: true,
      };
    } catch (err: any) {
      await db.emailAccount.update({
        where: { id: account.id },
        data: { lastError: err.message || String(err) },
      });
      return {
        ok: false,
        syncedCount: 0,
        message: `Sync failed: ${err.message || String(err)}`,
        isConfigured: true,
      };
    }
  }

  /**
   * Send email using GoDaddy SMTP, with pre-send reservation idempotency and remote IMAP Sent folder synchronization
   */
  static async sendEmail(params: SendMailParams) {
    const { config, password } = getMailboxConfig();
    const account = await this.getOrCreateAccount();
    const sentFolder = account.folders.find((f) => f.type === "SENT");

    // 1. Validate / Generate Idempotency Key & Stable Message-ID
    const idempotencyKey = params.idempotencyKey || `send_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    const stableMessageId = `<cyraops_${Date.now()}_${Math.random().toString(36).slice(2, 10)}@cyraops.com>`;

    // 2. Pre-Send Reservation: Check if a record with idempotencyKey already exists
    let reservedMessage = await db.emailMessage.findUnique({
      where: { idempotencyKey },
    });

    if (reservedMessage) {
      // Scenario: Already successfully delivered
      if (reservedMessage.deliveryStatus === "SENT") {
        return {
          messageId: reservedMessage.messageId,
          accepted: [params.to[0]],
          savedMessage: reservedMessage,
          deliveryStatus: "SENT",
          imapAppendStatus: reservedMessage.imapAppendStatus,
          isDuplicatePrevented: true,
        };
      }

      // Scenario: Uncertain outcome — NEVER automatically re-send without manual/administrative reconciliation!
      if (reservedMessage.deliveryStatus === "DELIVERY_UNCERTAIN" || reservedMessage.deliveryStatus === "UNKNOWN") {
        const err: any = new Error(
          "Delivery outcome for this request is uncertain. To prevent duplicate sends, it cannot be automatically re-transmitted. Please verify your mailbox or reconcile status."
        );
        err.statusCode = 409;
        err.deliveryStatus = reservedMessage.deliveryStatus;
        throw err;
      }

      // Scenario: In-flight / SENDING state
      if (reservedMessage.deliveryStatus === "SENDING") {
        const staleThresholdMs = 45 * 1000; // 45s stale threshold
        const isStale = Date.now() - new Date(reservedMessage.updatedAt).getTime() > staleThresholdMs;

        if (!isStale) {
          const err: any = new Error("Email is currently being dispatched (status: SENDING). Please wait.");
          err.statusCode = 409;
          err.deliveryStatus = "SENDING";
          throw err;
        } else {
          // Stale in-flight attempt from a previous crash/timeout:
          // Because SMTP might have accepted the message during flight, mark DELIVERY_UNCERTAIN and block auto-resend!
          reservedMessage = await db.emailMessage.update({
            where: { id: reservedMessage.id },
            data: {
              deliveryStatus: "DELIVERY_UNCERTAIN",
              lastError: "Send attempt timed out while in SENDING status. Delivery outcome uncertain.",
            },
          });
          const err: any = new Error(
            "Previous send attempt timed out in flight. Outcome marked DELIVERY_UNCERTAIN; auto-resend blocked to prevent duplicates."
          );
          err.statusCode = 409;
          err.deliveryStatus = "DELIVERY_UNCERTAIN";
          throw err;
        }
      }

      // Scenario: Previously FAILED — Explicit retry policy allows re-attempting
      if (reservedMessage.deliveryStatus === "FAILED" || reservedMessage.deliveryStatus === "PENDING") {
        reservedMessage = await db.emailMessage.update({
          where: { id: reservedMessage.id },
          data: {
            deliveryStatus: "PENDING",
            lastError: null,
          },
        });
      }
    } else {
      // Create new reservation record in PENDING status
      try {
        reservedMessage = await db.emailMessage.create({
          data: {
            accountId: account.id,
            userId: params.userId || null,
            folderId: sentFolder?.id,
            messageId: stableMessageId,
            threadId: params.inReplyTo || stableMessageId,
            idempotencyKey,
            deliveryStatus: "PENDING",
            sentAttempts: 0,
            fromName: account.name,
            fromEmail: config.email,
            toRecipients: JSON.stringify(params.to),
            ccRecipients: params.cc && params.cc.length > 0 ? JSON.stringify(params.cc) : null,
            bccRecipients: params.bcc && params.bcc.length > 0 ? JSON.stringify(params.bcc) : null,
            subject: params.subject,
            snippet: (params.bodyText || "").slice(0, 180),
            bodyText: params.bodyText || "",
            bodyHtml: params.bodyHtml ? sanitizeEmailHtml(params.bodyHtml) : null,
            isRead: true,
            hasAttachments: Boolean(params.attachments && params.attachments.length > 0),
          },
        });
      } catch (createErr: any) {
        // Concurrent reservation collision: Prisma unique constraint error on idempotencyKey (P2002)
        if (createErr.code === "P2002") {
          const concurrentMsg = await db.emailMessage.findUnique({
            where: { idempotencyKey },
          });
          if (concurrentMsg && concurrentMsg.deliveryStatus === "SENT") {
            return {
              messageId: concurrentMsg.messageId,
              accepted: [params.to[0]],
              savedMessage: concurrentMsg,
              deliveryStatus: "SENT",
              imapAppendStatus: concurrentMsg.imapAppendStatus,
              isDuplicatePrevented: true,
            };
          }
          const err: any = new Error("Concurrent request already reserving this message.");
          err.statusCode = 409;
          err.deliveryStatus = concurrentMsg?.deliveryStatus || "SENDING";
          throw err;
        }
        throw createErr;
      }
    }

    // 3. Transition: PENDING -> SENDING (Atomic claim for this request)
    reservedMessage = await db.emailMessage.update({
      where: { id: reservedMessage.id },
      data: {
        deliveryStatus: "SENDING",
        sentAttempts: { increment: 1 },
      },
    });

    // 4. Validate SMTP Configuration (if not mocked via transportOverride)
    if (!params.transportOverride && (!config.isConfigured || !password)) {
      await db.emailMessage.update({
        where: { id: reservedMessage.id },
        data: {
          deliveryStatus: "FAILED",
          lastError: "GoDaddy SMTP credentials are not configured in environment.",
        },
      });
      throw new Error("GoDaddy SMTP credentials are not configured. Add GODADDY_EMAIL_ADDRESS and GODADDY_EMAIL_PASSWORD to .env.");
    }

    const transporter = params.transportOverride || nodemailer.createTransport({
      host: config.smtpHost,
      port: config.smtpPort,
      secure: config.smtpTls,
      auth: {
        user: config.email,
        pass: password,
      },
    });

    // Format mail options with stable Message-ID
    const mailOptions: SendMailOptions = {
      messageId: stableMessageId,
      from: `"${account.name}" <${config.email}>`,
      to: params.to,
      cc: params.cc && params.cc.length > 0 ? params.cc : undefined,
      bcc: params.bcc && params.bcc.length > 0 ? params.bcc : undefined,
      subject: params.subject,
      text: params.bodyText || "",
      html: params.bodyHtml || undefined,
      inReplyTo: params.inReplyTo,
      references: params.references,
    };

    if (params.attachments && params.attachments.length > 0) {
      mailOptions.attachments = params.attachments.map((att) => ({
        filename: att.filename,
        content: att.content,
        path: att.path,
        contentType: att.contentType,
      }));
    }

    // 5. Pre-compile RFC 822 MIME Buffer for IMAP APPEND
    let rawMimeBuffer: Buffer | null = null;
    try {
      const composer = new MailComposer(mailOptions);
      rawMimeBuffer = await new Promise<Buffer>((resolve, reject) => {
        composer.compile().build((err: any, message: Buffer) => {
          if (err) reject(err);
          else resolve(message);
        });
      });
    } catch (compErr) {
      console.warn("MIME compilation warning:", compErr);
    }

    // 6. Dispatch to SMTP
    let info: any;
    try {
      info = await transporter.sendMail(mailOptions);
    } catch (smtpErr: any) {
      // SMTP dispatch failed (e.g. 5xx rejection, auth error, network abort before response)
      const errorMsg = smtpErr.message || String(smtpErr);
      await db.emailMessage.update({
        where: { id: reservedMessage.id },
        data: {
          deliveryStatus: "FAILED",
          lastError: errorMsg,
        },
      }).catch(() => {});
      throw smtpErr;
    }

    // 7. IMAP APPEND (Separated from SMTP acceptance)
    let imapAppendStatus: "APPENDED" | "FAILED" = "FAILED";
    if (rawMimeBuffer) {
      try {
        const appendResult = await this.appendEmailToSent(rawMimeBuffer);
        if (appendResult.ok) {
          imapAppendStatus = "APPENDED";
        } else {
          console.warn("IMAP Sent append warning:", appendResult.error);
        }
      } catch (appendErr) {
        console.warn("IMAP Sent append error:", appendErr);
      }
    }

    // 8. Update DB Record: SENDING -> SENT
    try {
      const finalizedMessage = await db.emailMessage.update({
        where: { id: reservedMessage.id },
        data: {
          deliveryStatus: "SENT",
          sentAt: new Date(),
          messageId: info.messageId || stableMessageId,
          smtpResponse: JSON.stringify({
            response: info.response || "250 OK",
            accepted: info.accepted || params.to,
            rejected: info.rejected || [],
            messageId: info.messageId,
          }),
          imapAppendStatus,
          lastError: null,
        },
      });

      return {
        ok: true,
        messageId: finalizedMessage.messageId,
        accepted: info.accepted || params.to,
        savedMessage: finalizedMessage,
        deliveryStatus: "SENT",
        imapAppendStatus,
        isDuplicatePrevented: false,
      };
    } catch (postSmtpDbErr: any) {
      // Scenario D: PostgreSQL fails after SMTP acceptance!
      console.error("CRITICAL: Failed to update EmailMessage to SENT after SMTP delivery:", postSmtpDbErr);
      try {
        await db.emailMessage.update({
          where: { id: reservedMessage.id },
          data: {
            deliveryStatus: "DELIVERY_UNCERTAIN",
            lastError: `Database write failure after SMTP delivery: ${postSmtpDbErr.message || String(postSmtpDbErr)}`,
          },
        });
      } catch { /* ignore secondary DB failure */ }

      return {
        ok: true,
        messageId: info.messageId || stableMessageId,
        accepted: info.accepted || params.to,
        deliveryStatus: "DELIVERY_UNCERTAIN",
        imapAppendStatus,
        warning: "Email was accepted by SMTP, but database record update encountered an error. Outcome marked DELIVERY_UNCERTAIN.",
        isDuplicatePrevented: false,
      };
    }
  }

  /**
   * Reconcile an uncertain email message delivery status
   */
  static async reconcileUncertainMessage(idOrKey: string, resolution: "MARK_SENT" | "MARK_FAILED") {
    const msg = await db.emailMessage.findFirst({
      where: {
        OR: [{ id: idOrKey }, { idempotencyKey: idOrKey }],
      },
    });

    if (!msg) {
      throw new Error(`Message not found: ${idOrKey}`);
    }

    if (msg.deliveryStatus !== "DELIVERY_UNCERTAIN" && msg.deliveryStatus !== "SENDING") {
      return msg;
    }

    const newStatus = resolution === "MARK_SENT" ? "SENT" : "FAILED";
    return db.emailMessage.update({
      where: { id: msg.id },
      data: {
        deliveryStatus: newStatus,
        lastError: resolution === "MARK_SENT" ? null : "Manually reconciled as failed.",
        sentAt: resolution === "MARK_SENT" ? (msg.sentAt || new Date()) : msg.sentAt,
      },
    });
  }
}
