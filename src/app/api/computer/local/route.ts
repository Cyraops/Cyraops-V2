import { NextRequest } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { completeLocalAction, isLocalBrowserConnected, markLocalBrowserSeen, pullLocalAction } from "@/lib/ai/browser/local-bridge";

/**
 * The user's own browser, over the CRM tab they already have open.
 *
 * GET  — marks presence and returns the next action to perform (or nothing).
 * POST — reports what happened.
 */

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  markLocalBrowserSeen(user.id);
  const action = pullLocalAction(user.id);
  return Response.json({ action, connected: true });
}

export async function GET_STATUS(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  return Response.json({ connected: isLocalBrowserConnected(user.id) });
}

const resultSchema = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  data: z
    .object({
      url: z.string().optional(),
      title: z.string().optional(),
      text: z.string().optional(),
      image: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    })
    .optional(),
  error: z.string().optional(),
});

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const parsed = resultSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Bad result", 400);
  const accepted = completeLocalAction(parsed.data.id, { ok: parsed.data.ok, data: parsed.data.data, error: parsed.data.error });
  return Response.json({ accepted });
}
