/**
 * Client for the Cyraops computer service (headless Chromium on a dedicated VM).
 *
 * The service is only reachable from Cyraops' outbound IPs and requires a
 * bearer token, so nothing here needs to be exposed to browsers.
 */

export type ComputerAction =
  | "navigate"
  | "extract"
  | "click"
  | "type"
  | "back"
  | "scroll"
  | "screenshot"
  // Human takeover
  | "clickAt"
  | "key"
  | "typeText";

export interface ComputerResult {
  ok: boolean;
  error?: string;
  url?: string;
  title?: string;
  text?: string;
  imageBase64?: string;
  contentType?: string;
  width?: number;
  height?: number;
}

function baseUrl(): string {
  return (process.env.COMPUTER_SERVICE_URL || "").trim().replace(/\/+$/, "");
}

function token(): string {
  return (process.env.COMPUTER_SERVICE_TOKEN || "").trim();
}

export function isComputerServiceConfigured(): boolean {
  return Boolean(baseUrl() && token());
}

/** A stable per-user session key so a person's assistant keeps one browser. */
export function computerSessionKey(userId: string, agentSlug?: string): string {
  return `${userId}:${agentSlug || "assistant"}`;
}

/**
 * Try the person's own browser before anything hosted.
 *
 * The key is "userId:agent", which is how we know whose browser to ask. A hosted
 * browser is only used when nobody is connected — that is the expensive path.
 */
export async function computerActLocal(
  key: string,
  action: ComputerAction,
  payload: { url?: string; selector?: string; text?: string } = {}
): Promise<ComputerResult | null> {
  const userId = key.split(":")[0];
  if (!userId) return null;
  const { isLocalBrowserConnected, requestLocalAction } = await import("./local-bridge");
  if (!isLocalBrowserConnected(userId)) return null;
  const mapped = action === "typeText" ? "type" : action === "clickAt" ? "click" : action;
  const allowed = ["navigate", "click", "type", "screenshot", "extract"];
  if (!allowed.includes(mapped)) return null;
  const result = await requestLocalAction(userId, {
    action: mapped as "navigate" | "click" | "type" | "screenshot" | "extract",
    url: payload.url,
    selector: payload.selector,
    text: payload.text,
  });
  return result as ComputerResult;
}

export async function computerAct(
  key: string,
  action: ComputerAction,
  payload: { url?: string; selector?: string; text?: string; deltaY?: number; x?: number; y?: number } = {}
): Promise<ComputerResult> {
  // The person's own browser first: free, and already signed in to what they need.
  const local = await computerActLocal(key, action, payload);
  if (local) return local;

  if (!isComputerServiceConfigured()) {
    return {
      ok: false,
      error:
        "No browser is available. Turn on 'Use my browser' on the Cyraops tab, or ask an owner to configure a hosted browser.",
    };
  }

  try {
    const response = await fetch(`${baseUrl()}/act`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token()}`,
      },
      body: JSON.stringify({ key, action, ...payload }),
      signal: AbortSignal.timeout(45_000),
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return { ok: false, error: typeof data?.error === "string" ? data.error : `Computer service returned HTTP ${response.status}` };
    }
    return { ok: true, ...data };
  } catch (err: any) {
    return { ok: false, error: `Computer service unreachable: ${err?.message || "network error"}` };
  }
}

export async function computerDestroy(key: string): Promise<void> {
  if (!isComputerServiceConfigured()) return;
  try {
    await fetch(`${baseUrl()}/session/${encodeURIComponent(key)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token()}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    // best effort
  }
}
