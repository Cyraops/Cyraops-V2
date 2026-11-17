import { hash } from "bcryptjs";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createSession, cookieOptions, SESSION_COOKIE, sameOrigin, sha256 } from "@/lib/auth";
import { emailSchema, jsonError, nameSchema, passwordSchema } from "@/lib/validators";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");

  if (token) {
    const tokenHash = sha256(token);
    const record = await db.passwordSetupToken.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, name: true, email: true, disabledAt: true } } },
    });

    if (!record || record.usedAt || record.expiresAt < new Date() || record.user.disabledAt) {
      return jsonError("Invalid or expired setup token", 400);
    }

    return Response.json({
      valid: true,
      user: {
        name: record.user.name,
        email: record.user.email,
      },
    });
  }

  return Response.json({ initialized: Boolean(await db.workspace.findUnique({ where: { id: "main" } })) });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const body = await request.json().catch(() => null);

  // Flow A: Employee Password Setup via Invitation Token
  if (body?.token) {
    if (typeof body.token !== "string" || !body.token.trim()) {
      return jsonError("Valid setup token required", 400);
    }
    const token = body.token.trim();
    const tokenHash = sha256(token);

    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const keys = [sha256(`ip:${ip}:setup`), sha256(`token:${tokenHash}`)];
    const now = new Date();
    const windowEnds = new Date(Date.now() + 15 * 60 * 1000);
    const buckets = await db.authRateLimit.findMany({ where: { key: { in: keys } } });

    if (buckets.some((bucket) => bucket.windowEnds > now && bucket.hits >= 10)) {
      return jsonError("Too many attempts. Try again in 15 minutes.", 429);
    }

    const record = await db.passwordSetupToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!record || record.usedAt || record.expiresAt < now || record.user.disabledAt) {
      await Promise.all(keys.map((key) => {
        const bucket = buckets.find((entry) => entry.key === key);
        return db.authRateLimit.upsert({
          where: { key },
          create: { key, hits: 1, windowEnds },
          update: bucket && bucket.windowEnds > now ? { hits: { increment: 1 } } : { hits: 1, windowEnds },
        });
      }));
      return jsonError("Setup link is invalid or has expired", 400);
    }

    const parsedPassword = passwordSchema.safeParse(body.password);
    if (!parsedPassword.success) {
      return jsonError(parsedPassword.error.issues[0]?.message ?? "Invalid password", 400);
    }

    const passwordHash = await hash(parsedPassword.data, 12);

    try {
      const updatedUser = await db.$transaction(async (tx) => {
        const currentToken = await tx.passwordSetupToken.findUnique({
          where: { id: record.id },
        });

        if (!currentToken || currentToken.usedAt || currentToken.expiresAt < new Date()) {
          throw new Error("TOKEN_ALREADY_USED");
        }

        await tx.passwordSetupToken.update({
          where: { id: record.id },
          data: { usedAt: new Date() },
        });

        return tx.user.update({
          where: { id: record.userId },
          data: {
            passwordHash,
            mustChangePassword: false,
          },
        });
      });

      // Invalidate any other outstanding setup tokens for this user
      await db.passwordSetupToken.deleteMany({
        where: { userId: updatedUser.id, usedAt: null },
      });

      await db.authRateLimit.deleteMany({ where: { key: { in: keys } } });

      const session = await createSession(updatedUser.id);
      const response = NextResponse.json({
        ok: true,
        user: { id: updatedUser.id, name: updatedUser.name, email: updatedUser.email },
      });
      response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt, request));
      return response;
    } catch (err: any) {
      if (err?.message === "TOKEN_ALREADY_USED") {
        return jsonError("This setup link has already been used", 409);
      }
      return jsonError("Could not complete account setup. Please try again.", 500);
    }
  }

  // Flow B: Initial Workspace Setup
  if (!process.env.INITIAL_SETUP_KEY) return jsonError("Owner setup is disabled until INITIAL_SETUP_KEY is configured", 503);
  const parsed = z.object({ key: z.string(), name: nameSchema, email: emailSchema, password: passwordSchema }).safeParse(body);
  if (!parsed.success || parsed.data.key !== process.env.INITIAL_SETUP_KEY) return jsonError("Check the setup key and required fields", 400);

  const hashedPassword = await hash(parsed.data.password, 12);
  const userId = await db.$transaction(async (tx) => {
    if (await tx.workspace.findUnique({ where: { id: "main" } })) throw new Error("INITIALIZED");
    const user = await tx.user.create({
      data: {
        name: parsed.data.name,
        email: parsed.data.email,
        passwordHash: hashedPassword,
        mustChangePassword: false,
        role: "OWNER",
      },
    });
    await tx.workspace.create({
      data: {
        id: "main",
        ownerId: user.id,
        loginEmail: parsed.data.email,
        loginPasswordHash: hashedPassword,
      },
    });
    await tx.activity.create({ data: { action: "created", entity: "workspace", summary: "initialized the company workspace", userId: user.id } });
    return user.id;
  }, { isolationLevel: "Serializable" }).catch((error: unknown) => error instanceof Error && error.message === "INITIALIZED" || typeof error === "object" && error !== null && "code" in error && (error.code === "P2002" || error.code === "P2034") ? null : Promise.reject(error));

  if (!userId) return jsonError("Workspace has already been initialized", 409);
  const session = await createSession(userId);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, session.token, cookieOptions(session.expiresAt, request));
  return response;
}
