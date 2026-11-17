import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { storage } from "@/lib/storage";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const status = searchParams.get("status");

    const where: any = {};
    if (user.role === "MEMBER") {
      where.expense = { userId: user.id };
    }
    if (search) {
      where.OR = [
        { vendor: { contains: search, mode: "insensitive" } },
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { fileName: { contains: search, mode: "insensitive" } },
      ];
    }
    if (status) where.status = status;

    const invoices = await db.invoiceRecord.findMany({
      where,
      include: {
        expense: {
          include: {
            category: true,
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ invoices });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

