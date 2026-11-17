import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { executeConfirmedAction, cancelPendingAction, getPendingAction } from "@/lib/ai/voice/crm-tools";

export async function POST(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized: Invalid session." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const { actionId, confirmed } = body;

    if (!actionId) {
      return NextResponse.json({ error: "Missing actionId parameter." }, { status: 400 });
    }

    const pending = getPendingAction(actionId);
    if (!pending) {
      return NextResponse.json({ error: "Action confirmation has expired or is invalid." }, { status: 404 });
    }

    if (pending.userId !== user.id) {
      return NextResponse.json({ error: "Forbidden: You are not authorized to confirm this action." }, { status: 403 });
    }

    if (!confirmed) {
      cancelPendingAction(actionId, user.id);
      return NextResponse.json({
        success: true,
        cancelled: true,
        message: "Action was cancelled successfully.",
      });
    }

    // Execute the confirmed action
    const execution = await executeConfirmedAction(actionId, user, "main");
    if (!execution.success) {
      return NextResponse.json({ success: false, error: execution.error }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      confirmed: true,
      result: execution.result,
    });
  } catch (err: any) {
    return NextResponse.json({ error: `Confirmation error: ${err?.message || err}` }, { status: 500 });
  }
}

