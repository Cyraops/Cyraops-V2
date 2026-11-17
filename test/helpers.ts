import { NextRequest } from "next/server";
import { db } from "../src/lib/db";
import { createSession } from "../src/lib/auth";

export { db };

/** Wipes every table so each job starts from a clean slate. */
export async function resetDb() {
  await db.$executeRawUnsafe(`
    DO $$ DECLARE r RECORD; BEGIN
      FOR r IN (
        SELECT tablename FROM pg_tables
        WHERE schemaname='public'
          -- Preserve Prisma's own bookkeeping. Truncating it erases the record of
          -- which migrations ran, so the next prisma migrate deploy tries to
          -- re-apply the initial migration against a schema that already exists
          -- and marks it permanently failed. Tests had no business clearing it.
          AND tablename <> '_prisma_migrations'
      ) LOOP
        EXECUTE 'TRUNCATE TABLE public.' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE';
      END LOOP;
    END $$;
  `);
}

export async function seedUsers() {
  const owner = await db.user.create({
    data: { name: "Tanveer (Owner)", email: "owner@test.cyraops.com", role: "OWNER", passwordHash: "x" },
  });
  const member = await db.user.create({
    data: { name: "Akshat (Member)", email: "member@test.cyraops.com", role: "MEMBER", passwordHash: "x" },
  });
  return { owner, member };
}

async function cookieFor(userId: string) {
  const { token } = await createSession(userId);
  return `company_session=${token}`;
}

/**
 * Calls a route handler in-process with a real NextRequest, exactly as the HTTP
 * layer would. This is the fastest possible end-to-end: a real request object,
 * a real auth check, a real database write — no browser, no server, no prod.
 */
export async function invoke(
  handler: (request: NextRequest, context: any) => Promise<Response>,
  path: string,
  options: {
    method?: string;
    body?: unknown;
    userId?: string;
    params?: Record<string, string>;
    headers?: Record<string, string>;
    /** false = behave like a server-to-server caller (no Origin, no Sec-Fetch-Site). */
    sameSite?: boolean;
  } = {}
) {
  const url = new URL(`https://test.local${path}`);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.sameSite !== false) {
    headers.origin = "https://test.local";
    headers["sec-fetch-site"] = "same-origin";
  }
  if (options.userId) headers.cookie = await cookieFor(options.userId);
  Object.assign(headers, options.headers ?? {});

  const request = new NextRequest(url, {
    method: options.method ?? "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const context = { params: Promise.resolve(options.params ?? {}) };
  const response = await handler(request, context);
  const text = await response.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body };
}
