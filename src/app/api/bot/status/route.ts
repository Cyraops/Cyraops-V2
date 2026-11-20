import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";
import { resolveBotStatus } from "@/lib/bot-status";

/**
 * Wave 1a — single source of truth for bot state.
 *
 * GET /api/bot/status (session auth) returns the authenticated user's resolved
 * bot status through the same ownership-verified path turns use, so the Settings
 * Permissions card can show the mode a turn would actually run under instead of
 * the singleton workspace row's value.
 *
 * Query params:
 *   ?conversationId= — include the conversation's workspaceRootRealpath as `root`.
 *   ?agentSlug=      — resolve the per-agent effective mode for that teammate.
 *
 * Deliberately NOT same-origin gated (like GET /api/ai/permission-mode): it is a
 * read of the caller's own state and must be reachable by a plain authenticated
 * curl for verification.
 */
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const conversationId = request.nextUrl.searchParams.get("conversationId") || undefined;
  const agentSlug = request.nextUrl.searchParams.get("agentSlug") || undefined;

  const status = await resolveBotStatus({ db, userId: user.id, conversationId, agentSlug });
  return NextResponse.json(status);
}
