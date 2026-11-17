import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { computerAct, computerSessionKey, isComputerServiceConfigured, type ComputerAction } from "@/lib/ai/browser/computer-client";
import { validateDestinationUrl } from "@/lib/ai/browser/browser-runtime";

const schema = z
  .object({
    type: z.enum(["click", "key", "type", "scroll", "navigate", "back"]),
    x: z.number().optional(),
    y: z.number().optional(),
    text: z.string().max(2000).optional(),
    url: z.string().max(2000).optional(),
    deltaY: z.number().optional(),
  })
  .refine((value) => value.type !== "click" || (typeof value.x === "number" && typeof value.y === "number"), {
    message: "A click needs x and y",
  });

/** Human takeover: forwards pointer and keyboard input to the bot's browser. */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  if (!isComputerServiceConfigured()) return jsonError("Computer use is not configured on this server", 503);

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid input", 400);

  const { type, x, y, text, url, deltaY } = parsed.data;
  const key = computerSessionKey(user.id, "assistant");

  let action: ComputerAction = "clickAt";
  let payload: { x?: number; y?: number; text?: string; url?: string; deltaY?: number } = { x, y, text, url, deltaY };

  if (type === "click") {
    action = "clickAt";
    payload = { x, y };
  } else if (type === "key") {
    action = "key";
    payload = { text };
  } else if (type === "type") {
    action = "typeText";
    payload = { text };
  } else if (type === "scroll") {
    action = "scroll";
    payload = { deltaY };
  } else if (type === "navigate") {
    // The browser service enforces the same rule, but validating here stops a
    // private/link-local destination (cloud metadata included) from ever
    // reaching the VM at all.
    const destination = await validateDestinationUrl(String(url ?? ""));
    if (!destination.valid) return jsonError(destination.error ?? "That destination is not allowed", 400);
    action = "navigate";
    payload = { url: destination.normalizedUrl ?? url };
  } else {
    action = "back";
    payload = {};
  }

  const result = await computerAct(key, action, payload);
  if (!result.ok) return jsonError(result.error ?? "That action failed", 400);
  return NextResponse.json({ ok: true, url: result.url ?? "", title: result.title ?? "" });
}
