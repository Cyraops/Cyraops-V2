import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { cookieOptions, sameOrigin, SESSION_COOKIE, sha256 } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, "", cookieOptions(new Date(0), request));
  return response;
}
