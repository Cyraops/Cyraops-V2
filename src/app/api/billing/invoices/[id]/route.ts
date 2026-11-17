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

const updateInvoiceSchema = z.object({
  title: z.string().trim().min(3).max(180).optional(),
  amount: z.number().positive().optional(),
  currency: z.literal("INR").optional(),
  dueDate: z.string().datetime().optional().nullable().or(z.literal("")),
  amountPaid: z.number().min(0).optional(),
  status: invoiceStatusSchema.optional(),
  paymentMethod: z.string().max(100).optional().nullable(),
  paidAt: z.string().datetime().optional().nullable().or(z.literal("")),
  notes: z.string().max(2000).optional().nullable(),
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const invoice = await db.clientInvoice.findUnique({
    where: { id },
    include: {
      project: true,
      deal: true,
      clientCompany: true,
    },
  });

  if (!invoice) return jsonError("Invoice not found", 404);

  return Response.json({ invoice });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const body = await request.json().catch(() => null);
  const parsed = updateInvoiceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Validation error: " + parsed.error.issues.map((i) => i.message).join(", "), 400);
  }

  const data = parsed.data;

  return await db.$transaction(async (tx) => {
    const existing = await tx.clientInvoice.findUnique({ where: { id } });
    if (!existing) return jsonError("Invoice not found", 404);

    const targetAmount = data.amount !== undefined ? data.amount : existing.amount;
    if (targetAmount <= 0) {
      return jsonError("Invoice amount must be positive", 400);
    }

    // Guard against modifying cancelled invoices
    if (existing.status === "CANCELLED" && data.status !== "CANCELLED") {
      return jsonError("Cannot modify a cancelled invoice", 400);
    }

    // Overpayment validation
    if (data.amountPaid !== undefined) {
      if (data.amountPaid < 0) {
        return jsonError("Payment amount must be non-negative", 400);
      }
      if (data.amountPaid > targetAmount) {
        return jsonError(
          `Payment amount (₹${data.amountPaid.toLocaleString()}) cannot exceed total invoice amount (₹${targetAmount.toLocaleString()})`,
          400
        );
      }
    }

    // Validate status transitions and do not allow setting PAID without full payment
    if (data.status === "PAID") {
      const resultingPaid = data.amountPaid !== undefined ? data.amountPaid : targetAmount;
      if (resultingPaid < targetAmount) {
        return jsonError(
          `Cannot mark invoice as PAID: recorded payment (₹${resultingPaid.toLocaleString()}) is less than invoice amount (₹${targetAmount.toLocaleString()})`,
          400
        );
      }
    }

    if (data.status === "CANCELLED" && (existing.amountPaid > 0 || (data.amountPaid !== undefined && data.amountPaid > 0))) {
      return jsonError("Cannot cancel an invoice with recorded payments", 400);
    }

    const updateData: Record<string, any> = {};

    if (data.title !== undefined) updateData.title = data.title;
    if (data.amount !== undefined) updateData.amount = data.amount;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.notes !== undefined) updateData.notes = data.notes;
    if (data.paymentMethod !== undefined) updateData.paymentMethod = data.paymentMethod;

    if (data.dueDate !== undefined) {
      updateData.dueDate = data.dueDate && data.dueDate.length > 0 ? new Date(data.dueDate) : null;
    }

    if (data.amountPaid !== undefined) {
      updateData.amountPaid = data.amountPaid;
      if (data.amountPaid >= targetAmount) {
        updateData.status = "PAID";
        updateData.paidAt = data.paidAt ? new Date(data.paidAt) : new Date();
      } else if (data.amountPaid > 0) {
        updateData.status = "PARTIALLY_PAID";
        updateData.paidAt = null;
      } else {
        updateData.status = "ISSUED";
        updateData.paidAt = null;
      }
    }

    if (data.status !== undefined && data.status !== "CANCELLED") {
      updateData.status = data.status;
      if (data.status === "PAID") {
        updateData.amountPaid = targetAmount;
        updateData.paidAt = data.paidAt ? new Date(data.paidAt) : (existing.paidAt ?? new Date());
      } else if (data.status === "ISSUED" || data.status === "DRAFT") {
        updateData.paidAt = null;
        if (data.amountPaid === undefined && existing.amountPaid === 0) {
          updateData.amountPaid = 0;
        }
      }
    } else if (data.status === "CANCELLED") {
      updateData.status = "CANCELLED";
      updateData.paidAt = null;
    }

    if (data.paidAt !== undefined && updateData.paidAt === undefined) {
      updateData.paidAt = data.paidAt && data.paidAt.length > 0 ? new Date(data.paidAt) : null;
    }

    const updated = await tx.clientInvoice.update({
      where: { id },
      data: updateData,
      include: {
        project: { select: { id: true, name: true } },
        deal: { select: { id: true, title: true } },
        clientCompany: { select: { id: true, name: true } },
      },
    });

    await logActivity({
      action: "updated",
      entity: "client_invoice",
      entityId: id,
      summary: `updated client invoice ${updated.invoiceNumber}: status ${updated.status}, paid ₹${updated.amountPaid.toLocaleString()} of ₹${updated.amount.toLocaleString()}`,
      userId: user.id,
      projectId: updated.projectId || undefined,
    });

    return Response.json({ invoice: updated });
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const { id } = await params;
  const existing = await db.clientInvoice.findUnique({ where: { id } });
  if (!existing) return jsonError("Invoice not found", 404);

  if (existing.status === "PAID" || existing.amountPaid > 0) {
    return jsonError("Cannot cancel an invoice with recorded payments", 400);
  }

  // Soft cancel invoice rather than destructive deletion
  const cancelled = await db.clientInvoice.update({
    where: { id },
    data: { status: "CANCELLED" },
  });

  await logActivity({
    action: "cancelled",
    entity: "client_invoice",
    entityId: id,
    summary: `cancelled client invoice ${existing.invoiceNumber}`,
    userId: user.id,
  });

  return Response.json({ success: true, invoice: cancelled });
}

