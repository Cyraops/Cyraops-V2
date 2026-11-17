import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Cap table and equity investments are strictly confidential to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Permission denied. Cap table and investment records are restricted to administrators." }, { status: 403 });
    }

    const investments = await db.investment.findMany({
      include: {
        user: { select: { id: true, name: true } },
      },
      orderBy: { date: "desc" },
    });

    let equityCapitalBase = 0;
    let debtLiabilitiesBase = 0;
    let assetContributionsBase = 0;
    let grantsBase = 0;

    const byType: Record<string, number> = {};
    const byInvestor: Record<string, number> = {};

    for (const inv of investments) {
      byType[inv.type] = (byType[inv.type] || 0) + inv.amountBase;
      byInvestor[inv.investorName] = (byInvestor[inv.investorName] || 0) + inv.amountBase;

      if (inv.type === "FOUNDER_CAPITAL" || inv.type === "ANGEL_INVESTMENT") {
        equityCapitalBase += inv.amountBase;
      } else if (inv.type === "LOAN") {
        debtLiabilitiesBase += inv.amountBase;
      } else if (inv.type === "EQUIPMENT" || inv.type === "IP_SOFTWARE") {
        assetContributionsBase += inv.amountBase;
      } else if (inv.type === "GRANT") {
        grantsBase += inv.amountBase;
      }
    }

    return NextResponse.json({
      baseCurrency: COMPANY_BASE_CURRENCY,
      investments,
      totalInvestedBase: Math.round(equityCapitalBase * 100) / 100,
      equityCapitalBase: Math.round(equityCapitalBase * 100) / 100,
      debtLiabilitiesBase: Math.round(debtLiabilitiesBase * 100) / 100,
      assetContributionsBase: Math.round(assetContributionsBase * 100) / 100,
      grantsBase: Math.round(grantsBase * 100) / 100,
      breakdownByType: byType,
      breakdownByInvestor: byInvestor,
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
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only owners and admins can record company investments" }, { status: 403 });
    }

    const body = await req.json();
    const {
      title,
      investorName,
      investorType = "FOUNDER",
      type = "FOUNDER_CAPITAL",
      amount,
      currency = COMPANY_BASE_CURRENCY,
      customExchangeRate,
      date,
      equityPercentage,
      notes,
      referenceNumber,
    } = body;

    if (!title || !investorName) {
      return NextResponse.json({ error: "Title and Investor Name are required" }, { status: 400 });
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return NextResponse.json({ error: "Valid positive amount is required" }, { status: 400 });
    }

    const { amountBase, rate, source } = convertToBaseCurrency(
      parsedAmount,
      currency,
      customExchangeRate ? parseFloat(customExchangeRate) : null
    );

    const investment = await db.investment.create({
      data: {
        title,
        investorName,
        investorType,
        type,
        amount: parsedAmount,
        currency: currency.toUpperCase(),
        exchangeRate: rate,
        exchangeRateDate: new Date(),
        exchangeRateSource: source,
        amountBase,
        baseCurrency: COMPANY_BASE_CURRENCY,
        date: date ? new Date(date) : new Date(),
        equityPercentage: equityPercentage !== undefined && equityPercentage !== "" ? parseFloat(equityPercentage) : null,
        notes: notes || null,
        referenceNumber: referenceNumber || null,
        userId: user.id,
      },
    });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "CREATE",
      entityType: "INVESTMENT",
      entityId: investment.id,
      details: {
        title,
        investorName,
        amount: parsedAmount,
        currency,
        amountBase,
        rate,
        rateSource: source,
        type,
      },
    });

    return NextResponse.json({ investment });
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
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json({ error: "Only owners and admins can delete investments" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing investment id" }, { status: 400 });

    const existing = await db.investment.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Investment not found" }, { status: 404 });

    const snapshot = {
      title: existing.title,
      amount: existing.amount,
      currency: existing.currency,
      amountBase: existing.amountBase,
      investorName: existing.investorName,
      type: existing.type,
      date: existing.date,
    };

    await db.investment.delete({ where: { id } });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "DELETE",
      entityType: "INVESTMENT",
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
