import { chromium, Browser, BrowserContext, Page } from "playwright";
import fs from "node:fs";
import path from "node:path";
import dns from "node:dns/promises";

export interface BrowserActivityItem {
  id: string;
  timestamp: string;
  action: string;
  url?: string;
  details?: string;
  actor: "AGENT" | "USER" | "SYSTEM";
}

export interface BrowserRuntimeState {
  url: string;
  title: string;
  screenshotUrl: string | null;
  status: "IDLE" | "NAVIGATING" | "INTERACTING" | "HUMAN_TAKEOVER" | "ERROR";
  history: BrowserActivityItem[];
  isHumanTakeover: boolean;
  activeTaskId?: string;
  userId: string;
}

interface UserSession {
  userId: string;
  context: BrowserContext;
  page: Page;
  currentUrl: string;
  currentTitle: string;
  currentScreenshot: string | null;
  status: "IDLE" | "NAVIGATING" | "INTERACTING" | "HUMAN_TAKEOVER" | "ERROR";
  history: BrowserActivityItem[];
  isHumanTakeover: boolean;
  activeTaskId?: string;
  lastActivity: number;
}

// ============================================================================
// SECURITY: SSRF & PRIVATE NETWORK DESTINATION VALIDATOR
// ============================================================================
export function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.replace(/^\[|\]$/g, "").toLowerCase();

  // Explicit loopbacks & wildcard
  if (ip === "127.0.0.1" || ip === "0.0.0.0" || ip === "::1" || ip === "::" || ip === "localhost") return true;

  // IPv6 mapped IPv4 (e.g. ::ffff:127.0.0.1 or ::ffff:7f00:1)
  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice(7);
    if (isPrivateIp(mapped)) return true;
    if (mapped.includes(":")) {
      const [h1, h2] = mapped.split(":");
      const p1 = parseInt(h1.slice(0, 2), 16);
      const p2 = parseInt(h1.slice(2, 4), 16);
      const p3 = parseInt(h2.length <= 2 ? "0" : h2.slice(0, h2.length - 2), 16);
      const p4 = parseInt(h2.slice(-2), 16);
      if (isPrivateIp(`${p1}.${p2}.${p3}.${p4}`)) return true;
    }
  }

  // IPv4 breakdown
  const parts = ip.split(".").map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    // 127.0.0.0/8 (Loopback)
    if (parts[0] === 127) return true;
    // 0.0.0.0/8 (Current network)
    if (parts[0] === 0) return true;
    // 10.0.0.0/8 (RFC 1918 Private)
    if (parts[0] === 10) return true;
    // 172.16.0.0/12 (RFC 1918 Private)
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    // 192.168.0.0/16 (RFC 1918 Private)
    if (parts[0] === 192 && parts[1] === 168) return true;
    // 169.254.0.0/16 (Link-local & AWS/GCP/Azure metadata 169.254.169.254)
    if (parts[0] === 169 && parts[1] === 254) return true;
    // 100.64.0.0/10 (Carrier-grade NAT)
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    // 224.0.0.0/4 (Multicast)
    if (parts[0] >= 224 && parts[0] <= 239) return true;
    // 240.0.0.0/4 & 255.255.255.255 (Reserved / Broadcast)
    if (parts[0] >= 240) return true;
  }

  // IPv6 unique local (fc00::/7) or link-local (fe80::/10)
  if (
    ip.startsWith("fc00:") ||
    ip.startsWith("fd") ||
    ip.startsWith("fe80:") ||
    ip.startsWith("fe90:") ||
    ip.startsWith("fea0:") ||
    ip.startsWith("feb0:")
  ) {
    return true;
  }

  return false;
}

export async function validateDestinationUrl(rawUrl: string): Promise<{ valid: boolean; normalizedUrl?: string; error?: string }> {
  let parsed: URL;
  try {
    let formatted = rawUrl.trim();
    // Only prefix https:// if no URI scheme is present
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(formatted)) {
      formatted = `https://${formatted}`;
    }
    parsed = new URL(formatted);
  } catch {
    return { valid: false, error: "Invalid URL syntax" };
  }

  // Enforce http / https scheme only
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, error: `Unauthorized URL protocol: "${parsed.protocol}". Only HTTP and HTTPS are permitted.` };
  }

  const hostname = parsed.hostname.toLowerCase();

  // Controlled test-only allowlist: enabled solely during local automated browser tests on port 4567
  if (
    process.env.CYRAOPS_TEST_ALLOW_LOCAL === "true" &&
    (hostname === "127.0.0.1" || hostname === "localhost") &&
    parsed.port === "4567"
  ) {
    return { valid: true, normalizedUrl: parsed.toString() };
  }

  // Explicit blocked hosts
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    hostname === "::1" ||
    hostname === "metadata.google.internal" ||
    hostname === "instance-data"
  ) {
    return { valid: false, error: `SSRF Protection: Access to localhost or cloud metadata host "${hostname}" is prohibited.` };
  }

  if (isPrivateIp(hostname)) {
    return { valid: false, error: `SSRF Protection: Access to private network IP "${hostname}" is prohibited.` };
  }

  // Resolve hostname DNS to check underlying IP addresses
  try {
    const lookup = await dns.lookup(hostname.replace(/^\[|\]$/g, ""), { all: true });
    for (const entry of lookup) {
      if (isPrivateIp(entry.address)) {
        return { valid: false, error: `SSRF Protection: Domain "${hostname}" resolves to private address ${entry.address}. Request blocked.` };
      }
    }
  } catch (err: any) {
    // If domain doesn't resolve in offline/test mode, check hostname directly
    if (err?.code === "ENOTFOUND") {
      return { valid: false, error: `Cannot resolve destination host: ${hostname}` };
    }
  }

  return { valid: true, normalizedUrl: parsed.toString() };
}

// ============================================================================
// BROWSER RUNTIME MANAGER (ISOLATED MULTI-SESSION PLAYWRIGHT)
// ============================================================================
class BrowserRuntimeManager {
  private browser: Browser | null = null;
  private sessions = new Map<string, UserSession>();
  private screenshotsDir: string;

  constructor() {
    this.screenshotsDir = path.join(process.cwd(), "public", "browser-screenshots");
    if (!fs.existsSync(this.screenshotsDir)) {
      fs.mkdirSync(this.screenshotsDir, { recursive: true });
    }
  }

  private async getBrowser(): Promise<Browser> {
    if (!this.browser) {
      this.browser = await chromium.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });
    }
    return this.browser;
  }

  public async getSession(userId: string): Promise<UserSession> {
    const existing = this.sessions.get(userId);
    if (existing && !existing.page.isClosed()) {
      existing.lastActivity = Date.now();
      return existing;
    }

    const browser = await this.getBrowser();
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 CyraopsAgent/1.0",
      ignoreHTTPSErrors: true,
    });

    const page = await context.newPage();

    // Security Route Filter: intercept all navigation, subresources, and redirects to block SSRF
    await page.route("**/*", async (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url.startsWith("about:")) {
        await route.continue();
        return;
      }
      const check = await validateDestinationUrl(url);
      if (!check.valid) {
        console.warn(`[SSRF Blocked Request] Blocked ${route.request().resourceType()} to: ${url} (${check.error})`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.continue();
    });

    const session: UserSession = {
      userId,
      context,
      page,
      currentUrl: "about:blank",
      currentTitle: "Ready",
      currentScreenshot: null,
      status: "IDLE",
      history: [],
      isHumanTakeover: false,
      lastActivity: Date.now(),
    };

    this.sessions.set(userId, session);
    return session;
  }

  private addActivity(session: UserSession, action: string, actor: "AGENT" | "USER" | "SYSTEM", url?: string, details?: string) {
    session.history.unshift({
      id: Math.random().toString(36).slice(2, 9),
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      action,
      actor,
      url,
      details,
    });
    if (session.history.length > 30) session.history.pop();
  }

  public async captureScreenshot(session: UserSession): Promise<string | null> {
    try {
      const filename = `screen-${session.userId.slice(-6)}-${Date.now()}.jpg`;
      const filepath = path.join(this.screenshotsDir, filename);
      await session.page.screenshot({ path: filepath, quality: 75, type: "jpeg" });
      session.currentScreenshot = `/browser-screenshots/${filename}`;
      return session.currentScreenshot;
    } catch (e) {
      return session.currentScreenshot;
    }
  }

  // 1. Navigate
  public async navigate(
    userId: string,
    url: string,
    options?: { taskId?: string; actor?: "AGENT" | "USER" }
  ) {
    const session = await this.getSession(userId);
    const actor = options?.actor || (session.isHumanTakeover ? "USER" : "AGENT");

    // Check takeover guard
    if (session.isHumanTakeover && actor === "AGENT") {
      throw new Error("Action rejected: Browser is under human control. Release control before agent execution.");
    }

    // SSRF Validation
    const validation = await validateDestinationUrl(url);
    if (!validation.valid) {
      session.status = "ERROR";
      this.addActivity(session, "Navigation Blocked", actor, url, validation.error);
      return { success: false, error: validation.error, state: this.getState(userId) };
    }

    session.status = "NAVIGATING";
    session.activeTaskId = options?.taskId || session.activeTaskId;

    try {
      const target = validation.normalizedUrl!;
      await session.page.goto(target, { waitUntil: "domcontentloaded", timeout: 25000 });
      session.currentUrl = session.page.url();
      session.currentTitle = await session.page.title();

      await session.page.waitForTimeout(600);
      await this.captureScreenshot(session);

      session.status = session.isHumanTakeover ? "HUMAN_TAKEOVER" : "IDLE";
      this.addActivity(session, "Navigated", actor, session.currentUrl, `Title: ${session.currentTitle}`);

      return {
        success: true,
        url: session.currentUrl,
        title: session.currentTitle,
        screenshotUrl: session.currentScreenshot,
        state: this.getState(userId),
      };
    } catch (err: any) {
      session.status = "ERROR";
      this.addActivity(session, "Navigation Error", actor, url, err?.message);
      return {
        success: false,
        error: err?.message || "Navigation failed",
        state: this.getState(userId),
      };
    }
  }

  // 2. Click Element
  public async click(
    userId: string,
    target: string | { x: number; y: number },
    actor: "AGENT" | "USER" = "AGENT"
  ) {
    const session = await this.getSession(userId);
    if (session.isHumanTakeover && actor === "AGENT") {
      throw new Error("Action rejected: Browser under human takeover.");
    }

    session.status = "INTERACTING";
    try {
      if (typeof target === "object" && "x" in target && "y" in target) {
        await session.page.mouse.click(target.x, target.y);
        this.addActivity(session, "Clicked at Coordinates", actor, session.currentUrl, `(${target.x}, ${target.y})`);
      } else {
        // Try selector, text, or role locator
        const locator = session.page.locator(target).first();
        await locator.click({ timeout: 8000 });
        this.addActivity(session, "Clicked Element", actor, session.currentUrl, target);
      }

      await session.page.waitForTimeout(600);
      session.currentUrl = session.page.url();
      session.currentTitle = await session.page.title();
      await this.captureScreenshot(session);

      session.status = session.isHumanTakeover ? "HUMAN_TAKEOVER" : "IDLE";
      return { success: true, state: this.getState(userId) };
    } catch (err: any) {
      session.status = "ERROR";
      this.addActivity(session, "Click Failed", actor, session.currentUrl, err?.message);
      return { success: false, error: err?.message, state: this.getState(userId) };
    }
  }

  // 3. Type text into input
  public async typeText(
    userId: string,
    selector: string,
    text: string,
    actor: "AGENT" | "USER" = "AGENT"
  ) {
    const session = await this.getSession(userId);
    if (session.isHumanTakeover && actor === "AGENT") {
      throw new Error("Action rejected: Browser under human takeover.");
    }

    session.status = "INTERACTING";
    try {
      const locator = session.page.locator(selector).first();
      await locator.fill(text, { timeout: 8000 });
      await session.page.waitForTimeout(400);
      await this.captureScreenshot(session);

      session.status = session.isHumanTakeover ? "HUMAN_TAKEOVER" : "IDLE";
      // Mask potentially sensitive input in activity log
      const safeText = selector.toLowerCase().includes("pass") || selector.toLowerCase().includes("token") ? "***" : text;
      this.addActivity(session, "Entered Text", actor, session.currentUrl, `Target: ${selector} | Value: ${safeText}`);

      return { success: true, state: this.getState(userId) };
    } catch (err: any) {
      session.status = "ERROR";
      this.addActivity(session, "Type Failed", actor, session.currentUrl, err?.message);
      return { success: false, error: err?.message, state: this.getState(userId) };
    }
  }

  // 4. Select Option in dropdown
  public async selectOption(userId: string, selector: string, value: string, actor: "AGENT" | "USER" = "AGENT") {
    const session = await this.getSession(userId);
    if (session.isHumanTakeover && actor === "AGENT") {
      throw new Error("Action rejected: Browser under human takeover.");
    }
    try {
      await session.page.locator(selector).first().selectOption(value, { timeout: 8000 });
      await session.page.waitForTimeout(400);
      await this.captureScreenshot(session);
      this.addActivity(session, "Selected Option", actor, session.currentUrl, `${selector} = ${value}`);
      return { success: true, state: this.getState(userId) };
    } catch (err: any) {
      return { success: false, error: err?.message, state: this.getState(userId) };
    }
  }

  // 5. Scroll page
  public async scroll(userId: string, direction: "up" | "down", amount: number = 400) {
    const session = await this.getSession(userId);
    try {
      const deltaY = direction === "down" ? amount : -amount;
      await session.page.mouse.wheel(0, deltaY);
      await session.page.waitForTimeout(300);
      await this.captureScreenshot(session);
      return { success: true, state: this.getState(userId) };
    } catch (err: any) {
      return { success: false, error: err?.message, state: this.getState(userId) };
    }
  }

  // 6. Navigation Controls: Back / Forward / Refresh
  public async goBack(userId: string) {
    const session = await this.getSession(userId);
    try {
      await session.page.goBack({ timeout: 10000 });
      session.currentUrl = session.page.url();
      session.currentTitle = await session.page.title();
      await this.captureScreenshot(session);
      this.addActivity(session, "Navigated Back", "USER", session.currentUrl);
      return { success: true, state: this.getState(userId) };
    } catch (e: any) {
      return { success: false, error: e?.message, state: this.getState(userId) };
    }
  }

  public async goForward(userId: string) {
    const session = await this.getSession(userId);
    try {
      await session.page.goForward({ timeout: 10000 });
      session.currentUrl = session.page.url();
      session.currentTitle = await session.page.title();
      await this.captureScreenshot(session);
      this.addActivity(session, "Navigated Forward", "USER", session.currentUrl);
      return { success: true, state: this.getState(userId) };
    } catch (e: any) {
      return { success: false, error: e?.message, state: this.getState(userId) };
    }
  }

  // 7. Extract Visible Content
  public async extractContent(userId: string, selector?: string) {
    const session = await this.getSession(userId);
    try {
      const title = await session.page.title();
      const url = session.page.url();
      const content = await session.page.evaluate((sel) => {
        const target = sel ? document.querySelector(sel) : document.body;
        return (target as HTMLElement)?.innerText?.slice(0, 10000) || "";
      }, selector);

      this.addActivity(session, "Extracted Content", "AGENT", url, `Extracted ${content.length} characters`);
      return { success: true, data: { title, url, content } };
    } catch (err: any) {
      return { success: false, error: err?.message };
    }
  }

  // 8. Human Takeover Workflow
  public async takeover(userId: string, enable: boolean): Promise<BrowserRuntimeState> {
    const session = await this.getSession(userId);
    session.isHumanTakeover = enable;
    session.status = enable ? "HUMAN_TAKEOVER" : "IDLE";

    if (!enable) {
      // Rechecking current state when returning control to agent
      session.currentUrl = session.page.url();
      session.currentTitle = await session.page.title();
      await this.captureScreenshot(session);
      this.addActivity(
        session,
        "Control Returned to Agent",
        "SYSTEM",
        session.currentUrl,
        `Revalidated page: "${session.currentTitle}"`
      );
    } else {
      this.addActivity(session, "Human Takeover Activated", "USER", session.currentUrl, "Agent actions paused.");
    }

    return this.getState(userId);
  }

  // 9. Get State
  public getState(userId: string): BrowserRuntimeState {
    const session = this.sessions.get(userId);
    if (!session) {
      return {
        url: "about:blank",
        title: "Ready",
        screenshotUrl: null,
        status: "IDLE",
        history: [],
        isHumanTakeover: false,
        userId,
      };
    }

    return {
      url: session.currentUrl,
      title: session.currentTitle,
      screenshotUrl: session.currentScreenshot,
      status: session.status,
      history: session.history,
      isHumanTakeover: session.isHumanTakeover,
      activeTaskId: session.activeTaskId,
      userId,
    };
  }

  // 10. Close Session / Browser
  public async closeSession(userId: string): Promise<void> {
    const session = this.sessions.get(userId);
    if (session) {
      await session.context.close().catch(() => {});
      this.sessions.delete(userId);
    }
  }

  public async closeAll(): Promise<void> {
    for (const [userId] of this.sessions) {
      await this.closeSession(userId);
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }
}

export const browserRuntime = new BrowserRuntimeManager();
