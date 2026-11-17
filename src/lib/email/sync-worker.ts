import { EmailService } from "./service";
import { getMailboxConfig } from "./config";

class EmailSyncWorker {
  private timer: NodeJS.Timeout | null = null;
  private isSyncing = false;
  private backoffMultiplier = 1;
  private defaultIntervalMs = 5 * 60 * 1000; // 5 minutes default
  private minIntervalMs = 60 * 1000; // 1 minute
  private maxIntervalMs = 30 * 60 * 1000; // 30 minutes max backoff
  private lastRunAt: Date | null = null;
  private lastResult: { ok: boolean; message: string; count: number } | null = null;

  start() {
    if (this.timer) return;

    const intervalEnv = parseInt(process.env.EMAIL_SYNC_INTERVAL_MS || "", 10);
    const interval = !isNaN(intervalEnv) && intervalEnv >= this.minIntervalMs
      ? intervalEnv
      : this.defaultIntervalMs;

    console.log(`[EmailSyncWorker] Starting periodic background sync every ${Math.round(interval / 1000)}s`);

    // Initial background sync check after server boots
    setTimeout(() => void this.syncCycle(), 12000);

    this.timer = setInterval(() => void this.syncCycle(), interval);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getStatus() {
    return {
      isRunning: Boolean(this.timer),
      isSyncing: this.isSyncing,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      backoffMultiplier: this.backoffMultiplier,
    };
  }

  async syncCycle() {
    if (this.isSyncing) {
      return;
    }

    const { config } = getMailboxConfig();
    if (!config.isConfigured) {
      this.lastResult = { ok: false, message: "GoDaddy mailbox credentials pending configuration", count: 0 };
      return;
    }

    this.isSyncing = true;
    this.lastRunAt = new Date();

    try {
      const inboxResult = await EmailService.syncMailbox({ folderPath: "INBOX", limit: 50 });
      if (inboxResult.ok) {
        this.backoffMultiplier = 1;
        this.lastResult = { ok: true, message: inboxResult.message, count: inboxResult.syncedCount };
      } else {
        this.backoffMultiplier = Math.min(6, this.backoffMultiplier * 2);
        this.lastResult = { ok: false, message: inboxResult.message, count: 0 };
      }
    } catch (err: any) {
      this.backoffMultiplier = Math.min(6, this.backoffMultiplier * 2);
      this.lastResult = { ok: false, message: err.message || String(err), count: 0 };
    } finally {
      this.isSyncing = false;
    }
  }
}

export const emailSyncWorker = new EmailSyncWorker();

