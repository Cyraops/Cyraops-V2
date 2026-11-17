import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Only OWNER or ADMIN can officially approve invoices and create company expenses
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can verify invoices." }, { status: 403 });
    }

    const body = await req.json();
    const {
      invoiceId,
      vendor,
      invoiceNumber,
      totalAmount,
      currency = COMPANY_BASE_CURRENCY,
      customExchangeRate,
      classification = "OPEX",
      categoryId,
      subcategoryId,
      paymentMethod = "BANK_TRANSFER",
      paymentDate,
      createExpense = true,
      notes,
    } = body;

    if (!invoiceId) {
      return NextResponse.json({ error: "Missing invoiceId" }, { status: 400 });
    }

    const invoice = await db.invoiceRecord.findUnique({ where: { id: invoiceId } });
    if (!invoice) {
      return NextResponse.json({ error: "Invoice record not found" }, { status: 404 });
    }

    const finalVendor = vendor?.trim() || invoice.vendor;
    const finalInvoiceNumber = invoiceNumber?.trim() || invoice.invoiceNumber;
    const finalAmount = totalAmount !== undefined ? parseFloat(totalAmount) : invoice.totalAmount;
    const finalCurrency = (currency || invoice.currency).toUpperCase();

    let createdExpenseId: string | null = null;

    if (createExpense && categoryId) {
      const { amountBase, rate, source } = convertToBaseCurrency(
        finalAmount,
        finalCurrency,
        customExchangeRate ? parseFloat(customExchangeRate) : null
      );

      const expense = await db.expense.create({
        data: {
          title: `Invoice #${finalInvoiceNumber} - ${finalVendor}`,
          description: notes || `Verified expense from invoice #${finalInvoiceNumber}`,
          amount: finalAmount,
          currency: finalCurrency,
          exchangeRate: rate,
          exchangeRateDate: new Date(),
          exchangeRateSource: source,
          amountBase,
          baseCurrency: COMPANY_BASE_CURRENCY,
          classification,
          categoryId,
          subcategoryId: subcategoryId || null,
          paymentMethod,
          paymentStatus: "PAID",
          paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
          vendor: finalVendor,
          invoiceNumber: finalInvoiceNumber,
          userId: user.id,
          attachments: {
            create: [
              {
                filename: invoice.fileName,
                storagePath: invoice.fileKey,
                contentType: invoice.contentType,
                sizeBytes: invoice.fileSize,
              },
            ],
          },
        },
      });

      createdExpenseId = expense.id;

      await logCostAudit({
        userId: user.id,
        userEmail: (user as any).email,
        action: "CREATE",
        entityType: "EXPENSE",
        entityId: expense.id,
        details: { fromInvoice: invoiceId, amount: finalAmount, vendor: finalVendor, baseAmount: amountBase, currency: finalCurrency },
      });
    }

    const updatedInvoice = await db.invoiceRecord.update({
      where: { id: invoiceId },
      data: {
        vendor: finalVendor,
        invoiceNumber: finalInvoiceNumber,
        totalAmount: finalAmount,
        currency: finalCurrency,
        status: "VERIFIED",
        verifiedAt: new Date(),
        verifiedBy: user.name,
        expenseId: createdExpenseId || undefined,
        notes: notes || undefined,
      },
    });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "VERIFY",
      entityType: "INVOICE",
      entityId: invoiceId,
      details: { verifiedBy: user.name, createdExpenseId, totalAmount: finalAmount, currency: finalCurrency },
    });

    return NextResponse.json({ invoice: updatedInvoice, expenseId: createdExpenseId });
  } catch (error: any) {
    console.error("[Verify Invoice Error]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
