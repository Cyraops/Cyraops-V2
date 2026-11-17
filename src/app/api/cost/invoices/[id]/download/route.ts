import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const invoice = await db.invoiceRecord.findUnique({
      where: { id },
      include: { expense: true },
    });
    if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });

    if (user.role === "MEMBER" && invoice.expense?.userId !== user.id) {
      return NextResponse.json({ error: "Permission denied. Ordinary members can only download their own invoice receipts." }, { status: 403 });
    }

    // Validate storage key against path traversal
    if (!/^[a-f0-9-]{36}\.[a-z0-9]{1,8}$/.test(invoice.fileKey)) {
      return NextResponse.json({ error: "Invalid storage identifier" }, { status: 400 });
    }

    const data = await storage.get(invoice.fileKey);
    const preview = req.nextUrl.searchParams.get("preview") === "1";

    return new Response(new Uint8Array(data), {
      headers: {
        "Content-Type": invoice.contentType || "application/pdf",
        "Content-Length": String(data.byteLength),
        "Content-Disposition": `${preview ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(invoice.fileName)}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: "File not accessible or missing" }, { status: 404 });
  }
}

