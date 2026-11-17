import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const [
    totalLeads,
    newLeads,
    qualifiedLeads,
    openDealsList,
    wonDealsList,
    lostDealsCount,
    totalContacts,
    totalCompanies,
  ] = await Promise.all([
    db.lead.count({ where: { archivedAt: null } }),
    db.lead.count({ where: { archivedAt: null, status: "NEW" } }),
    db.lead.count({ where: { archivedAt: null, status: "QUALIFIED" } }),
    db.deal.findMany({
      where: {
        archivedAt: null,
        stage: { notIn: ["CLOSED_WON", "CLOSED_LOST"] },
      },
      select: { value: true, currency: true },
    }),
    db.deal.findMany({
      where: {
        archivedAt: null,
        stage: "CLOSED_WON",
      },
      select: { value: true, currency: true },
    }),
    db.deal.count({
      where: {
        archivedAt: null,
        stage: "CLOSED_LOST",
      },
    }),
    db.contact.count({ where: { archivedAt: null } }),
    db.company.count({ where: { archivedAt: null } }),
  ]);

  const openDealsCount = openDealsList.length;
  const wonDealsCount = wonDealsList.length;

  // Calculate pipeline and won values with strict INR currency attribution (F-P2-03)
  let pipelineValueINR = 0;
  for (const d of openDealsList) {
    if (d.currency === "INR") {
      pipelineValueINR += d.value;
    }
  }

  let wonValueINR = 0;
  for (const d of wonDealsList) {
    if (d.currency === "INR") {
      wonValueINR += d.value;
    }
  }

  const closedTotal = wonDealsCount + lostDealsCount;
  const winRatePercent = closedTotal > 0 ? Math.round((wonDealsCount / closedTotal) * 100) : 0;

  return Response.json({
    currency: "INR",
    totalLeads,
    newLeads,
    qualifiedLeads,
    openDeals: openDealsCount,
    pipelineValue: pipelineValueINR,
    wonDeals: wonDealsCount,
    wonValue: wonValueINR,
    lostDeals: lostDealsCount,
    winRate: winRatePercent,
    totalContacts,
    totalCompanies,
  });
}

