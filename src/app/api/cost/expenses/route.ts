import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim() || "";
    const categoryId = searchParams.get("categoryId");
    const subcategoryId = searchParams.get("subcategoryId");
    const paymentStatus = searchParams.get("paymentStatus");
    const paymentMethod = searchParams.get("paymentMethod");
    const classification = searchParams.get("classification");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "25", 10)));
    const skip = (page - 1) * limit;

    const where: any = {};

    // Ordinary MEMBER users only see their own expense reimbursements
    if (user.role === "MEMBER") {
      where.userId = user.id;
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: "insensitive" } },
        { vendor: { contains: search, mode: "insensitive" } },
        { invoiceNumber: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
      ];
    }

    if (categoryId) where.categoryId = categoryId;
    if (subcategoryId) where.subcategoryId = subcategoryId;
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (classification) where.classification = classification;

    if (startDate || endDate) {
      where.paymentDate = {};
      if (startDate) where.paymentDate.gte = new Date(startDate);
      if (endDate) where.paymentDate.lte = new Date(endDate);
    }

    const [total, expenses, totalsAgg] = await Promise.all([
      db.expense.count({ where }),
      db.expense.findMany({
        where,
        include: {
          category: true,
          subcategory: true,
          user: { select: { id: true, name: true, role: true } },
          attachments: true,
          invoices: true,
        },
        orderBy: { paymentDate: "desc" },
        skip,
        take: limit,
      }),
      db.expense.aggregate({
        where,
        _sum: { amountBase: true },
      }),
    ]);

    return NextResponse.json({
      baseCurrency: COMPANY_BASE_CURRENCY,
      expenses,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
      totalAmountBase: Math.round((totalsAgg._sum.amountBase || 0) * 100) / 100,
    });
  } catch (error: any) {
    console.error("[Get Expenses Error]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const {
      title,
      description,
      amount,
      currency = COMPANY_BASE_CURRENCY,
      customExchangeRate,
      classification = "OPEX",
      categoryId,
      subcategoryId,
      paymentMethod = "BANK_TRANSFER",
      paymentStatus = "PAID",
      paymentDate,
      vendor,
      invoiceNumber,
      isRecurring = false,
      recurringExpenseId,
      recurringPeriodKey,
      taxAmount = 0,
      notes,
      attachments = [],
    } = body;

    // Ordinary MEMBER users can only submit expense reimbursement requests
    const isMember = user.role === "MEMBER";
    const effectiveStatus = isMember ? "REIMBURSEMENT_PENDING" : paymentStatus;
    const effectiveClassification = isMember ? "OPEX" : classification;
    const effectiveIsRecurring = isMember ? false : Boolean(isRecurring);
    const effectiveRecurringExpenseId = isMember ? null : (recurringExpenseId || null);
    const effectiveRecurringPeriodKey = isMember ? null : (recurringPeriodKey || null);

    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || (parsedAmount <= 0 && effectiveClassification !== "REFUND")) {
      return NextResponse.json({ error: "Valid amount is required (positive for expenses)" }, { status: 400 });
    }
    if (!vendor || typeof vendor !== "string") {
      return NextResponse.json({ error: "Vendor name is required" }, { status: 400 });
    }
    if (!categoryId) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }

    const category = await db.expenseCategory.findUnique({ where: { id: categoryId } });
    if (!category) {
      return NextResponse.json({ error: "Category not found" }, { status: 400 });
    }

    // Convert to company base reporting currency (INR)
    const { amountBase, rate, source } = convertToBaseCurrency(
      Math.abs(parsedAmount),
      currency,
      customExchangeRate ? parseFloat(customExchangeRate) : null
    );

    const signedAmountBase = effectiveClassification === "REFUND" ? -Math.abs(amountBase) : Math.abs(amountBase);
    const signedAmount = effectiveClassification === "REFUND" ? -Math.abs(parsedAmount) : Math.abs(parsedAmount);

    const expense = await db.expense.create({
      data: {
        title,
        description: description || null,
        amount: signedAmount,
        currency: currency.toUpperCase(),
        exchangeRate: rate,
        exchangeRateDate: new Date(),
        exchangeRateSource: source,
        amountBase: signedAmountBase,
        baseCurrency: COMPANY_BASE_CURRENCY,
        classification: effectiveClassification,
        categoryId,
        subcategoryId: subcategoryId || null,
        paymentMethod,
        paymentStatus: effectiveStatus,
        paymentDate: paymentDate ? new Date(paymentDate) : new Date(),
        vendor,
        invoiceNumber: invoiceNumber || null,
        isRecurring: effectiveIsRecurring,
        recurringExpenseId: effectiveRecurringExpenseId,
        recurringPeriodKey: effectiveRecurringPeriodKey,
        taxAmount: parseFloat(taxAmount) || 0,
        notes: notes || null,
        userId: user.id,
        attachments: {
          create: attachments.map((att: any) => ({
            filename: att.filename,
            storagePath: att.storagePath,
            contentType: att.contentType || "application/octet-stream",
            sizeBytes: att.sizeBytes || 0,
          })),
        },
      },
      include: {
        category: true,
        subcategory: true,
        attachments: true,
        user: { select: { id: true, name: true } },
      },
    });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "CREATE",
      entityType: "EXPENSE",
      entityId: expense.id,
      details: {
        title: expense.title,
        vendor: expense.vendor,
        amount: expense.amount,
        currency: expense.currency,
        amountBase: expense.amountBase,
        baseCurrency: expense.baseCurrency,
        rate,
        rateSource: source,
        classification,
      },
    });

    return NextResponse.json({ expense });
  } catch (error: any) {
    console.error("[Create Expense Error]", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
