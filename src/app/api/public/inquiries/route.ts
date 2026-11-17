import { NextRequest } from "next/server";
import { handlePublicInquiry } from "@/lib/public-inquiry";

export async function POST(request: NextRequest) {
  return handlePublicInquiry(request);
}
