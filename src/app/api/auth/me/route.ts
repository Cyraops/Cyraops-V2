import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { ensureWorkspaceForUser } from "@/lib/workspace-provision";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  // Wave 1b safety net: every app load re-provisions the member's owned
  // workspace (idempotent). This closes the gap for sessions created before
  // this code shipped, and for any login-time provisioning that failed.
  await ensureWorkspaceForUser({ db, userId: user.id }).catch((error: unknown) => {
    console.warn("[auth/me] workspace provisioning failed:", error);
  });
  const { passwordHash, ...safeUser } = user;
  return Response.json({ user: safeUser });
}
