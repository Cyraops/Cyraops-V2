import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Marketing budgets, CAC, and ROI performance are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Marketing campaign records are restricted to administrators." },
        { status: 403 }
      );
    }

    const campaigns = await db.marketingCampaign.findMany({
      orderBy: { startDate: "desc" },
    });

    const totalSpentBase = campaigns.reduce((sum, c) => sum + c.spentAmountBase, 0);
    const totalLeads = campaigns.reduce((sum, c) => sum + c.leadsGenerated, 0);
    const totalClients = campaigns.reduce((sum, c) => sum + c.clientsAcquired, 0);
    const totalRevenue = campaigns.reduce((sum, c) => sum + c.revenueGenerated, 0);
    const totalConnects = campaigns.reduce((sum, c) => sum + c.connectsUsed, 0);
    const totalProposals = campaigns.reduce((sum, c) => sum + c.proposalsSent, 0);

    const cpl = totalLeads > 0 ? Math.round((totalSpentBase / totalLeads) * 100) / 100 : 0;
    const cac = totalClients > 0 ? Math.round((totalSpentBase / totalClients) * 100) / 100 : totalSpentBase;
    const roi = totalSpentBase > 0 ? Math.round(((totalRevenue - totalSpentBase) / totalSpentBase) * 1000) / 10 : 0;

    return NextResponse.json({
      baseCurrency: COMPANY_BASE_CURRENCY,
      campaigns,
      summary: {
        totalSpentBase: Math.round(totalSpentBase * 100) / 100,
        totalLeads,
        totalClients,
        totalRevenue: Math.round(totalRevenue * 100) / 100,
        totalConnects,
        totalProposals,
        cpl,
        cac,
        roi,
      },
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
      return NextResponse.json({ error: "Permission denied. Only admins or owners can modify marketing campaigns." }, { status: 403 });
    }

    const body = await req.json();
    const {
      id,
      name,
      platform = "GOOGLE_ADS",
      campaignType = "SEARCH_ADS",
      spentAmount = 0,
      currency = COMPANY_BASE_CURRENCY,
      customExchangeRate,
      leadsGenerated = 0,
      clientsAcquired = 0,
      revenueGenerated = 0,
      connectsUsed = 0,
      proposalsSent = 0,
      startDate,
      endDate,
      notes,
    } = body;

    if (!name) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }

    const spent = parseFloat(spentAmount) || 0;
    const { amountBase, rate, source } = convertToBaseCurrency(
      spent,
      currency,
      customExchangeRate ? parseFloat(customExchangeRate) : null
    );

    let campaign;
    if (id) {
      campaign = await db.marketingCampaign.update({
        where: { id },
        data: {
          name,
          platform,
          campaignType,
          spentAmount: spent,
          currency: currency.toUpperCase(),
          exchangeRate: rate,
          exchangeRateDate: new Date(),
          exchangeRateSource: source,
          spentAmountBase: amountBase,
          baseCurrency: COMPANY_BASE_CURRENCY,
          leadsGenerated: parseInt(leadsGenerated, 10) || 0,
          clientsAcquired: parseInt(clientsAcquired, 10) || 0,
          revenueGenerated: parseFloat(revenueGenerated) || 0,
          connectsUsed: parseInt(connectsUsed, 10) || 0,
          proposalsSent: parseInt(proposalsSent, 10) || 0,
          startDate: startDate ? new Date(startDate) : new Date(),
          endDate: endDate ? new Date(endDate) : null,
          notes: notes || null,
        },
      });

      await logCostAudit({
        userId: user.id,
        userEmail: (user as any).email,
        action: "UPDATE",
        entityType: "MARKETING",
        entityId: id,
        details: { name, platform, spentBase: amountBase, rate, source },
      });
    } else {
      campaign = await db.marketingCampaign.create({
        data: {
          name,
          platform,
          campaignType,
          spentAmount: spent,
          currency: currency.toUpperCase(),
          exchangeRate: rate,
          exchangeRateDate: new Date(),
          exchangeRateSource: source,
          spentAmountBase: amountBase,
          baseCurrency: COMPANY_BASE_CURRENCY,
          leadsGenerated: parseInt(leadsGenerated, 10) || 0,
          clientsAcquired: parseInt(clientsAcquired, 10) || 0,
          revenueGenerated: parseFloat(revenueGenerated) || 0,
          connectsUsed: parseInt(connectsUsed, 10) || 0,
          proposalsSent: parseInt(proposalsSent, 10) || 0,
          startDate: startDate ? new Date(startDate) : new Date(),
          endDate: endDate ? new Date(endDate) : null,
          notes: notes || null,
        },
      });

      await logCostAudit({
        userId: user.id,
        userEmail: (user as any).email,
        action: "CREATE",
        entityType: "MARKETING",
        entityId: campaign.id,
        details: { name, platform, spentBase: amountBase, rate, source },
      });
    }

    return NextResponse.json({ campaign });
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
      return NextResponse.json({ error: "Permission denied. Only admins or owners can delete marketing records." }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing campaign id" }, { status: 400 });

    const existing = await db.marketingCampaign.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Campaign not found" }, { status: 404 });

    const snapshot = {
      name: existing.name,
      platform: existing.platform,
      spentAmount: existing.spentAmount,
      currency: existing.currency,
      spentAmountBase: existing.spentAmountBase,
    };

    await db.marketingCampaign.delete({ where: { id } });

    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "DELETE",
      entityType: "MARKETING",
      entityId: id,
      details: { snapshot, deletedBy: user.name },
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
