import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { browserRuntime } from "@/lib/ai/browser/browser-runtime";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const state = browserRuntime.getState(user.id);
  return NextResponse.json({ state });
}

export async function POST(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const { action, url, enabled, selector, text, value, x, y, direction, amount } = body;

  try {
    if (action === "navigate" && url) {
      const res = await browserRuntime.navigate(user.id, url, { actor: "USER" });
      return NextResponse.json(res);
    }

    if (action === "takeover") {
      const state = await browserRuntime.takeover(user.id, Boolean(enabled));
      return NextResponse.json({ success: true, state });
    }

    if (action === "click") {
      const target = typeof x === "number" && typeof y === "number" ? { x, y } : selector;
      if (!target) return jsonError("Selector or coordinates required for click", 400);
      const res = await browserRuntime.click(user.id, target, "USER");
      return NextResponse.json(res);
    }

    if (action === "type" && selector && text !== undefined) {
      const res = await browserRuntime.typeText(user.id, selector, text, "USER");
      return NextResponse.json(res);
    }

    if (action === "select" && selector && value !== undefined) {
      const res = await browserRuntime.selectOption(user.id, selector, value, "USER");
      return NextResponse.json(res);
    }

    if (action === "scroll") {
      const res = await browserRuntime.scroll(user.id, direction === "down" ? "down" : "up", amount);
      return NextResponse.json(res);
    }

    if (action === "back") {
      const res = await browserRuntime.goBack(user.id);
      return NextResponse.json(res);
    }

    if (action === "forward") {
      const res = await browserRuntime.goForward(user.id);
      return NextResponse.json(res);
    }

    if (action === "refresh") {
      const curr = browserRuntime.getState(user.id);
      const res = await browserRuntime.navigate(user.id, curr.url || "about:blank", { actor: "USER" });
      return NextResponse.json(res);
    }

    if (action === "extract") {
      const res = await browserRuntime.extractContent(user.id, selector);
      return NextResponse.json(res);
    }

    return jsonError("Invalid computer action", 400);
  } catch (err: any) {
    console.error("[API:ai/computer] Error:", err);
    return jsonError(err?.message || "Computer action failed", 500);
  }
}
