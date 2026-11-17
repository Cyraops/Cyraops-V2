import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";
import { db } from "@/lib/db";

/** Lightweight list for the side panel — never the full HTML. */
export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const pages = await db.page.findMany({
    where: { userId: user.id },
    select: { id: true, title: true, publicSlug: true, isPublic: true, updatedAt: true },
    orderBy: { updatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({ pages });
}
