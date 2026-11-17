import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { computerAct, computerSessionKey, isComputerServiceConfigured } from "@/lib/ai/browser/computer-client";

// Per-user window. The panel polls at ~1.2s, so this is far above normal use,
// but it stops a script from driving a Playwright screenshot per request.
const frameBuckets = new Map<string, { count: number; resetAt: number }>();
function frameAllowed(userId: string): boolean {
  const now = Date.now();
  const bucket = frameBuckets.get(userId);
  if (!bucket || bucket.resetAt < now) {
    frameBuckets.set(userId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (bucket.count >= 120) return false;
  bucket.count += 1;
  return true;
}

/**
 * One frame of the assistant's live browser, for the side-panel viewport.
 * Returns JSON rather than raw bytes so the client gets the viewport size it
 * needs to map a click onto the real page.
 */
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  if (!frameAllowed(user.id)) {
    return NextResponse.json({ configured: true, error: "The live view is refreshing too fast. Slow down." }, { status: 200 });
  }

  if (!isComputerServiceConfigured()) {
    return NextResponse.json({ configured: false, error: "Computer use is not configured on this server." }, { status: 200 });
  }

  const result = await computerAct(computerSessionKey(user.id, "assistant"), "screenshot");
  if (!result.ok) {
    return NextResponse.json({ configured: true, error: result.error ?? "Could not capture the screen" }, { status: 200 });
  }

  return NextResponse.json(
    {
      configured: true,
      image: `data:${result.contentType ?? "image/jpeg"};base64,${result.imageBase64}`,
      url: result.url ?? "",
      title: result.title ?? "",
      width: result.width ?? 1280,
      height: result.height ?? 800,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
