import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Recurring subscription commitments are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Recurring subscription records are restricted to administrators." },
        { status: 403 }
      );
    }

    const recurring = await db.recurringExpense.findMany({
      include: {
        category: true,
        user: { select: { id: true, name: true } },
        _count: { select: { expenses: true } },
      },
      orderBy: { nextDueDate: "asc" },
    });

    let monthlyBurn = 0;
    for (const r of recurring) {
      if (r.status === "ACTIVE") {
        if (r.billingCycle === "WEEKLY") monthlyBurn += r.amountBase * 4.33;
        else if (r.billingCycle === "MONTHLY") monthlyBurn += r.amountBase;
        else if (r.billingCycle === "QUARTERLY") monthlyBurn += r.amountBase / 3;
        else if (r.billingCycle === "ANNUALLY") monthlyBurn += r.amountBase / 12;
      }
    }

    return NextResponse.json({
      baseCurrency: COMPANY_BASE_CURRENCY,
      recurring,
      monthlyBurn: Math.round(monthlyBurn * 100) / 100,
    });
  } catch (error: any) {
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

    // Strict Authorization: Recurring subscription commitments are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can create recurring expenses." }, { status: 403 });
    }

    const body = await req.json();
    const {
      title,
      vendor,
      amount,
      currency = COMPANY_BASE_CURRENCY,
      customExchangeRate,
      categoryId,
      billingCycle = "MONTHLY",
      nextDueDate,
      startDate,
      endDate,
      autoRenew = true,
      paymentMethod = "CREDIT_CARD",
      notes,
    } = body;

    if (!title || !vendor || !categoryId) {
      return NextResponse.json({ error: "Title, Vendor, and Category are required" }, { status: 400 });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Amount must be a positive number" }, { status: 400 });
    }

    const { amountBase, rate, source } = convertToBaseCurrency(
      parsedAmount,
      currency,
      customExchangeRate ? parseFloat(customExchangeRate) : null
    );

    const recurring = await db.recurringExpense.create({
      data: {
        title,
        vendor,
        amount: parsedAmount,
        currency: currency.toUpperCase(),
        exchangeRate: rate,
        exchangeRateDate: new Date(),
        exchangeRateSource: source,
        amountBase,
        baseCurrency: COMPANY_BASE_CURRENCY,
        categoryId,
        billingCycle,
        nextDueDate: nextDueDate ? new Date(nextDueDate) : new Date(),
        startDate: startDate ? new Date(startDate) : new Date(),
        endDate: endDate ? new Date(endDate) : null,
        autoRenew: Boolean(autoRenew),
        status: "ACTIVE",
        paymentMethod,
        notes: notes || null,
        userId: user.id,
      },
      include: {
        category: true,
      },
    });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "CREATE",
      entityType: "RECURRING",
      entityId: recurring.id,
      details: { title, vendor, amount: parsedAmount, currency, cycle: billingCycle, rate, source },
    });

    return NextResponse.json({ recurring });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Recurring subscription commitments are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can modify recurring expenses." }, { status: 403 });
    }

    const body = await req.json();
    const { id, title, vendor, amount, currency, customExchangeRate, categoryId, billingCycle, nextDueDate, status, notes } = body;

    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await db.recurringExpense.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Recurring expense not found" }, { status: 404 });

    const newAmount = amount !== undefined ? parseFloat(amount) : existing.amount;
    const newCurrency = currency ? currency.toUpperCase() : existing.currency;

    let newRate = existing.exchangeRate;
    let newSource = existing.exchangeRateSource;
    let newRateDate = existing.exchangeRateDate;

    if (customExchangeRate !== undefined && customExchangeRate !== null && parseFloat(customExchangeRate) > 0) {
      newRate = parseFloat(customExchangeRate);
      newSource = "MANUAL_OVERRIDE";
      newRateDate = new Date();
    } else if (currency && currency.toUpperCase() !== existing.currency) {
      const converted = convertToBaseCurrency(newAmount, newCurrency);
      newRate = converted.rate;
      newSource = converted.source;
      newRateDate = new Date();
    }

    const newAmountBase = Math.round(newAmount * newRate * 100) / 100;

    const updated = await db.recurringExpense.update({
      where: { id },
      data: {
        title: title || existing.title,
        vendor: vendor || existing.vendor,
        amount: newAmount,
        currency: newCurrency,
        exchangeRate: newRate,
        exchangeRateDate: newRateDate,
        exchangeRateSource: newSource,
        amountBase: newAmountBase,
        baseCurrency: COMPANY_BASE_CURRENCY,
        categoryId: categoryId || existing.categoryId,
        billingCycle: billingCycle || existing.billingCycle,
        nextDueDate: nextDueDate ? new Date(nextDueDate) : existing.nextDueDate,
        status: status || existing.status,
        notes: notes !== undefined ? notes : existing.notes,
      },
      include: { category: true },
    });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "UPDATE",
      entityType: "RECURRING",
      entityId: id,
      details: { title: updated.title, status: updated.status, nextDueDate: updated.nextDueDate },
    });

    return NextResponse.json({ recurring: updated });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Recurring subscription commitments are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Only admins or owners can delete recurring subscriptions." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const existing = await db.recurringExpense.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const snapshot = {
      title: existing.title,
      vendor: existing.vendor,
      amount: existing.amount,
      currency: existing.currency,
      cycle: existing.billingCycle,
      status: existing.status,
    };

    await db.recurringExpense.delete({ where: { id } });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "DELETE",
      entityType: "RECURRING",
      entityId: id,
      details: { snapshot, deletedBy: user.name },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
