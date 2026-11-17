import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const invoiceStatusSchema = z.enum([
  "DRAFT",
  "ISSUED",
  "PARTIALLY_PAID",
  "PAID",
  "OVERDUE",
  "CANCELLED",
]);

const createInvoiceSchema = z.object({
  title: z.string().trim().min(3).max(180),
  amount: z.number().positive("Amount must be positive"),
  currency: z.literal("INR").default("INR"),
  projectId: z.string().trim().optional().nullable(),
  dealId: z.string().trim().optional().nullable(),
  clientCompanyId: z.string().trim().optional().nullable(),
  dueDate: z.string().datetime().optional().nullable().or(z.literal("")),
  notes: z.string().max(2000).optional().nullable(),
  status: invoiceStatusSchema.default("ISSUED"),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const projectId = searchParams.get("projectId")?.trim();
  const dealId = searchParams.get("dealId")?.trim();
  const status = searchParams.get("status")?.trim();
  const clientCompanyId = searchParams.get("clientCompanyId")?.trim();

  const where: any = {};
  if (projectId) where.projectId = projectId;
  if (dealId) where.dealId = dealId;
  if (clientCompanyId) where.clientCompanyId = clientCompanyId;
  if (status && ["DRAFT", "ISSUED", "PARTIALLY_PAID", "PAID", "OVERDUE", "CANCELLED"].includes(status)) {
    where.status = status;
  }

  const invoices = await db.clientInvoice.findMany({
    where,
    include: {
      project: { select: { id: true, name: true, status: true } },
      deal: { select: { id: true, title: true, stage: true, sourcePlatform: true } },
      clientCompany: { select: { id: true, name: true, domain: true } },
    },
    orderBy: [{ createdAt: "desc" }],
  });

  // Calculate Accounts Receivable summary
  let totalInvoiced = 0;
  let totalPaid = 0;
  let outstandingBalance = 0;
  let overdueAmount = 0;
  const now = new Date();

  for (const inv of invoices) {
    if (inv.status !== "CANCELLED") {
      totalInvoiced += inv.amount;
      totalPaid += inv.amountPaid;
      const balance = Math.max(0, inv.amount - inv.amountPaid);
      outstandingBalance += balance;
      if (inv.dueDate && new Date(inv.dueDate) < now && inv.status !== "PAID") {
        overdueAmount += balance;
      }
    }
  }

  return Response.json({
    invoices,
    summary: {
      totalInvoiced,
      totalPaid,
      outstandingBalance,
      overdueAmount,
      invoiceCount: invoices.length,
    },
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = createInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;

  // Generate unique invoice number using atomic PostgreSQL sequence
  const dateStr = new Date().toISOString().slice(0, 7).replace("-", "");
  const seqResult = await db.$queryRawUnsafe<{ nextval: string | number | bigint }[]>(
    `SELECT nextval('client_invoice_seq') as nextval;`
  );
  const seqNum = Number(seqResult[0]?.nextval ?? 1);
  const seq = String(seqNum).padStart(4, "0");
  const invoiceNumber = `INV-${dateStr}-${seq}`;

  const dueDate = data.dueDate && data.dueDate.length > 0
    ? new Date(data.dueDate)
    : null;

  let invoice;
  try {
    invoice = await db.clientInvoice.create({
      data: {
        invoiceNumber,
        title: data.title,
        amount: data.amount,
        currency: data.currency,
        projectId: data.projectId || null,
        dealId: data.dealId || null,
        clientCompanyId: data.clientCompanyId || null,
        dueDate,
        notes: data.notes || null,
        status: data.status,
      },
      include: {
        project: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        clientCompany: { select: { id: true, name: true } },
      },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      return jsonError("Invoice number collision detected. Please retry request.", 409);
    }
    throw err;
  }

  await logActivity({
    action: "created",
    entity: "client_invoice",
    entityId: invoice.id,
    summary: `issued client invoice ${invoice.invoiceNumber} for ₹${invoice.amount.toLocaleString()} ("${invoice.title}")`,
    userId: user.id,
    projectId: invoice.projectId || undefined,
  });

  return Response.json({ invoice }, { status: 201 });
}

