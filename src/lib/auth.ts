import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { db } from "@/lib/db";

export const SESSION_COOKIE = "company_session";
export const SESSION_DURATION_DAYS = 14;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

function cookieValue(header: string | null, name: string) {
  return header?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1);
}
function decodeToken(token: string) {
  try { return decodeURIComponent(token); } catch { return ""; }
}

export async function userFromRequest(request: NextRequest | Request) {
  const token = cookieValue(request.headers.get("cookie"), SESSION_COOKIE);
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(decodeToken(token)) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.disabledAt) {
    if (session) await db.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  return session.user;
}

export async function currentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date() || session.user.disabledAt) return null;
  return session.user;
}

export async function createSession(userId: string) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);
  await db.session.create({ data: { tokenHash: sha256(token), userId, expiresAt } });
  return { token, expiresAt };
}

export function cookieOptions(expires: Date, request?: NextRequest | Request) {
  const protocol = request?.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ?? (request ? new URL(request.url).protocol.replace(":", "") : "");
  const secure = process.env.COOKIE_SECURE === "true" || protocol === "https";
  return { httpOnly: true, secure, sameSite: "lax" as const, path: "/", expires };
}

/** "www.example.com" and "example.com" are the same site for origin checks. */
function normalizeHost(value: string | null | undefined): string {
  if (!value) return "";
  return value.toLowerCase().trim().replace(/:\d+$/, "").replace(/^www\./, "");
}

export function sameOrigin(request: NextRequest | Request) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer");
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const secFetchSite = request.headers.get("sec-fetch-site");

  if (secFetchSite === "same-origin" || secFetchSite === "none") return true;

  if (!origin && !referer) {
    // No Origin, no Referer and no Sec-Fetch-Site: this cannot have come from
    // our own pages, so fail closed. The old NODE_ENV escape hatch made CSRF
    // protection environment-dependent, which is how 10 mutating routes let an
    // origin-less request through in any non-production deploy.
    return false;
  }

  try {
    if (origin) {
      const originHost = new URL(origin).host;
      if (normalizeHost(originHost) === normalizeHost(host)) return true;
      const isLoopbackOrigin = originHost.startsWith("localhost") || originHost.startsWith("127.0.0.1") || originHost.startsWith("0.0.0.0");
      const isLoopbackHost = host ? (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0")) : false;
      if (isLoopbackOrigin && isLoopbackHost) return true;
    }
    if (referer) {
      const refererHost = new URL(referer).host;
      if (normalizeHost(refererHost) === normalizeHost(host)) return true;
      const isLoopbackReferer = refererHost.startsWith("localhost") || refererHost.startsWith("127.0.0.1") || refererHost.startsWith("0.0.0.0");
      const isLoopbackHost = host ? (host.startsWith("localhost") || host.startsWith("127.0.0.1") || host.startsWith("0.0.0.0")) : false;
      if (isLoopbackReferer && isLoopbackHost) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export async function logActivity(data: { action: string; entity: string; entityId?: string; summary: string; userId: string; projectId?: string; taskId?: string }) {
  return db.activity.create({ data });
}

export const publicUserSelect = { id: true, name: true, email: true, role: true, avatarUrl: true, title: true } as const;
