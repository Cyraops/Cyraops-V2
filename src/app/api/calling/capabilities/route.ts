import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { isLiveKitConfigured } from "@/lib/calling/config";

/**
 * Tells the UI whether calling can work at all, so the call buttons can be
 * honest instead of failing after the click. A call needs a LiveKit server:
 * without credentials nobody could ever connect, so we say so up front.
 */
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const configured = isLiveKitConfigured();
  return NextResponse.json(
    {
      calling: configured,
      reason: configured
        ? null
        : "Calling is not configured. Add LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET to enable voice and video calls.",
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
