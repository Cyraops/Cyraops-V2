import { NextRequest, NextResponse } from "next/server";
import { triggerByWebhookToken } from "@/lib/ai/automation/triggers";

type Context = { params: Promise<{ token: string }> };

/**
 * Public webhook entry point for a routine. The token is the only credential,
 * so every bad token returns the same 404 and the response never says whether a
 * routine exists.
 */
export async function POST(request: NextRequest, context: Context) {
  const { token } = await context.params;
  const result = await triggerByWebhookToken(token);

  if (!result.ok) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  return NextResponse.json({ accepted: true }, { headers: { "Cache-Control": "no-store" } });
}
