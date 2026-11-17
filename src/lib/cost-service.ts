import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import type {
  CostAuditAction,
  CostAuditEntity,
  BillingCycle,
  ExpensePaymentMethod,
  ExpensePaymentStatus,
  ExpenseClassification,
  InvestmentType,
  InvestorType,
  InvoiceStatus,
  AIProvider,
  MarketingPlatform,
  MarketingCampaignType,
} from "@prisma/client";

/**
 * Cyraops Default Company Reporting Currency
 * Primary reporting currency is Indian Rupee (INR - ₹).
 */
export const COMPANY_BASE_CURRENCY = "INR";

/**
 * System Benchmark Exchange Rates (Reference Baseline relative to INR).
 * Note: These are benchmark baseline rates used for estimation and fallback.
 * They are not real-time live forex ticker rates. Users/finance operators can
 * provide explicit transaction exchange rates from bank statements/forex slips.
 */
export const SYSTEM_BENCHMARK_RATES_TO_INR: Record<string, number> = {
  INR: 1.0,
  USD: 86.5,    // 1 USD = 86.50 INR
  EUR: 93.5,    // 1 EUR = 93.50 INR
  GBP: 110.0,   // 1 GBP = 110.00 INR
  AED: 23.55,   // 1 AED = 23.55 INR
  CAD: 62.0,    // 1 CAD = 62.00 INR
  AUD: 56.0,    // 1 AUD = 56.00 INR
  SGD: 65.0,    // 1 SGD = 65.00 INR
};

export function getExchangeRate(
  currency: string,
  customRate?: number | null
): { rate: number; source: "MANUAL_OVERRIDE" | "SYSTEM_BASELINE" } {
  if (customRate && customRate > 0) {
    return { rate: customRate, source: "MANUAL_OVERRIDE" };
  }
  const upper = currency.toUpperCase().trim();
  const rate = SYSTEM_BENCHMARK_RATES_TO_INR[upper] ?? 1.0;
  return { rate, source: "SYSTEM_BASELINE" };
}

export function convertToBaseCurrency(
  amount: number,
  currency: string,
  customRate?: number | null
): { amountBase: number; rate: number; source: "MANUAL_OVERRIDE" | "SYSTEM_BASELINE" } {
  const { rate, source } = getExchangeRate(currency, customRate);
  const amountBase = Math.round(amount * rate * 100) / 100;
  return { amountBase, rate, source };
}

export function computeFileHash(buffer: Buffer | Uint8Array): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function getRecurringPeriodKey(date: Date, cycle: BillingCycle): string {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  switch (cycle) {
    case "WEEKLY": {
      const firstDayOfYear = new Date(year, 0, 1);
      const pastDaysOfYear = (d.getTime() - firstDayOfYear.getTime()) / 86400000;
      const week = Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
      return `${year}-W${String(week).padStart(2, "0")}`;
    }
    case "MONTHLY":
      return `${year}-${month}`;
    case "QUARTERLY": {
      const q = Math.floor(d.getMonth() / 3) + 1;
      return `${year}-Q${q}`;
    }
    case "ANNUALLY":
      return `${year}`;
  }
}

export const DEFAULT_COST_CATEGORIES = [
  {
    name: "Marketing & Advertising",
    slug: "marketing-advertising",
    icon: "Megaphone",
    color: "#f59e0b",
    description: "Paid advertisements, marketing campaigns, and promotions",
    sortOrder: 1,
    subcategories: [
      { name: "Google Ads", slug: "google-ads", sortOrder: 1 },
      { name: "Meta Ads (Facebook/Instagram)", slug: "meta-ads", sortOrder: 2 },
      { name: "LinkedIn Ads", slug: "linkedin-ads", sortOrder: 3 },
      { name: "Influencer & Sponsorships", slug: "influencer-sponsorships", sortOrder: 4 },
      { name: "Other Advertising", slug: "other-advertising", sortOrder: 5 },
    ],
  },
  {
    name: "Client Acquisition",
    slug: "client-acquisition",
    icon: "Users",
    color: "#10b981",
    description: "Upwork connects, client bidding, outbound sales tools, and lead generation",
    sortOrder: 2,
    subcategories: [
      { name: "Upwork Connects", slug: "upwork-connects", sortOrder: 1 },
      { name: "Upwork Bidding & Boosts", slug: "upwork-bidding-boosts", sortOrder: 2 },
      { name: "Outbound Sales Tools (Apollo, Hunter, etc.)", slug: "outbound-sales-tools", sortOrder: 3 },
      { name: "Commissions & Referrals", slug: "commissions-referrals", sortOrder: 4 },
    ],
  },
  {
    name: "AI & API Usage",
    slug: "ai-api-usage",
    icon: "Cpu",
    color: "#6366f1",
    description: "LLM tokens, API credits, voice models, vision, and AI infrastructure",
    sortOrder: 3,
    subcategories: [
      { name: "DeepSeek API", slug: "deepseek-api", sortOrder: 1 },
      { name: "OpenAI API", slug: "openai-api", sortOrder: 2 },
      { name: "Anthropic Claude API", slug: "anthropic-claude-api", sortOrder: 3 },
      { name: "Google Gemini API", slug: "google-gemini-api", sortOrder: 4 },
      { name: "Other AI & LLM Providers", slug: "other-ai-providers", sortOrder: 5 },
    ],
  },
  {
    name: "Software & Subscriptions",
    slug: "software-subscriptions",
    icon: "Layers",
    color: "#8b5cf6",
    description: "SaaS subscriptions, developer tools, design software, and collaborative tools",
    sortOrder: 4,
    subcategories: [
      { name: "Development Tools (GitHub, Cursor, IDEs)", slug: "dev-tools", sortOrder: 1 },
      { name: "Productivity & Workspace (Google Workspace, Slack, Notion)", slug: "workspace-tools", sortOrder: 2 },
      { name: "CRM & Operations Software", slug: "crm-operations", sortOrder: 3 },
      { name: "Design & Media (Figma, Canva, Adobe)", slug: "design-media", sortOrder: 4 },
    ],
  },
  {
    name: "Infrastructure & Hosting",
    slug: "infrastructure-hosting",
    icon: "Server",
    color: "#06b6d4",
    description: "Cloud compute, servers, domains, databases, and networking",
    sortOrder: 5,
    subcategories: [
      { name: "Cloud Servers & Compute (AWS, GCP, Hetzner, DO)", slug: "cloud-compute", sortOrder: 1 },
      { name: "Domains & DNS (GoDaddy, Namecheap, Cloudflare)", slug: "domains-dns", sortOrder: 2 },
      { name: "Databases & Storage", slug: "databases-storage", sortOrder: 3 },
      { name: "CDN & Networking", slug: "cdn-networking", sortOrder: 4 },
    ],
  },
  {
    name: "Business Operations",
    slug: "business-operations",
    icon: "Briefcase",
    color: "#64748b",
    description: "General company expenses, office, equipment, legal, and banking",
    sortOrder: 6,
    subcategories: [
      { name: "Office & Rent", slug: "office-rent", sortOrder: 1 },
      { name: "Hardware & Equipment", slug: "hardware-equipment", sortOrder: 2 },
      { name: "Legal & Accounting", slug: "legal-accounting", sortOrder: 3 },
      { name: "Banking & Payment Gateway Fees", slug: "banking-payment-fees", sortOrder: 4 },
      { name: "Miscellaneous", slug: "miscellaneous", sortOrder: 5 },
    ],
  },
];

export async function ensureDefaultCategories() {
  for (const cat of DEFAULT_COST_CATEGORIES) {
    const parent = await db.expenseCategory.upsert({
      where: { slug: cat.slug },
      update: {
        name: cat.name,
        icon: cat.icon,
        color: cat.color,
        description: cat.description,
        isDefault: true,
        sortOrder: cat.sortOrder,
      },
      create: {
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
        color: cat.color,
        description: cat.description,
        isDefault: true,
        sortOrder: cat.sortOrder,
      },
    });

    for (const sub of cat.subcategories) {
      await db.expenseCategory.upsert({
        where: { slug: sub.slug },
        update: {
          name: sub.name,
          parentId: parent.id,
          isDefault: true,
          sortOrder: sub.sortOrder,
        },
        create: {
          name: sub.name,
          slug: sub.slug,
          parentId: parent.id,
          isDefault: true,
          sortOrder: sub.sortOrder,
        },
      });
    }
  }
}

export async function logCostAudit(params: {
  userId?: string | null;
  userEmail?: string | null;
  action: CostAuditAction;
  entityType: CostAuditEntity;
  entityId: string;
  details?: Record<string, any> | string;
  ipAddress?: string | null;
}) {
  try {
    const detailsStr = typeof params.details === "object" ? JSON.stringify(params.details) : params.details;
    await db.costAuditLog.create({
      data: {
        userId: params.userId ?? null,
        userEmail: params.userEmail ?? null,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        details: detailsStr ?? null,
        ipAddress: params.ipAddress ?? null,
      },
    });
  } catch (err) {
    console.error("[CostAuditLog Error]", err);
  }
}

export async function checkDuplicateInvoice(params: {
  vendor: string;
  invoiceNumber: string;
  totalAmount: number;
  fileHash?: string;
  excludeId?: string;
}) {
  const warnings: string[] = [];
  let isExactDuplicate = false;

  // 1. File Hash Check
  if (params.fileHash) {
    const existingFile = await db.invoiceRecord.findFirst({
      where: {
        fileHash: params.fileHash,
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
    if (existingFile) {
      warnings.push(`Identical file hash detected (Invoice #${existingFile.invoiceNumber} from ${existingFile.vendor}).`);
      isExactDuplicate = true;
    }
  }

  // 2. Vendor + Invoice Number match (Scoped strictly to the same vendor)
  if (params.vendor && params.invoiceNumber) {
    const existingInvoiceNumber = await db.invoiceRecord.findFirst({
      where: {
        vendor: { equals: params.vendor.trim(), mode: "insensitive" },
        invoiceNumber: { equals: params.invoiceNumber.trim(), mode: "insensitive" },
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
    if (existingInvoiceNumber) {
      warnings.push(`Invoice number "${params.invoiceNumber}" already exists for vendor "${params.vendor}".`);
      isExactDuplicate = true;
    }
  }

  // 3. Same Vendor + Exact Amount proximity check within 30 days
  if (params.vendor && params.totalAmount > 0) {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const similar = await db.invoiceRecord.findFirst({
      where: {
        vendor: { equals: params.vendor.trim(), mode: "insensitive" },
        totalAmount: { gte: params.totalAmount * 0.99, lte: params.totalAmount * 1.01 },
        createdAt: { gte: thirtyDaysAgo },
        ...(params.excludeId ? { id: { not: params.excludeId } } : {}),
      },
    });
    if (similar && !isExactDuplicate) {
      warnings.push(
        `Similar recent invoice found for ${params.vendor} (${similar.currency} ${similar.totalAmount} on ${similar.createdAt.toISOString().slice(0, 10)}).`
      );
    }
  }

  return { isExactDuplicate, warnings };
}

export function calculateNextDueDate(currentDate: Date, cycle: BillingCycle): Date {
  const next = new Date(currentDate);
  switch (cycle) {
    case "WEEKLY":
      next.setDate(next.getDate() + 7);
      break;
    case "MONTHLY":
      next.setMonth(next.getMonth() + 1);
      break;
    case "QUARTERLY":
      next.setMonth(next.getMonth() + 3);
      break;
    case "ANNUALLY":
      next.setFullYear(next.getFullYear() + 1);
      break;
  }
  return next;
}
