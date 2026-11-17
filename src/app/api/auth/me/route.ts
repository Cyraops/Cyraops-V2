import { NextRequest } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);
  const { passwordHash, ...safeUser } = user;
  return Response.json({ user: safeUser });
}
