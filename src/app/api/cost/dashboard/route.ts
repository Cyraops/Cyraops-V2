import { NextRequest, NextResponse } from "next/server";
import { userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Strict Authorization: Financial metrics, burn rate, runway and cap table are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Financial dashboard is restricted to administrators." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "all";

    const now = new Date();
    let startDate: Date | undefined;
    let endDate: Date | undefined;

    if (range === "this_month") {
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      endDate = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    } else if (range === "last_month") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59);
    } else if (range === "quarter") {
      startDate = new Date(now.getFullYear(), now.getMonth() - 3, 1);
      endDate = now;
    } else if (range === "year") {
      startDate = new Date(now.getFullYear(), 0, 1);
      endDate = now;
    } else if (range === "30d") {
      startDate = new Date();
      startDate.setDate(now.getDate() - 30);
      endDate = now;
    }

    const dateFilter = startDate && endDate ? { paymentDate: { gte: startDate, lte: endDate } } : {};

    // 1. Accounting Classification of Investments / Financing
    // Strictly isolate Equity Capital from Liabilities (Loans) and Equipment / Grants
    const investments = await db.investment.findMany({
      select: { amountBase: true, type: true, investorType: true, date: true },
    });

    let totalEquityCapital = 0;
    let totalDebtLiabilities = 0;
    let totalAssetContributions = 0;
    let totalGrants = 0;

    for (const inv of investments) {
      if (inv.type === "FOUNDER_CAPITAL" || inv.type === "ANGEL_INVESTMENT") {
        totalEquityCapital += inv.amountBase;
      } else if (inv.type === "LOAN") {
        totalDebtLiabilities += inv.amountBase;
      } else if (inv.type === "EQUIPMENT" || inv.type === "IP_SOFTWARE") {
        totalAssetContributions += inv.amountBase;
      } else if (inv.type === "GRANT") {
        totalGrants += inv.amountBase;
      }
    }

    // Total pure invested equity capital
    const totalInvestment = totalEquityCapital;

    // 2. Expenses matching filter
    // Exclude CANCELLED expenses. Subtract REFUND classification if any.
    const expenses = await db.expense.findMany({
      where: {
        ...dateFilter,
        paymentStatus: { notIn: ["CANCELLED"] },
      },
      include: {
        category: true,
        subcategory: true,
      },
      orderBy: { paymentDate: "desc" },
    });

    let totalOpex = 0;
    let totalCapex = 0;
    let totalRefunds = 0;

    for (const exp of expenses) {
      if (exp.classification === "REFUND") {
        totalRefunds += Math.abs(exp.amountBase);
      } else if (exp.classification === "CAPEX") {
        totalCapex += exp.amountBase;
      } else {
        totalOpex += exp.amountBase;
      }
    }

    // Net Operational Expenses (Opex minus refunds)
    const netExpenses = Math.max(0, totalOpex + totalCapex - totalRefunds);

    // 3. This Month Operational Burn
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    const thisMonthExpensesRecords = await db.expense.findMany({
      where: {
        paymentDate: { gte: currentMonthStart, lte: currentMonthEnd },
        paymentStatus: { notIn: ["CANCELLED"] },
      },
      select: { amountBase: true, classification: true },
    });

    let thisMonthBurn = 0;
    for (const exp of thisMonthExpensesRecords) {
      if (exp.classification === "REFUND") {
        thisMonthBurn -= Math.abs(exp.amountBase);
      } else {
        thisMonthBurn += exp.amountBase;
      }
    }
    thisMonthBurn = Math.max(0, thisMonthBurn);

    // 4. Recurring Expenses (active schedules normalized to monthly equivalent)
    const recurringList = await db.recurringExpense.findMany({
      where: { status: "ACTIVE" },
      include: { category: true },
      orderBy: { nextDueDate: "asc" },
    });
    let recurringMonthly = 0;
    for (const item of recurringList) {
      if (item.billingCycle === "WEEKLY") recurringMonthly += item.amountBase * 4.33;
      else if (item.billingCycle === "MONTHLY") recurringMonthly += item.amountBase;
      else if (item.billingCycle === "QUARTERLY") recurringMonthly += item.amountBase / 3;
      else if (item.billingCycle === "ANNUALLY") recurringMonthly += item.amountBase / 12;
    }

    // 5. AI Costs (Resolving Double Counting):
    // Differentiate actual Cash/Invoiced AI Expenses from Unreconciled Metered API Telemetry
    const aiInvoicedExpenses = expenses
      .filter((e) => e.category.slug === "ai-api-usage" && e.classification !== "REFUND")
      .reduce((sum, e) => sum + e.amountBase, 0);

    const aiUsageRecords = await db.aIUsageRecord.findMany({
      where: { isReconciled: false },
      select: { costAmountBase: true, totalTokens: true },
    });
    const aiUnreconciledMetered = aiUsageRecords.reduce((sum, ai) => sum + ai.costAmountBase, 0);

    // Total AI Financial Cost prioritizes actual recorded expenses + any metered API consumption not yet invoiced
    const totalAiCost = Math.round((aiInvoicedExpenses + aiUnreconciledMetered) * 100) / 100;

    // 6. Marketing, Client Acquisition & CAC (Resolving Double Counting):
    const marketingExpenses = expenses
      .filter(
        (e) =>
          (e.category.slug === "marketing-advertising" || e.category.slug === "client-acquisition") &&
          e.classification !== "REFUND"
      )
      .reduce((sum, e) => sum + e.amountBase, 0);

    const unreconciledCampaigns = await db.marketingCampaign.findMany({
      where: { isReconciled: false },
    });
    const campaignSpend = unreconciledCampaigns.reduce((sum, c) => sum + c.spentAmountBase, 0);
    const totalMarketingSpend = Math.round((marketingExpenses + campaignSpend) * 100) / 100;

    const allCampaigns = await db.marketingCampaign.findMany();
    const campaignClients = allCampaigns.reduce((sum, c) => sum + c.clientsAcquired, 0);
    const wonDealsCount = await db.deal.count({ where: { stage: "CLOSED_WON" } }).catch(() => 0);
    const totalClientsAcquired = Math.max(campaignClients, wonDealsCount);

    const cac =
      totalClientsAcquired > 0
        ? Math.round((totalMarketingSpend / totalClientsAcquired) * 100) / 100
        : totalMarketingSpend;

    // 7. Monthly Trend (last 6 months in base currency INR)
    const monthlyTrend: { month: string; label: string; expenses: number; investments: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const mStart = new Date(d.getFullYear(), d.getMonth(), 1);
      const mEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
      const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const monthLabel = d.toLocaleString("default", { month: "short", year: "2-digit" });

      const mExp = await db.expense.aggregate({
        where: {
          paymentDate: { gte: mStart, lte: mEnd },
          paymentStatus: { notIn: ["CANCELLED"] },
        },
        _sum: { amountBase: true },
      });
      const mInv = await db.investment.aggregate({
        where: {
          date: { gte: mStart, lte: mEnd },
          type: { in: ["FOUNDER_CAPITAL", "ANGEL_INVESTMENT"] },
        },
        _sum: { amountBase: true },
      });

      monthlyTrend.push({
        month: monthKey,
        label: monthLabel,
        expenses: Math.round((mExp._sum.amountBase || 0) * 100) / 100,
        investments: Math.round((mInv._sum.amountBase || 0) * 100) / 100,
      });
    }

    // 8. Category Breakdown
    const catMap = new Map<string, { id: string; name: string; color: string; icon: string; amount: number }>();
    for (const exp of expenses) {
      if (exp.classification === "REFUND") continue;
      const cat = exp.category;
      if (!catMap.has(cat.id)) {
        catMap.set(cat.id, {
          id: cat.id,
          name: cat.name,
          color: cat.color || "#64748b",
          icon: cat.icon || "Tag",
          amount: 0,
        });
      }
      catMap.get(cat.id)!.amount += exp.amountBase;
    }

    const categoryBreakdown = Array.from(catMap.values())
      .map((c) => ({
        ...c,
        amount: Math.round(c.amount * 100) / 100,
        percentage: netExpenses > 0 ? Math.round((c.amount / netExpenses) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    // 9. Recent Transactions (last 8)
    const recentTransactions = expenses.slice(0, 8).map((e) => ({
      id: e.id,
      title: e.title,
      vendor: e.vendor,
      amount: e.amount,
      currency: e.currency,
      amountBase: e.amountBase,
      baseCurrency: e.baseCurrency || COMPANY_BASE_CURRENCY,
      paymentDate: e.paymentDate,
      categoryName: e.category.name,
      categoryColor: e.category.color,
      paymentMethod: e.paymentMethod,
      paymentStatus: e.paymentStatus,
      classification: e.classification,
    }));

    // 10. Upcoming Bills (next 5)
    const upcomingBills = recurringList.slice(0, 5).map((r) => ({
      id: r.id,
      title: r.title,
      vendor: r.vendor,
      amount: r.amount,
      currency: r.currency,
      amountBase: r.amountBase,
      baseCurrency: r.baseCurrency || COMPANY_BASE_CURRENCY,
      billingCycle: r.billingCycle,
      nextDueDate: r.nextDueDate,
      categoryName: r.category.name,
    }));

    return NextResponse.json({
      baseCurrency: COMPANY_BASE_CURRENCY,
      summary: {
        totalInvestment: Math.round(totalInvestment * 100) / 100,
        totalEquityCapital: Math.round(totalEquityCapital * 100) / 100,
        totalDebtLiabilities: Math.round(totalDebtLiabilities * 100) / 100,
        totalAssetContributions: Math.round(totalAssetContributions * 100) / 100,
        totalGrants: Math.round(totalGrants * 100) / 100,
        totalExpenses: Math.round(netExpenses * 100) / 100,
        totalOpex: Math.round(totalOpex * 100) / 100,
        totalCapex: Math.round(totalCapex * 100) / 100,
        totalRefunds: Math.round(totalRefunds * 100) / 100,
        thisMonthExpenses: Math.round(thisMonthBurn * 100) / 100,
        recurringMonthly: Math.round(recurringMonthly * 100) / 100,
        totalAiCost,
        aiInvoicedExpenses: Math.round(aiInvoicedExpenses * 100) / 100,
        aiUnreconciledMetered: Math.round(aiUnreconciledMetered * 100) / 100,
        totalMarketingSpend,
        totalClientsAcquired,
        cac,
      },
      monthlyTrend,
      categoryBreakdown,
      recentTransactions,
      upcomingBills,
      range,
    });
  } catch (error: any) {
    console.error("[Cost Dashboard Error]", error);
    return NextResponse.json({ error: error.message || "Failed to load dashboard metrics" }, { status: 500 });
  }
}
