import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { convertToBaseCurrency, logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: AI API token spend and model usage records are restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. AI usage records are restricted to administrators." },
        { status: 403 }
      );
    }

    const records = await db.aIUsageRecord.findMany({
      orderBy: { usageDate: "desc" },
    });

    const totalCostBase = records.reduce((sum, r) => sum + r.costAmountBase, 0);
    const totalPromptTokens = records.reduce((sum, r) => sum + r.promptTokens, 0);
    const totalCompletionTokens = records.reduce((sum, r) => sum + r.completionTokens, 0);
    const totalTokens = records.reduce((sum, r) => sum + r.totalTokens, 0);

    const byProvider: Record<string, { cost: number; tokens: number }> = {};
    const byModel: Record<string, { cost: number; tokens: number }> = {};

    for (const r of records) {
      if (!byProvider[r.provider]) byProvider[r.provider] = { cost: 0, tokens: 0 };
      byProvider[r.provider].cost += r.costAmountBase;
      byProvider[r.provider].tokens += r.totalTokens;

      if (!byModel[r.model]) byModel[r.model] = { cost: 0, tokens: 0 };
      byModel[r.model].cost += r.costAmountBase;
      byModel[r.model].tokens += r.totalTokens;
    }

    return NextResponse.json({
      baseCurrency: COMPANY_BASE_CURRENCY,
      records,
      summary: {
        totalCostBase: Math.round(totalCostBase * 100) / 100,
        totalPromptTokens,
        totalCompletionTokens,
        totalTokens,
        byProvider,
        byModel,
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
      return NextResponse.json({ error: "Permission denied. Only admins or owners can record AI usage." }, { status: 403 });
    }

    const body = await req.json();

    // Support single record or batch array (for CSV import)
    const items = Array.isArray(body) ? body : [body];
    const createdRecords = [];

    for (const item of items) {
      const {
        provider = "DEEPSEEK",
        model,
        purpose = "CRM_VOICE_AI",
        promptTokens = 0,
        completionTokens = 0,
        totalTokens,
        costAmount = 0,
        currency = "USD",
        customExchangeRate,
        usageDate,
        billedPeriod,
        notes,
      } = item;

      if (!model) {
        continue;
      }

      const pTokens = parseInt(promptTokens, 10) || 0;
      const cTokens = parseInt(completionTokens, 10) || 0;
      const tTokens = totalTokens !== undefined ? parseInt(totalTokens, 10) : pTokens + cTokens;
      const cost = parseFloat(costAmount) || 0;

      const { amountBase, rate, source } = convertToBaseCurrency(
        cost,
        currency,
        customExchangeRate ? parseFloat(customExchangeRate) : null
      );

      const record = await db.aIUsageRecord.create({
        data: {
          provider,
          model,
          purpose,
          promptTokens: pTokens,
          completionTokens: cTokens,
          totalTokens: tTokens,
          costAmount: cost,
          currency: currency.toUpperCase(),
          exchangeRate: rate,
          exchangeRateDate: new Date(),
          exchangeRateSource: source,
          costAmountBase: amountBase,
          baseCurrency: COMPANY_BASE_CURRENCY,
          usageDate: usageDate ? new Date(usageDate) : new Date(),
          billedPeriod: billedPeriod || new Date().toISOString().slice(0, 7),
          notes: notes || null,
        },
      });
      createdRecords.push(record);
    }

    if (createdRecords.length > 0) {
      await logCostAudit({
        userId: user.id,
        userEmail: (user as any).email,
        action: "CREATE",
        entityType: "AI_USAGE",
        entityId: createdRecords[0].id,
        details: { count: createdRecords.length, sampleModel: createdRecords[0].model },
      });
    }

    return NextResponse.json({ records: createdRecords, count: createdRecords.length });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
