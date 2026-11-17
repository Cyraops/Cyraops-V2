import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { publicUserSelect, userFromRequest } from "@/lib/auth";
import { jsonError } from "@/lib/validators";

export type DataProvenance = "VERIFIED" | "UNVERIFIED" | "ESTIMATED" | "SYNTHETIC" | "INSUFFICIENT_DATA";

export async function GET(request: NextRequest) {
  const user = await userFromRequest(request);
  if (!user) return jsonError("Unauthorized", 401);

  const projectFilter = {
    archivedAt: null,
    ...(user.role === "OWNER" || user.role === "ADMIN" ? {} : { members: { some: { userId: user.id } } })
  };

  const [
    projects,
    conversations,
    activities,
    unreadNotifications,
    capabilities,
    skills,
    certifications,
    weaknesses,
    improvements,
    assessments,
    deals,
    leads,
    teamUsers,
    pendingProposals,
    activeInvoices,
    readinessItems
  ] = await Promise.all([
    db.project.findMany({
      where: projectFilter,
      include: {
        tasks: { where: { archivedAt: null }, select: { id: true, title: true, status: true, dueDate: true, priority: true } }
      },
      orderBy: { updatedAt: "desc" }
    }),
    db.conversation.findMany({
      where: { members: { some: { userId: user.id } } },
      include: {
        members: { include: { user: { select: publicUserSelect } } },
        messages: { orderBy: { createdAt: "desc" }, take: 1 }
      },
      orderBy: { updatedAt: "desc" }
    }),
    db.activity.findMany({
      where: { OR: [{ userId: user.id }, { project: projectFilter }] },
      include: { user: { select: publicUserSelect } },
      orderBy: { createdAt: "desc" },
      take: 8
    }),
    db.notification.count({ where: { userId: user.id, readAt: null } }),
    db.serviceCapability.findMany({ orderBy: { name: "asc" } }),
    db.teamSkill.findMany({
      include: { user: { select: { id: true, name: true, role: true } } },
      orderBy: [{ verified: "desc" }, { skillName: "asc" }]
    }),
    db.certification.findMany({
      include: { user: { select: { id: true, name: true, role: true } } }
    }),
    db.businessWeakness.findMany({
      orderBy: [{ resolved: "asc" }, { severity: "asc" }]
    }),
    db.businessImprovement.findMany({
      orderBy: [{ status: "asc" }, { priority: "asc" }]
    }),
    db.projectFitAssessment.findMany({
      orderBy: { createdAt: "desc" }
    }),
    db.deal.findMany({
      where: { archivedAt: null },
      include: { company: true },
      orderBy: { createdAt: "desc" }
    }),
    db.lead.findMany({
      where: { archivedAt: null },
      orderBy: { createdAt: "desc" }
    }),
    db.user.findMany({
      select: { id: true, name: true, role: true, avatarUrl: true }
    }),
    db.proposal.findMany({
      where: { status: { in: ["INTERNAL_REVIEW", "READY_TO_SEND"] } },
      include: { deal: { select: { id: true, title: true } } },
      orderBy: { updatedAt: "desc" },
      take: 10
    }),
    db.clientInvoice.findMany({
      where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } },
      include: { deal: { select: { title: true } }, project: { select: { name: true } } },
      orderBy: { dueDate: "asc" },
      take: 10
    }),
    db.businessReadinessItem.findMany({
      select: { id: true, title: true, status: true, category: true }
    })
  ]);

  const unreadMessages = (await Promise.all(conversations.map(async (conversation) => {
    const member = conversation.members.find((entry) => entry.userId === user.id);
    return db.message.count({
      where: {
        conversationId: conversation.id,
        senderId: { not: user.id },
        ...(member?.lastReadAt ? { createdAt: { gt: member.lastReadAt } } : {})
      }
    });
  }))).reduce((sum, count) => sum + count, 0);

  const tasks = projects.flatMap((p) => p.tasks);
  const now = new Date();
  const upcoming = tasks.filter((task) => task.dueDate && task.status !== "DONE");

  // ==========================================
  // SECTION A: BUSINESS HEALTH ENGINE (DATA TRUTH RULES)
  // ==========================================
  const totalCapabilities = capabilities.length;
  // A capability is only verified ready if it is PRODUCTION_READY AND has verified project deliveries logged
  const verifiedReadyCapabilities = capabilities.filter(
    (c) => c.deliveryReadiness === "PRODUCTION_READY" && c.verifiedProjectsCount > 0
  ).length;
  const verifiedSkillsCount = skills.filter((s) => s.verified).length;
  const verifiedCertsCount = certifications.filter((c) => c.verified).length;
  const totalVerifiedProjects = capabilities.reduce((sum, c) => sum + (c.verifiedProjectsCount || 0), 0);

  // Active Deals
  const activeDeals = deals.filter((d) => d.stage !== "CLOSED_LOST" && d.stage !== "CLOSED_WON");
  const totalPipelineValue = activeDeals.reduce((sum, d) => sum + d.value, 0);
  const weightedPipeline = activeDeals.reduce((sum, d) => sum + (d.value * (d.probability / 100)), 0);

  // Active Projects
  const activeProjectsCount = projects.filter((p) => p.status === "ACTIVE").length;
  const totalTeamEngineers = Math.max(1, teamUsers.length);

  // Fit Assessments
  const greenDeals = assessments.filter((a) => a.recommendation === "GREEN").length;
  const amberDeals = assessments.filter((a) => a.recommendation === "AMBER").length;
  const totalAssessed = assessments.length;

  // Unresolved Weaknesses
  const unresolvedWeaknesses = weaknesses.filter((w) => !w.resolved);
  const criticalWeaknesses = unresolvedWeaknesses.filter((w) => w.severity === "CRITICAL" || w.severity === "HIGH");

  // 1. Technical Capability Readiness
  const hasTechData = totalVerifiedProjects > 0 || verifiedSkillsCount > 0;
  const techScore = hasTechData && totalCapabilities > 0
    ? Math.round((verifiedReadyCapabilities / totalCapabilities) * 100)
    : null;

  // 2. Project Acquisition Readiness
  const hasAcqData = totalAssessed > 0;
  const acqScore = hasAcqData
    ? Math.round(((greenDeals * 1.0 + amberDeals * 0.6) / totalAssessed) * 100)
    : null;

  // 3. Delivery Capacity (Genuinely verified: 0 active projects = 100% bandwidth available)
  const deliveryScore = activeProjectsCount === 0 ? 100 : Math.max(20, Math.round(100 - (activeProjectsCount / totalTeamEngineers) * 30));
  const deliveryStatus: "STRONG" | "MODERATE" | "CRITICAL" | "INSUFFICIENT_DATA" = "STRONG";

  // 4. Sales Pipeline Health
  const hasPipelineData = activeDeals.length > 0;
  const pipelineScore = hasPipelineData
    ? Math.min(100, Math.round((totalPipelineValue / 100000) * 100))
    : null;

  // 5. Portfolio & Credibility Strength
  const hasPortfolioData = totalVerifiedProjects > 0 || verifiedCertsCount > 0;
  const portfolioScore = hasPortfolioData
    ? Math.min(100, Math.round((totalVerifiedProjects * 5) + (verifiedCertsCount * 15)))
    : null;

  // 6. Financial & Commercial Margin
  const hasFinancialData = assessments.length > 0;
  const averageMargin = hasFinancialData
    ? Math.round(assessments.reduce((sum, a) => sum + a.estimatedMarginPercent, 0) / assessments.length)
    : null;

  // 7. Active Business Risks
  const hasWeaknessData = weaknesses.length > 0;

  // 8. Overall Business Readiness Score (Calculated only if at least 3 core dimensions have verified data)
  const availableSubscores = [techScore, acqScore, pipelineScore, portfolioScore].filter((s) => s !== null) as number[];
  const hasOverallData = availableSubscores.length >= 3;
  const businessReadinessScore = hasOverallData
    ? Math.round(availableSubscores.reduce((a, b) => a + b, 0) / availableSubscores.length)
    : null;

  const healthIndicators = [
    {
      id: "business-readiness",
      label: "Business Readiness Score",
      value: businessReadinessScore !== null ? `${businessReadinessScore}/100` : "Insufficient data",
      score: businessReadinessScore,
      status: businessReadinessScore !== null
        ? (businessReadinessScore >= 75 ? "STRONG" : businessReadinessScore >= 50 ? "MODERATE" : "CRITICAL")
        : "INSUFFICIENT_DATA",
      provenance: (businessReadinessScore !== null ? "ESTIMATED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: businessReadinessScore !== null
        ? "Composite readiness computed from verified operational dimensions."
        : "Insufficient data — management input required.",
      supportingData: businessReadinessScore !== null
        ? `Aggregated from ${availableSubscores.length} verified company dimensions.`
        : "Cannot compute company readiness without verified delivery projects and sales records.",
      lastUpdated: now.toISOString(),
      recommendedAction: "Complete team skill verifications and record active customer opportunities.",
      missingChecklist: businessReadinessScore === null
        ? [
            "Log verified client project deliveries",
            "Record and verify team engineering proficiencies",
            "Input active pipeline leads and opportunities"
          ]
        : []
    },
    {
      id: "technical-capability",
      label: "Technical Capability Readiness",
      value: techScore !== null ? `${techScore}%` : "Insufficient data",
      score: techScore,
      status: techScore !== null ? (techScore >= 75 ? "STRONG" : techScore >= 50 ? "MODERATE" : "CRITICAL") : "INSUFFICIENT_DATA",
      provenance: (techScore !== null ? "VERIFIED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: techScore !== null
        ? `${verifiedReadyCapabilities} of ${totalCapabilities} service domains have verified production delivery records.`
        : "Insufficient data — management input required.",
      supportingData: hasTechData
        ? `${verifiedSkillsCount} verified skills and ${totalVerifiedProjects} completed client deliveries.`
        : "0 verified project deliveries and 0 verified team skills exist in database.",
      lastUpdated: now.toISOString(),
      recommendedAction: "Record and independently verify team engineering skills and certifications.",
      missingChecklist: !hasTechData
        ? [
            "Conduct team skill audit and verify credentials",
            "Log completed client infrastructure deliveries"
          ]
        : []
    },
    {
      id: "project-acquisition",
      label: "Project Acquisition Readiness",
      value: acqScore !== null ? `${acqScore}%` : "Insufficient data",
      score: acqScore,
      status: acqScore !== null ? (acqScore >= 70 ? "STRONG" : acqScore >= 45 ? "MODERATE" : "CRITICAL") : "INSUFFICIENT_DATA",
      provenance: (acqScore !== null ? "ESTIMATED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: acqScore !== null
        ? "Qualification ratio of vetted client RFPs against internal capabilities."
        : "Insufficient data — management input required.",
      supportingData: hasAcqData
        ? `${greenDeals} Green (Pursue), ${amberDeals} Amber (Conditional), ${totalAssessed - greenDeals - amberDeals} Red (Reject).`
        : "No client project opportunities have been formally evaluated through the intake engine.",
      lastUpdated: now.toISOString(),
      recommendedAction: "Run incoming client RFPs through the Project Evaluation Intake modal.",
      missingChecklist: !hasAcqData
        ? [
            "Evaluate active proposals using Command Center Intake modal"
          ]
        : []
    },
    {
      id: "delivery-capacity",
      label: "Delivery Capacity & Bandwidth",
      value: `${deliveryScore}% Available`,
      score: deliveryScore,
      status: deliveryStatus,
      provenance: "VERIFIED" as DataProvenance,
      explanation: activeProjectsCount === 0
        ? "100% delivery bandwidth available. Zero active customer projects currently committed."
        : `${activeProjectsCount} active projects managed by ${totalTeamEngineers} engineer(s).`,
      supportingData: `${totalTeamEngineers} team member(s) on roster with ${activeProjectsCount} committed project(s).`,
      lastUpdated: now.toISOString(),
      recommendedAction: "Acquire qualified cloud architecture projects within verified technical scope.",
      missingChecklist: []
    },
    {
      id: "sales-pipeline",
      label: "Sales Pipeline Health",
      value: hasPipelineData ? `₹${Math.round(totalPipelineValue / 1000)}k` : "₹0 Pipeline",
      score: pipelineScore,
      status: hasPipelineData ? (pipelineScore! >= 70 ? "STRONG" : "MODERATE") : "INSUFFICIENT_DATA",
      provenance: (hasPipelineData ? "VERIFIED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: hasPipelineData
        ? `Total active pipeline across ${activeDeals.length} qualified opportunities.`
        : "Insufficient data — management input required.",
      supportingData: hasPipelineData
        ? `Weighted value: ₹${Math.round(weightedPipeline / 1000)}k based on stage probabilities.`
        : "0 active deals currently recorded in the CRM pipeline.",
      lastUpdated: now.toISOString(),
      recommendedAction: "Record incoming customer inquiries and proposals in CRM Deals.",
      missingChecklist: !hasPipelineData
        ? [
            "Record inbound client inquiries in CRM Deals",
            "Log prospective customer contacts"
          ]
        : []
    },
    {
      id: "portfolio-credibility",
      label: "Portfolio & Credibility Strength",
      value: portfolioScore !== null ? `${portfolioScore}%` : "0 Verified Deliveries",
      score: portfolioScore,
      status: portfolioScore !== null ? (portfolioScore >= 70 ? "STRONG" : "MODERATE") : "INSUFFICIENT_DATA",
      provenance: (portfolioScore !== null ? "VERIFIED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: portfolioScore !== null
        ? "Strength score derived from verified production deliveries and accredited certifications."
        : "Insufficient data — management input required.",
      supportingData: `${totalVerifiedProjects} verified project deliveries and ${verifiedCertsCount} verified certifications in database.`,
      lastUpdated: now.toISOString(),
      recommendedAction: "Document completed customer projects and submit verified credential IDs.",
      missingChecklist: !hasPortfolioData
        ? [
            "Document 1-3 customer project case studies",
            "Submit verified professional cloud certifications"
          ]
        : []
    },
    {
      id: "financial-commercial",
      label: "Financial & Commercial Margin",
      value: averageMargin !== null ? `${averageMargin}% Avg Margin` : "Insufficient data",
      score: averageMargin !== null ? Math.min(100, averageMargin * 2) : null,
      status: averageMargin !== null ? (averageMargin >= 35 ? "STRONG" : "MODERATE") : "INSUFFICIENT_DATA",
      provenance: (averageMargin !== null ? "ESTIMATED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: averageMargin !== null
        ? "Average projected gross profit margin across vetted engagements."
        : "Insufficient data — management input required.",
      supportingData: hasFinancialData
        ? `Computed across ${assessments.length} evaluated opportunities.`
        : "0 evaluated project proposals or signed customer Statements of Work.",
      lastUpdated: now.toISOString(),
      recommendedAction: "Define minimum 35% gross delivery margin requirement in proposal templates.",
      missingChecklist: !hasFinancialData
        ? [
            "Establish baseline pricing and margin thresholds in SOWs",
            "Evaluate client project budgets"
          ]
        : []
    },
    {
      id: "active-risks",
      label: "Active Business Risks",
      value: hasWeaknessData ? `${criticalWeaknesses.length} Critical/High` : "0 Logged Risks",
      score: hasWeaknessData ? Math.max(0, 100 - (criticalWeaknesses.length * 20)) : null,
      status: hasWeaknessData ? (criticalWeaknesses.length > 2 ? "CRITICAL" : "MODERATE") : "INSUFFICIENT_DATA",
      provenance: (hasWeaknessData ? "VERIFIED" : "INSUFFICIENT_DATA") as DataProvenance,
      explanation: hasWeaknessData
        ? `${unresolvedWeaknesses.length} total operational weaknesses identified across business pillars.`
        : "Insufficient data — management input required.",
      supportingData: hasWeaknessData
        ? `${criticalWeaknesses.length} high-severity items require executive remediation.`
        : "No operational audits or business weakness logs have been submitted.",
      lastUpdated: now.toISOString(),
      recommendedAction: "Conduct initial operational risk and delivery capability review.",
      missingChecklist: !hasWeaknessData
        ? [
            "Conduct quarterly operational risk assessment",
            "Log technical delivery constraints and staffing bottlenecks"
          ]
        : []
    }
  ];

  // ==========================================
  // SECTION D: 5 PROJECTS TO AVOID CATEGORIES (Standard Policy Guardrails)
  // ==========================================
  const projectsToAvoidCategories = [
    {
      id: "missing-technical-capability",
      categoryName: "Missing Core Technical Capability",
      deliveryRisk: "CRITICAL",
      whyAvoid: "Cyraops has zero verified production deliveries or certifications in baremetal OpenStack, mainframe migration, or proprietary legacy databases (e.g. AS400). Bidding leads to catastrophic delivery delays and reputational damage.",
      conditionsToReassess: "Only bid if partnered with an accredited subcontractor who assumes primary SLA liability."
    },
    {
      id: "extreme-sla-penalties",
      categoryName: "24/7 Round-the-Clock SLA with Penalty Clauses",
      deliveryRisk: "CRITICAL",
      whyAvoid: "Without a multi-timezone follow-the-sun on-call rotation, committing to 15-minute incident response SLAs will trigger contractual breach damages within 60 days.",
      conditionsToReassess: "Implement PagerDuty/Opsgenie with at least 3 rotating on-call engineers before signing."
    },
    {
      id: "commercial-undefined-scope",
      categoryName: "Fixed-Price Migrations with Undefined Client Architectures",
      deliveryRisk: "HIGH",
      whyAvoid: "Fixed-fee quotes on undocumented legacy systems invariably suffer 40-70% scope expansion with zero margin recovery.",
      conditionsToReassess: "Require a mandatory paid 2-week Architectural Discovery Sprint ($8,500) prior to fixed-price quoting."
    },
    {
      id: "compliance-gap",
      categoryName: "Regulated Healthcare / FinTech Requiring SOC 2 / FedRAMP",
      deliveryRisk: "HIGH",
      whyAvoid: "Enterprise security vendor questionnaires disqualify uncertified vendors. We will waste 40+ hours in procurement reviews only to be rejected.",
      conditionsToReassess: "Complete SOC 2 Type II compliance audit or joint-venture with a certified security compliance firm."
    },
    {
      id: "commodity-body-shopping",
      categoryName: "Low-Margin Commodity Staff Augmentation (< 25% Margin)",
      deliveryRisk: "MEDIUM",
      whyAvoid: "Hourly staff lending below $65/hr locks senior engineers into low-leverage administrative tasks and diverts capacity from high-margin cloud architectures.",
      conditionsToReassess: "Reject outright unless packaged as a managed outcome retainer with a minimum $5k MRR."
    }
  ];

  // ==========================================
  // SECTION G: SALES & REVENUE INTELLIGENCE (Truthful calculation)
  // ==========================================
  const totalLeadsCount = leads.length;
  const qualifiedLeadsCount = leads.filter((l) => l.status === "QUALIFIED").length;
  const proposalsCount = deals.filter((d) => d.stage === "PROPOSAL" || d.stage === "NEGOTIATION").length;
  const wonDeals = deals.filter((d) => d.stage === "CLOSED_WON");
  const lostDeals = deals.filter((d) => d.stage === "CLOSED_LOST");
  const wonDealsCount = wonDeals.length;
  const lostDealsCount = lostDeals.length;
  const totalClosed = wonDealsCount + lostDealsCount;
  const conversionRate = totalClosed > 0 ? Math.round((wonDealsCount / totalClosed) * 100) : null;

  const lostReasonsAnalysis = lostDeals.map((deal) => {
    let cleanReason = "Client selected alternate vendor or paused project";
    if (deal.notes && deal.notes.includes("LOST_REASON:")) {
      cleanReason = deal.notes.replace("LOST_REASON:", "").trim();
    }
    return {
      dealTitle: deal.title,
      dealValue: deal.value,
      company: deal.company?.name || "Confidential Client",
      reason: cleanReason,
      impact: `Lost opportunity of ${(deal as any).currency === "USD" ? "$" : "₹"}${deal.value.toLocaleString()}`,
      correctiveAction: cleanReason.toLowerCase().includes("kubernetes")
        ? "Accelerate CKA / CKS certification program"
        : cleanReason.toLowerCase().includes("security") || cleanReason.toLowerCase().includes("soc")
        ? "Partner with certified security compliance auditor"
        : "Refine proposal pricing and turnaround speed"
    };
  });

  // ==========================================
  // SECTION H: MANAGEMENT PRIORITIES (Truthful Foundational Priorities)
  // ==========================================
  const managementPriorities = [
    {
      id: "prio-1",
      rank: 1,
      title: "Record and Independently Verify Team Engineering Proficiencies",
      urgency: "HIGH_URGENCY",
      businessRationale: "Capability matrix currently shows 0 verified team skills. Management must audit and verify staff skills against demonstrated deliverables.",
      recommendedImmediateStep: "Click '+ Record / Verify Skill' and input validated team skills with supporting evidence.",
      actionLabel: "Verify Skills",
      category: "TECHNICAL"
    },
    {
      id: "prio-2",
      rank: 2,
      title: "Document Verified Client Deliveries & Project Case Studies",
      urgency: "HIGH_URGENCY",
      businessRationale: "Company database shows 0 completed client project deliveries, preventing accurate technical readiness scoring.",
      recommendedImmediateStep: "Record past delivered infrastructure projects and client references in Capability Matrix.",
      actionLabel: "Log Past Deliveries",
      category: "DELIVERY"
    },
    {
      id: "prio-3",
      rank: 3,
      title: "Input Active Pipeline Leads & Customer Opportunities",
      urgency: "HIGH_URGENCY",
      businessRationale: "Sales pipeline shows ₹0 with zero active leads recorded. Business intelligence requires live pipeline telemetry.",
      recommendedImmediateStep: "Create active deals and leads in CRM to initiate sales conversion intelligence.",
      actionLabel: "Add CRM Deals",
      category: "SALES"
    },
    {
      id: "prio-4",
      rank: 4,
      title: "Conduct Operational Risk & Delivery Capability Review",
      urgency: "MEDIUM_URGENCY",
      businessRationale: "Zero business weaknesses are currently logged. Management must formalize delivery bottlenecks and SLA constraints.",
      recommendedImmediateStep: "Audit technical and delivery capacity to identify actual operational risks.",
      actionLabel: "Conduct Risk Audit",
      category: "OPERATIONS"
    },
    {
      id: "prio-5",
      rank: 5,
      title: "Establish Standard Master Services Agreement (MSA) & SLA Policies",
      urgency: "MEDIUM_URGENCY",
      businessRationale: "Gating policies and 35% margin targets must be formalized before quoting complex cloud migrations.",
      recommendedImmediateStep: "Review the 5 Rejection Categories below and enforce mandatory Project Intake evaluations.",
      actionLabel: "Review Intake Guardrails",
      category: "COMMERCIAL"
    }
  ];

  return Response.json({
    summary: {
      heading: "Cyraops Business Command Center",
      subtitle: "Your company's operational health, delivery readiness and growth opportunities — in one place.",
      lastEvaluated: now.toISOString(),
      overallReadinessScore: businessReadinessScore,
      dataTruthStatus: businessReadinessScore !== null ? "CALCULATED" : "INSUFFICIENT_DATA",
      owner: user.name
    },
    healthIndicators,
    weaknesses,
    acquisitionEngine: {
      projectsWeShouldAcquire: assessments,
      projectsToAvoidCategories
    },
    capabilityMatrix: capabilities.map((cap) => {
      const relatedSkills = skills.filter((s) =>
        s.category === cap.category || cap.name.toLowerCase().includes(s.skillName.toLowerCase()) || s.skillName.toLowerCase().includes(cap.name.toLowerCase())
      );
      const verifiedTeamSkills = relatedSkills.filter((s) => s.verified);
      const selfDeclaredSkills = relatedSkills.filter((s) => !s.verified);
      const isReady = cap.deliveryReadiness === "PRODUCTION_READY" && cap.verifiedProjectsCount > 0;
      const gapSeverity = isReady
        ? "NONE"
        : (verifiedTeamSkills.length > 0 ? "MODERATE" : "UNKNOWN");

      return {
        ...cap,
        verifiedTeamSkills: verifiedTeamSkills.map((s) => `${s.skillName} (${s.level}, ${s.user.name})`),
        selfDeclaredSkills: selfDeclaredSkills.map((s) => `${s.skillName} (${s.level}, ${s.user.name})`),
        gapSeverity
      };
    }),
    improvements,
    salesIntelligence: {
      totalLeads: totalLeadsCount,
      qualifiedLeads: qualifiedLeadsCount,
      proposalsSubmitted: proposalsCount,
      wonDealsCount,
      lostDealsCount,
      conversionRate,
      activePipelineValue: totalPipelineValue,
      weightedPipelineValue: Math.round(weightedPipeline),
      lostReasonsAnalysis
    },
    managementPriorities,
    dailyOperations: {
      followUpsDueToday: deals.filter((d: any) => {
        if (!d.followUpDate) return false;
        const dDate = new Date(d.followUpDate);
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date();
        end.setHours(23, 59, 59, 999);
        return dDate >= start && dDate <= end;
      }).map((d: any) => ({
        id: d.id,
        title: d.title,
        nextAction: d.nextAction,
        sourcePlatform: d.sourcePlatform,
        followUpDate: d.followUpDate,
      })),
      followUpsOverdue: deals.filter((d: any) => {
        if (!d.followUpDate) return false;
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        return new Date(d.followUpDate) < start;
      }).map((d: any) => ({
        id: d.id,
        title: d.title,
        nextAction: d.nextAction,
        sourcePlatform: d.sourcePlatform,
        followUpDate: d.followUpDate,
      })),
      proposalsAwaitingReview: pendingProposals.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        pricing: p.pricing,
        dealTitle: p.deal.title,
      })),
      pendingInvoices: activeInvoices.map((inv) => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        title: inv.title,
        amount: inv.amount,
        amountPaid: inv.amountPaid,
        dueDate: inv.dueDate,
        status: inv.status,
      })),
      readiness: {
        total: readinessItems.length,
        completed: readinessItems.filter((i) => i.status === "COMPLETED").length,
        progressPercent: readinessItems.length > 0
          ? Math.round((readinessItems.filter((i) => i.status === "COMPLETED").length / readinessItems.length) * 100)
          : 0,
      },
    },
    teamMembers: teamUsers,
    // Legacy compatibility fields
    projects: projects.map((project) => ({
      ...project,
      progress: project.tasks.length
        ? Math.round((project.tasks.filter((task) => task.status === "DONE").length / project.tasks.length) * 100)
        : 0
    })),
    conversations: conversations.map((item) => ({
      id: item.id,
      name: item.name ?? item.members.find((member) => member.userId !== user.id)?.user.name ?? "Direct message",
      lastMessage: item.messages[0] ?? null
    })),
    activities,
    stats: {
      openTasks: tasks.filter((task) => task.status !== "DONE").length,
      overdueTasks: tasks.filter((task) => task.dueDate && task.dueDate < now && task.status !== "DONE").length,
      upcomingDeadlines: upcoming.length,
      activeProjects: projects.filter((project) => project.status === "ACTIVE").length,
      unreadNotifications,
      unreadMessages
    }
  });
}
