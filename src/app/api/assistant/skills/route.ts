import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { listHarnessSkills } from "@/lib/harness/skills";

/**
 * Read-only catalog of the skill capabilities mounted in the harness boot.
 *
 * Owner-only: requires a signed-in user (the assistant API surface is the
 * caller's own); the list itself is a static, identical-for-everyone catalog
 * compiled from the vendored dsh-skill package metadata, so there is no
 * per-user data to scope. Returns `[{ id, name, description }]`.
 */
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  return NextResponse.json({ skills: listHarnessSkills() });
}
