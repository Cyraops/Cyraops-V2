import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const expense = await db.expense.findUnique({
      where: { id },
      include: {
        category: true,
        subcategory: true,
        user: { select: { id: true, name: true, role: true } },
        attachments: true,
        invoices: true,
        recurringExpense: true,
      },
    });

    if (!expense) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

    if (user.role === "MEMBER" && expense.userId !== user.id) {
      return NextResponse.json({ error: "Permission denied. Ordinary members can only view their own expense records." }, { status: 403 });
    }

    return NextResponse.json({ expense });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const existing = await db.expense.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

    // Authorization: only OWNER or ADMIN can modify recorded expenses,
    // or the creator can modify only if it is still REIMBURSEMENT_PENDING
    const isOwnerOrAdmin = user.role === "OWNER" || user.role === "ADMIN";
    if (!isOwnerOrAdmin && (existing.userId !== user.id || existing.paymentStatus !== "REIMBURSEMENT_PENDING")) {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can modify approved expenses." }, { status: 403 });
    }

    const body = await req.json();
    const {
      title,
      description,
      amount,
      currency,
      customExchangeRate,
      classification,
      categoryId,
      subcategoryId,
      paymentMethod,
      paymentStatus,
      paymentDate,
      vendor,
      invoiceNumber,
      isRecurring,
      taxAmount,
      notes,
      correctionReason,
    } = body;

    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
    const newCurrency = currency ? currency.toUpperCase() : existing.currency;
    const newClassification = isOwnerOrAdmin ? (classification || existing.classification) : "OPEX";
    const newPaymentStatus = isOwnerOrAdmin ? (paymentStatus || existing.paymentStatus) : "REIMBURSEMENT_PENDING";

    // Preserve historical rate unless explicitly provided as a correction
    let newRate = existing.exchangeRate;
    let newSource = existing.exchangeRateSource;
    let newRateDate = existing.exchangeRateDate;

    if (customExchangeRate !== undefined && customExchangeRate !== null && parseFloat(customExchangeRate) > 0) {
      newRate = parseFloat(customExchangeRate);
      newSource = "MANUAL_OVERRIDE";
      newRateDate = new Date();
    } else if (currency && currency.toUpperCase() !== existing.currency) {
      const converted = convertToBaseCurrency(Math.abs(newAmount), newCurrency);
      newRate = converted.rate;
      newSource = converted.source;
      newRateDate = new Date();
    }

    const absBase = Math.round(Math.abs(newAmount) * newRate * 100) / 100;
    const newAmountBase = newClassification === "REFUND" ? -absBase : absBase;
    const signedAmount = newClassification === "REFUND" ? -Math.abs(newAmount) : Math.abs(newAmount);

    const updated = await db.expense.update({
      where: { id },
      data: {
        title: title !== undefined ? title : existing.title,
        description: description !== undefined ? description : existing.description,
        amount: signedAmount,
        currency: newCurrency,
        exchangeRate: newRate,
        exchangeRateDate: newRateDate,
        exchangeRateSource: newSource,
        amountBase: newAmountBase,
        baseCurrency: COMPANY_BASE_CURRENCY,
        classification: newClassification,
        categoryId: categoryId || existing.categoryId,
        subcategoryId: subcategoryId !== undefined ? subcategoryId : existing.subcategoryId,
        paymentMethod: paymentMethod || existing.paymentMethod,
        paymentStatus: newPaymentStatus,
        paymentDate: paymentDate ? new Date(paymentDate) : existing.paymentDate,
        vendor: vendor !== undefined ? vendor : existing.vendor,
        invoiceNumber: invoiceNumber !== undefined ? invoiceNumber : existing.invoiceNumber,
        isRecurring: isRecurring !== undefined ? Boolean(isRecurring) : existing.isRecurring,
        taxAmount: taxAmount !== undefined ? parseFloat(taxAmount) : existing.taxAmount,
        notes: notes !== undefined ? notes : existing.notes,
      },
      include: {
        category: true,
        subcategory: true,
        attachments: true,
        user: { select: { id: true, name: true } },
      },
    });

    // Record explicit audit history
    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "UPDATE",
      entityType: "EXPENSE",
      entityId: id,
      details: {
        correctionReason: correctionReason || "Financial record edit",
        previous: {
          amount: existing.amount,
          amountBase: existing.amountBase,
          rate: existing.exchangeRate,
          currency: existing.currency,
          status: existing.paymentStatus,
        },
        updated: {
          amount: updated.amount,
          amountBase: updated.amountBase,
          rate: updated.exchangeRate,
          currency: updated.currency,
          status: updated.paymentStatus,
        },
      },
    });

    return NextResponse.json({ expense: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;
    const existing = await db.expense.findUnique({
      where: { id },
      include: { category: true, subcategory: true },
    });
    if (!existing) return NextResponse.json({ error: "Expense not found" }, { status: 404 });

    // Strict Authorization: ONLY OWNER or ADMIN can delete financial records!
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can delete financial records." }, { status: 403 });
    }

    // Capture complete snapshot before deletion so history is preserved
    const snapshot = {
      title: existing.title,
      amount: existing.amount,
      currency: existing.currency,
      exchangeRate: existing.exchangeRate,
      amountBase: existing.amountBase,
      vendor: existing.vendor,
      invoiceNumber: existing.invoiceNumber,
      category: existing.category.name,
      paymentDate: existing.paymentDate,
      paymentStatus: existing.paymentStatus,
      recordedByUserId: existing.userId,
    };

    await db.expense.delete({ where: { id } });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "DELETE",
      entityType: "EXPENSE",
      entityId: id,
      details: {
        snapshot,
        deletedBy: user.name,
        timestamp: new Date().toISOString(),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
