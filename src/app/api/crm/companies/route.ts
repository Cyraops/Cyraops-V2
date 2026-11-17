import { NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { logActivity, sameOrigin, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

const createCompanySchema = z.object({
  name: z.string().trim().min(2, "Company name must be at least 2 characters").max(180),
  domain: z.string().trim().max(180).optional().nullable(),
  industry: z.string().trim().max(100).optional().nullable(),
  size: z.string().trim().max(50).optional().nullable(),
  website: z.string().trim().max(255).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(500).optional().nullable(),
  notes: z.string().max(10000).optional().default(""),
});

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const searchParams = request.nextUrl.searchParams;
  const q = searchParams.get("q")?.trim() ?? "";
  const industry = searchParams.get("industry")?.trim();
  const size = searchParams.get("size")?.trim();
  const includeArchived = searchParams.get("includeArchived") === "true";
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") ?? "20", 10) || 20));
  const skip = (page - 1) * limit;

  const where: any = {};
  if (!includeArchived) {
    where.archivedAt = null;
  }
  if (industry) {
    where.industry = { equals: industry, mode: "insensitive" };
  }
  if (size) {
    where.size = size;
  }
  if (q) {
    where.OR = [
      { name: { contains: q, mode: "insensitive" } },
      { domain: { contains: q, mode: "insensitive" } },
      { industry: { contains: q, mode: "insensitive" } },
      { website: { contains: q, mode: "insensitive" } },
      { address: { contains: q, mode: "insensitive" } },
      { phone: { contains: q, mode: "insensitive" } },
    ];
  }

  const [total, companies] = await Promise.all([
    db.company.count({ where }),
    db.company.findMany({
      where,
      include: {
        _count: { select: { contacts: true, deals: true, leads: true } },
      },
      orderBy: [{ name: "asc" }],
      skip,
      take: limit,
    }),
  ]);

  return Response.json({
    companies,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 1,
  });
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return jsonError("Invalid request origin", 403);
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const body = await request.json().catch(() => null);
  const parsed = createCompanySchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(parsed.error.issues[0]?.message ?? "Invalid company payload", 400);
  }

  const data = parsed.data;
  const normalizedName = data.name.trim();
  const normalizedDomain = data.domain ? data.domain.toLowerCase().trim() : null;

  // Duplicate check for active companies
  const nameDup = await db.company.findFirst({
    where: { name: { equals: normalizedName, mode: "insensitive" }, archivedAt: null },
    select: { id: true, name: true },
  });
  if (nameDup) {
    return jsonError(`An active company named "${normalizedName}" already exists.`, 409);
  }

  if (normalizedDomain) {
    const domainDup = await db.company.findFirst({
      where: { domain: { equals: normalizedDomain, mode: "insensitive" }, archivedAt: null },
      select: { id: true, name: true },
    });
    if (domainDup) {
      return jsonError(`An active company with domain "${normalizedDomain}" already exists ("${domainDup.name}").`, 409);
    }
  }

  try {
    const company = await db.company.create({
      data: {
        name: normalizedName,
        domain: normalizedDomain,
        industry: data.industry || null,
        size: data.size || null,
        website: data.website || null,
        phone: data.phone || null,
        address: data.address || null,
        notes: data.notes,
      },
    });

    await logActivity({
      action: "created",
      entity: "company",
      entityId: company.id,
      summary: `created company "${company.name}"`,
      userId: user.id,
    });

    return Response.json({ company }, { status: 201 });
  } catch (error: any) {
    if (error?.code === "P2002") {
      return jsonError(`An active company with this name or domain already exists.`, 409);
    }
    console.error("[CRM] Failed to create company:", error);
    return jsonError("Failed to create company", 500);
  }
}
