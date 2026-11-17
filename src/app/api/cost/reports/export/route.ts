import { NextRequest, NextResponse } from "next/server";
import { sameOrigin, userFromRequest } from "@/lib/auth";
import { db } from "@/lib/db";
import { logCostAudit, COMPANY_BASE_CURRENCY } from "@/lib/cost-service";

function escapeCsvField(val: any): string {
  if (val === null || val === undefined) return '""';
  const str = String(val).replace(/"/g, '""');
  return `"${str}"`;
}

interface ReportExportParams {
  type: string;
  format: string;
  startDate?: string | null;
  endDate?: string | null;
}

async function buildReportData({ type, format, startDate, endDate }: ReportExportParams) {
  const dateFilter: any = {};
  if (startDate || endDate) {
    dateFilter.paymentDate = {};
    if (startDate) dateFilter.paymentDate.gte = new Date(startDate);
    if (endDate) dateFilter.paymentDate.lte = new Date(endDate);
  }

  let csvContent = "";
  let jsonData: any = null;
  const filename = `cyraops_${type}_${new Date().toISOString().slice(0, 10)}`;

  if (type === "expenses") {
    const expenses = await db.expense.findMany({
      where: dateFilter,
      include: {
        category: true,
        subcategory: true,
        user: { select: { name: true } },
      },
      orderBy: { paymentDate: "desc" },
    });

    if (format === "csv") {
      const headers = [
        "ID",
        "Date",
        "Title",
        "Vendor",
        "Category",
        "Subcategory",
        "Classification",
        "Amount",
        "Currency",
        "Exchange Rate",
        "Rate Source",
        `Amount (${COMPANY_BASE_CURRENCY} Base)`,
        "Payment Method",
        "Payment Status",
        "Invoice Number",
        "Recorded By",
        "Notes",
      ];
      const rows = expenses.map((e) => [
        e.id,
        e.paymentDate.toISOString().slice(0, 10),
        e.title,
        e.vendor,
        e.category.name,
        e.subcategory?.name || "",
        e.classification,
        e.amount,
        e.currency,
        e.exchangeRate,
        e.exchangeRateSource,
        e.amountBase,
        e.paymentMethod,
        e.paymentStatus,
        e.invoiceNumber || "",
        e.user?.name || "",
        e.notes || "",
      ]);
      csvContent = [headers.join(","), ...rows.map((r) => r.map(escapeCsvField).join(","))].join("\n");
    } else {
      jsonData = expenses;
    }
  } else if (type === "investments") {
    const investments = await db.investment.findMany({
      include: { user: { select: { name: true } } },
      orderBy: { date: "desc" },
    });
    if (format === "csv") {
      const headers = [
        "ID",
        "Date",
        "Title",
        "Investor Name",
        "Investor Type",
        "Investment Type",
        "Amount",
        "Currency",
        "Exchange Rate",
        `Amount (${COMPANY_BASE_CURRENCY} Base)`,
        "Equity Percentage (%)",
        "Reference Number",
        "Recorded By",
        "Notes",
      ];
      const rows = investments.map((inv) => [
        inv.id,
        inv.date.toISOString().slice(0, 10),
        inv.title,
        inv.investorName,
        inv.investorType,
        inv.type,
        inv.amount,
        inv.currency,
        inv.exchangeRate,
        inv.amountBase,
        inv.equityPercentage ?? "",
        inv.referenceNumber ?? "",
        inv.user?.name ?? "",
        inv.notes ?? "",
      ]);
      csvContent = [headers.join(","), ...rows.map((r) => r.map(escapeCsvField).join(","))].join("\n");
    } else {
      jsonData = investments;
    }
  } else if (type === "recurring") {
    const recurring = await db.recurringExpense.findMany({
      include: { category: true, user: { select: { name: true } } },
      orderBy: { nextDueDate: "asc" },
    });
    if (format === "csv") {
      const headers = [
        "ID",
        "Title",
        "Vendor",
        "Category",
        "Billing Cycle",
        "Amount",
        "Currency",
        `Amount (${COMPANY_BASE_CURRENCY} Base)`,
        "Next Due Date",
        "Auto Renew",
        "Status",
        "Recorded By",
        "Notes",
      ];
      const rows = recurring.map((r) => [
        r.id,
        r.title,
        r.vendor,
        r.category.name,
        r.billingCycle,
        r.amount,
        r.currency,
        r.amountBase,
        r.nextDueDate.toISOString().slice(0, 10),
        r.autoRenew ? "YES" : "NO",
        r.status,
        r.user?.name || "",
        r.notes || "",
      ]);
      csvContent = [headers.join(","), ...rows.map((r) => r.map(escapeCsvField).join(","))].join("\n");
    } else {
      jsonData = recurring;
    }
  } else if (type === "ai") {
    const aiRecords = await db.aIUsageRecord.findMany({
      orderBy: { usageDate: "desc" },
    });
    if (format === "csv") {
      const headers = [
        "ID",
        "Date",
        "Provider",
        "Model",
        "Prompt Tokens",
        "Completion Tokens",
        "Total Tokens",
        "Cost Amount",
        "Currency",
        `Cost (${COMPANY_BASE_CURRENCY} Base)`,
        "Purpose",
      ];
      const rows = aiRecords.map((r) => [
        r.id,
        r.usageDate.toISOString().slice(0, 10),
        r.provider,
        r.model,
        r.promptTokens,
        r.completionTokens,
        r.totalTokens,
        r.costAmount,
        r.currency,
        r.costAmountBase,
        r.purpose || "",
      ]);
      csvContent = [headers.join(","), ...rows.map((r) => r.map(escapeCsvField).join(","))].join("\n");
    } else {
      jsonData = aiRecords;
    }
  } else if (type === "marketing") {
    const campaigns = await db.marketingCampaign.findMany({
      orderBy: { startDate: "desc" },
    });
    if (format === "csv") {
      const headers = [
        "ID",
        "Campaign Name",
        "Platform",
        "Campaign Type",
        "Spent Amount",
        "Currency",
        `Spent (${COMPANY_BASE_CURRENCY} Base)`,
        "Leads",
        "Clients",
        "Revenue",
        "CPL",
        "CAC",
        "ROI",
        "Connects Used",
        "Proposals Sent",
        "Start Date",
      ];
      const rows = campaigns.map((c) => {
        const cpl = c.leadsGenerated > 0 ? Math.round((c.spentAmountBase / c.leadsGenerated) * 100) / 100 : 0;
        const cac = c.clientsAcquired > 0 ? Math.round((c.spentAmountBase / c.clientsAcquired) * 100) / 100 : c.spentAmountBase;
        const roi = c.spentAmountBase > 0 ? Math.round(((c.revenueGenerated - c.spentAmountBase) / c.spentAmountBase) * 1000) / 10 : 0;
        return [
          c.id,
          c.name,
          c.platform,
          c.campaignType,
          c.spentAmount,
          c.currency,
          c.spentAmountBase,
          c.leadsGenerated,
          c.clientsAcquired,
          c.revenueGenerated,
          COMPANY_BASE_CURRENCY + " " + cpl,
          COMPANY_BASE_CURRENCY + " " + cac,
          roi + "%",
          c.connectsUsed,
          c.proposalsSent,
          c.startDate.toISOString().slice(0, 10),
        ];
      });
      csvContent = [headers.join(","), ...rows.map((r) => r.map(escapeCsvField).join(","))].join("\n");
    } else {
      jsonData = campaigns;
    }
  }

  return { csvContent, jsonData, filename };
}

function formatResponse(format: string, filename: string, csvContent: string, jsonData: any) {
  if (format === "json") {
    return NextResponse.json(jsonData);
  }

  return new NextResponse(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}.csv"`,
    },
  });
}

/**
 * Mutating POST export endpoint (Primary / Standard):
 * Enforces sameOrigin CSRF protection, checks OWNER/ADMIN role, awaits audit logging,
 * and returns the report file stream.
 */
export async function POST(req: NextRequest) {
  try {
    if (!sameOrigin(req)) {
      return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
    }

    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Financial reports export is restricted to administrators." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const type = body.type || "expenses";
    const format = body.format || "csv";
    const startDate = body.startDate;
    const endDate = body.endDate;

    const { csvContent, jsonData, filename } = await buildReportData({ type, format, startDate, endDate });

    // Explicitly record compliance audit trail on mutation
    await logCostAudit({
      userId: user.id,
      userEmail: (user as any).email,
      action: "EXPORT",
      entityType: "EXPENSE",
      entityId: type,
      details: { format, filename, exportedBy: user.name, method: "POST" },
    });

    return formatResponse(format, filename, csvContent, jsonData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * Strictly Read-Only GET export endpoint (Legacy Browser Download Compatibility):
 * Checks OWNER/ADMIN role and provides report download without any database writes.
 * Note: To preserve pure HTTP GET idempotence and avoid database mutations during GET,
 * legacy GET downloads are not recorded in the compliance audit log.
 * Compliance-audited exports are exclusively executed via POST /api/cost/reports/export.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await userFromRequest(req);
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    // Strict Authorization: Financial reports and ledgers export is strictly restricted to OWNER and ADMIN
    if (user.role !== "OWNER" && user.role !== "ADMIN") {
      return NextResponse.json(
        { error: "Permission denied. Financial reports export is restricted to administrators." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const type = searchParams.get("type") || "expenses";
    const format = searchParams.get("format") || "csv";
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");

    const { csvContent, jsonData, filename } = await buildReportData({ type, format, startDate, endDate });

    // Strictly read-only: No database writes are performed on HTTP GET.
    return formatResponse(format, filename, csvContent, jsonData);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
