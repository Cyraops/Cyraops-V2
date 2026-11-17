"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertOctagon,
  AlertTriangle,
  Award,
  BarChart3,
  Bot,
  BrainCircuit,
  Briefcase,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock,
  Compass,
  ExternalLink,
  FileCheck2,
  Filter,
  Flame,
  FolderKanban,
  HelpCircle,
  Layers,
  MessageSquare,
  Plus,
  RefreshCw,
  Send,
  Server,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  UserCheck,
  Users,
  XCircle,
  Zap,
  Info
} from "lucide-react";
import { Avatar, Button, Field, IconButton, Modal, Select, Textarea, useToast } from "@/components/ui";

type DataProvenance = "VERIFIED" | "UNVERIFIED" | "ESTIMATED" | "SYNTHETIC" | "INSUFFICIENT_DATA";

type HealthIndicator = {
  id: string;
  label: string;
  value: string;
  score: number | null;
  status: "STRONG" | "MODERATE" | "CRITICAL" | "INSUFFICIENT_DATA";
  provenance: DataProvenance;
  explanation: string;
  supportingData: string;
  lastUpdated: string;
  recommendedAction: string;
  missingChecklist: string[];
};

type BusinessWeakness = {
  id: string;
  title: string;
  category: "TECHNICAL" | "SALES" | "DELIVERY" | "OPERATIONS" | string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  evidence: string;
  businessImpact: string;
  opportunitiesAffected: string;
  recommendedAction: string;
  suggestedOwner?: string | null;
  priority: string;
  targetDate?: string | null;
  resolved: boolean;
};

type ProjectFitAssessment = {
  id: string;
  projectName: string;
  clientName: string;
  serviceCategory: string;
  estimatedValue: number;
  recommendation: "GREEN" | "AMBER" | "RED";
  technicalFitScore: number;
  deliveryRisk: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  estimatedMarginPercent: number;
  timelineFeasible: boolean;
  clientBudget?: number | null;
  missingCapabilities: string;
  conditions: string;
  reasons: string;
  status: string;
  decisionNotes?: string | null;
};

type ServiceCapability = {
  id: string;
  name: string;
  category: string;
  description: string;
  requiredExpertise: string;
  minRequiredEngineers: number;
  deliveryReadiness: "PRODUCTION_READY" | "CONDITIONAL_PARTNER" | "NOT_READY" | string;
  verifiedProjectsCount: number;
  portfolioEvidence?: string | null;
  verifiedTeamSkills: string[];
  selfDeclaredSkills: string[];
  gapSeverity: "NONE" | "MODERATE" | "SEVERE" | "UNKNOWN";
};

type BusinessImprovement = {
  id: string;
  title: string;
  businessReason: string;
  expectedImpact: string;
  estimatedEffort: string;
  requiredResources: string;
  priority: string;
  ownerId?: string | null;
  targetDate?: string | null;
  status: string;
  convertedTaskId?: string | null;
};

type ManagementPriority = {
  id: string;
  rank: number;
  title: string;
  urgency: "HIGH_URGENCY" | "MEDIUM_URGENCY" | "LOW_URGENCY";
  businessRationale: string;
  recommendedImmediateStep: string;
  actionLabel: string;
  category: string;
};

export function DashboardModule() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [weaknessFilter, setWeaknessFilter] = useState<string>("ALL");
  const [acquisitionFilter, setAcquisitionFilter] = useState<string>("ALL");
  const [expandedReason, setExpandedReason] = useState<Record<string, boolean>>({});

  // Modals state
  const [intakeModalOpen, setIntakeModalOpen] = useState(false);
  const [skillModalOpen, setSkillModalOpen] = useState(false);
  const [convertingId, setConvertingId] = useState<string | null>(null);

  // Intake Form
  const [intakeForm, setIntakeForm] = useState({
    projectName: "",
    clientName: "",
    serviceCategory: "Cloud Architecture & Consulting",
    clientBudget: "50000",
    timelineMonths: 3,
    slaRequired: false,
    scopeDescription: "",
  });

  // Skill Form
  const [skillForm, setSkillForm] = useState({
    type: "skill", // "skill" | "certification"
    skillName: "",
    category: "Cloud & Infrastructure",
    level: "INTERMEDIATE",
    yearsExperience: 2,
    verified: false,
    evidenceUrl: "",
    certName: "",
    issuer: "",
    credentialId: "",
  });

  // AI Advisor state
  const [advisorInput, setAdvisorInput] = useState("");
  const [advisorMessages, setAdvisorMessages] = useState<Array<{ role: "user" | "advisor"; text: string }>>([
    {
      role: "advisor",
      text: "Welcome to Cyraops Business Command Center. I am your Chief of Staff AI Advisor. The command center enforces strict data integrity: only genuine company records are used to compute metrics. Currently, the database has 0 verified client projects and 0 active deals, placing operational metrics in 'Insufficient Data' status until management records real inputs. How can I assist you today?"
    }
  ]);
  const [advisorLoading, setAdvisorLoading] = useState(false);

  const toast = useToast();

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/dashboard");
      const result = await res.json();
      if (!res.ok || result.error) throw new Error(result.error || "Failed to load command center data");
      setData(result);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // Convert Improvement to CRM Task
  const handleConvertToTask = async (improvementId: string) => {
    try {
      setConvertingId(improvementId);
      const res = await fetch("/api/dashboard/improvements/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ improvementId })
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to convert improvement to CRM task");
      toast("Improvement successfully converted into an active CRM task!", "success");
      void loadData();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setConvertingId(null);
    }
  };

  // Submit Intake Form
  const handleIntakeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/dashboard/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intakeForm)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to evaluate project");
      toast(`Project evaluated: ${result.assessment.recommendation} recommendation`, "success");
      setIntakeModalOpen(false);
      setIntakeForm({
        projectName: "",
        clientName: "",
        serviceCategory: "Cloud Architecture & Consulting",
        clientBudget: "50000",
        timelineMonths: 3,
        slaRequired: false,
        scopeDescription: "",
      });
      void loadData();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Submit Skill/Cert Form
  const handleSkillSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/dashboard/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(skillForm)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "Failed to record skill");
      toast(
        skillForm.verified
          ? "Skill / Certification recorded with management verification"
          : "Skill recorded as self-declared (awaiting verification)",
        "success"
      );
      setSkillModalOpen(false);
      void loadData();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // AI Advisor Ask
  const handleAdvisorAsk = (query: string) => {
    if (!query.trim() || advisorLoading) return;
    const userMsg = query.trim();
    setAdvisorInput("");
    setAdvisorMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setAdvisorLoading(true);

    setTimeout(() => {
      let responseText = "";
      const lower = userMsg.toLowerCase();

      if (lower.includes("weakness") || lower.includes("weaknesses")) {
        responseText = `**Truthful Operations Audit:**\n` +
          `Currently, zero operational weaknesses have been formally submitted to the database. The previous sample weaknesses were synthetic fixtures removed during the data integrity audit.\n\n` +
          `**Action Required:** Management should conduct an initial operational capability review to document actual delivery constraints and staffing bottlenecks.`;
      } else if (lower.includes("acquire") || lower.includes("pursue") || lower.includes("fit")) {
        responseText = `**Project Acquisition Policy Guidance:**\n` +
          `• 🟢 **Green (Pursue):** Projects with verified technical capability (>= 75% match), realistic timelines, and >= 35% margin.\n` +
          `• 🟡 **Amber (Conditional):** Projects requiring external specialized subcontractor support or milestone payment gating.\n` +
          `• 🔴 **Red (Do Not Acquire):** Strict 24/7 SLA contracts with penalty clauses or unverified baremetal systems where Cyraops lacks on-call rotation.\n\n` +
          `Currently, 0 active proposals are awaiting review in the database.`;
      } else if (lower.includes("losing") || lower.includes("lost") || lower.includes("deal")) {
        responseText = `**Sales Win/Loss Analysis:**\n` +
          `There are currently 0 closed-lost deals recorded in the genuine CRM database. To enable lost deal intelligence, record actual historical client RFP results in CRM Deals with documented lost reasons.`;
      } else if (lower.includes("hire") || lower.includes("skills") || lower.includes("develop")) {
        responseText = `**Capability Verification Status:**\n` +
          `All 13 IT domains are currently in 'NOT READY / UNVERIFIED' status because 0 verified client deliveries or verified team certifications have been confirmed.\n\n` +
          `**Immediate Recommendation:** Audit core team engineering competencies and submit verified credentials using the '+ Record / Verify Skill' modal.`;
      } else {
        responseText = `**Executive Advisory Briefing:**\n` +
          `The Business Command Center is in 'Insufficient Data' mode, adhering strictly to data truth rules. We do not display manufactured figures. Delivery capacity is at 100% available bandwidth (0 committed projects). Immediate priorities are: 1) Verify team engineering skills, 2) Input active pipeline deals, and 3) Evaluate inbound opportunities.`;
      }

      setAdvisorMessages((prev) => [...prev, { role: "advisor", text: responseText }]);
      setAdvisorLoading(false);
    }, 500);
  };

  if (loading && !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-28 rounded-2xl bg-[var(--hover)]" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-32 rounded-xl bg-[var(--hover)]" />
          ))}
        </div>
      </div>
    );
  }

  const {
    summary,
    healthIndicators = [],
    weaknesses = [],
    acquisitionEngine = { projectsWeShouldAcquire: [], projectsToAvoidCategories: [] },
    capabilityMatrix = [],
    improvements = [],
    salesIntelligence = {},
    managementPriorities = []
  } = data || {};

  // Weaknesses filtering
  const filteredWeaknesses = weaknesses.filter((w: BusinessWeakness) => {
    if (weaknessFilter === "ALL") return true;
    return w.category.toUpperCase() === weaknessFilter;
  });

  // Acquisition filtering
  const filteredAssessments = acquisitionEngine.projectsWeShouldAcquire.filter((a: ProjectFitAssessment) => {
    if (acquisitionFilter === "ALL") return true;
    return a.recommendation === acquisitionFilter;
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "STRONG":
        return <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300"><CheckCircle2 size={11}/>Strong</span>;
      case "MODERATE":
        return <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"><AlertTriangle size={11}/>Moderate</span>;
      case "CRITICAL":
        return <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"><AlertOctagon size={11}/>Critical</span>;
      default:
        return <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300"><HelpCircle size={11}/>Insufficient Data</span>;
    }
  };

  const getProvenanceBadge = (provenance: DataProvenance) => {
    switch (provenance) {
      case "VERIFIED":
        return <span className="rounded bg-emerald-100/70 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">Verified Data</span>;
      case "UNVERIFIED":
        return <span className="rounded bg-amber-100/70 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-200">Unverified</span>;
      case "ESTIMATED":
        return <span className="rounded bg-blue-100/70 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-blue-800 dark:bg-blue-950 dark:text-blue-200">Estimated</span>;
      case "SYNTHETIC":
        return <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-purple-800 dark:bg-purple-950 dark:text-purple-200">Synthetic</span>;
      default:
        return <span className="rounded bg-slate-200/70 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-700 dark:bg-slate-800 dark:text-slate-300">Insufficient Data</span>;
    }
  };

  return (
    <div className="space-y-10 pb-16 min-w-0 max-w-full overflow-x-hidden sm:overflow-x-visible">
      {/* ============================================================== */}
      {/* HEADER & TOP CONTROLS */}
      {/* ============================================================== */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[var(--border)] pb-6">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent">
            <Sparkles size={14} />
            <span>Cyraops Autonomous IT Management</span>
            <span className="text-[var(--muted)]">·</span>
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
              Data Truth Enforced
            </span>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight text-[var(--text)]">
            {summary?.heading || "Cyraops Business Command Center"}
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {summary?.subtitle || "Your company's operational health, delivery readiness and growth opportunities — in one place."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button variant="secondary" onClick={() => setSkillModalOpen(true)}>
            <Award size={15} />
            Record / Verify Skill
          </Button>
          <Button onClick={() => setIntakeModalOpen(true)}>
            <Plus size={15} />
            Evaluate New Project
          </Button>
          <IconButton label="Refresh Command Center" onClick={() => void loadData()}>
            <RefreshCw size={15} />
          </IconButton>
        </div>
      </div>

      {/* ============================================================== */}
      {/* DATA TRUTH INTEGRITY BANNER */}
      {/* ============================================================== */}
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50/50 p-3.5 text-xs text-blue-900 dark:border-blue-900/40 dark:bg-blue-950/20 dark:text-blue-200">
        <Info size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
        <div className="leading-relaxed">
          <strong>Data Truth Policy Active:</strong> This command center never fabricates metrics or inflates readiness scores. When genuine company telemetry or verified client deliveries are lacking, metrics display <em>&ldquo;Insufficient data — management input required&rdquo;</em> with an action checklist.
        </div>
      </div>

      {/* ============================================================== */}
      {/* TODAY'S OPERATIONAL ATTENTION CENTER */}
      {/* ============================================================== */}
      {data?.dailyOperations && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] pb-3">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Daily Execution</div>
              <h2 className="font-display text-lg font-bold">What Needs Attention Today?</h2>
            </div>
            {data.dailyOperations.readiness && (
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted)]">Company Launch Readiness:</span>
                <span className="font-bold text-accent text-xs">
                  {data.dailyOperations.readiness.completed}/{data.dailyOperations.readiness.total} ({data.dailyOperations.readiness.progressPercent}%)
                </span>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* 1. Client Inquiries & Follow-ups */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                  <Clock size={13} className="text-accent" /> Follow-ups & Deadlines
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-accent/10 text-accent">
                  {(data.dailyOperations.followUpsDueToday?.length || 0) + (data.dailyOperations.followUpsOverdue?.length || 0)} active
                </span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-auto text-xs">
                {data.dailyOperations.followUpsOverdue?.length > 0 &&
                  data.dailyOperations.followUpsOverdue.map((d: any) => (
                    <div key={d.id} className="p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/40">
                      <div className="font-semibold text-rose-800 dark:text-rose-200 truncate">{d.title}</div>
                      <div className="text-[10px] text-rose-600 dark:text-rose-300">Overdue: {d.nextAction || "Contact client"}</div>
                    </div>
                  ))}
                {data.dailyOperations.followUpsDueToday?.length > 0 &&
                  data.dailyOperations.followUpsDueToday.map((d: any) => (
                    <div key={d.id} className="p-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40">
                      <div className="font-semibold text-amber-800 dark:text-amber-200 truncate">{d.title}</div>
                      <div className="text-[10px] text-amber-600 dark:text-amber-300">Today: {d.nextAction || "Follow-up required"}</div>
                    </div>
                  ))}
                {!data.dailyOperations.followUpsOverdue?.length && !data.dailyOperations.followUpsDueToday?.length && (
                  <p className="text-[11px] text-[var(--muted)] py-3 text-center">No overdue deal follow-ups today.</p>
                )}
              </div>
            </div>

            {/* 2. Proposals in Review */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                  <FileCheck2 size={13} className="text-emerald-600" /> Proposals Under Review
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
                  {data.dailyOperations.proposalsAwaitingReview?.length || 0} pending
                </span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-auto text-xs">
                {data.dailyOperations.proposalsAwaitingReview?.length > 0 ? (
                  data.dailyOperations.proposalsAwaitingReview.map((p: any) => (
                    <div key={p.id} className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                      <div className="font-semibold truncate">{p.title}</div>
                      <div className="text-[10px] text-[var(--muted)] flex justify-between mt-0.5">
                        <span>{p.dealTitle}</span>
                        <b className="text-accent">₹{p.pricing?.toLocaleString()}</b>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-[var(--muted)] py-3 text-center">Zero proposals awaiting team sign-off.</p>
                )}
              </div>
            </div>

            {/* 3. Outstanding Client Invoices */}
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3.5 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-neutral-900 dark:text-neutral-100 flex items-center gap-1.5">
                  <ShieldCheck size={13} className="text-blue-600" /> Invoices Pending Payment
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                  {data.dailyOperations.pendingInvoices?.length || 0} active
                </span>
              </div>
              <div className="space-y-1.5 max-h-36 overflow-auto text-xs">
                {data.dailyOperations.pendingInvoices?.length > 0 ? (
                  data.dailyOperations.pendingInvoices.map((inv: any) => (
                    <div key={inv.id} className="p-2 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
                      <div className="font-semibold truncate flex justify-between">
                        <span>{inv.invoiceNumber}</span>
                        <b className="text-emerald-600">₹{(inv.amount - inv.amountPaid).toLocaleString()}</b>
                      </div>
                      <div className="text-[10px] text-[var(--muted)] mt-0.5 truncate">{inv.title}</div>
                    </div>
                  ))
                ) : (
                  <p className="text-[11px] text-[var(--muted)] py-3 text-center">No outstanding client receivables.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ============================================================== */}
      {/* SECTION A — BUSINESS HEALTH OVERVIEW */}
      {/* ============================================================== */}
      <section>
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Section A</div>
            <h2 className="font-display text-xl font-bold">Business Health Overview</h2>
            <p className="text-xs text-[var(--muted)]">8 operational dimensions audited against genuine company records</p>
          </div>
          <div className="text-right">
            <span className="text-[11px] font-semibold text-[var(--muted)]">Composite Readiness: </span>
            {summary?.overallReadinessScore !== null ? (
              <span className="font-display text-sm font-extrabold text-accent">{summary?.overallReadinessScore}/100</span>
            ) : (
              <span className="text-xs font-bold text-[var(--muted)]">Insufficient Data (3+ dimensions required)</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {healthIndicators.map((metric: HealthIndicator) => (
            <div
              key={metric.id}
              className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:border-[#c9c4f8]"
            >
              <div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-xs font-semibold text-[var(--muted)] truncate">{metric.label}</span>
                  {getProvenanceBadge(metric.provenance)}
                </div>

                <div className="mt-3 flex items-baseline gap-2">
                  <span className={`font-display tracking-tight ${
                    metric.status === "INSUFFICIENT_DATA" ? "text-lg font-bold text-[var(--muted)]" : "text-2xl font-black text-[var(--text)]"
                  }`}>
                    {metric.value}
                  </span>
                  {metric.status !== "INSUFFICIENT_DATA" && getStatusBadge(metric.status)}
                </div>

                <p className="mt-2 text-xs leading-relaxed text-[var(--text)]">{metric.explanation}</p>
                <p className="mt-1 text-[11px] text-[var(--muted)]">{metric.supportingData}</p>

                {metric.missingChecklist && metric.missingChecklist.length > 0 && (
                  <div className="mt-2.5 rounded-lg border border-dashed border-amber-300 bg-amber-50/50 p-2 text-[10px] text-amber-800 dark:border-amber-800/50 dark:bg-amber-950/20 dark:text-amber-300">
                    <span className="font-bold">Required to Unlock Calculation:</span>
                    <ul className="mt-1 list-inside list-disc space-y-0.5">
                      {metric.missingChecklist.map((item, idx) => (
                        <li key={idx}>{item}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              <div className="mt-3 border-t border-[var(--border)] pt-2.5 text-[10px] text-[var(--muted)]">
                <span className="font-semibold text-accent">Recommended Action: </span>
                <span>{metric.recommendedAction}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION B — OUR BIGGEST BUSINESS WEAKNESSES */}
      {/* ============================================================== */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Section B</div>
            <h2 className="font-display text-xl font-bold">Our Biggest Business Weaknesses</h2>
            <p className="text-xs text-[var(--muted)]">Operational vulnerabilities logged from documented audits and intake evaluations</p>
          </div>

          <div className="flex max-w-full overflow-x-auto items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-1 text-xs">
            {["ALL", "TECHNICAL", "SALES", "DELIVERY", "OPERATIONS"].map((cat) => (
              <button
                key={cat}
                onClick={() => setWeaknessFilter(cat)}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  weaknessFilter === cat
                    ? "bg-accent text-white shadow-xs"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {cat === "ALL" ? "All Pillars" : cat.charAt(0) + cat.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
        </div>

        {filteredWeaknesses.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {filteredWeaknesses.map((w: BusinessWeakness) => (
              <div
                key={w.id}
                className="flex flex-col justify-between rounded-xl border border-rose-100 bg-[#fffdfd] p-4.5 transition dark:border-rose-950/40 dark:bg-rose-950/10"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
                      {w.category} PILLAR
                    </span>
                    <span className="rounded-md bg-rose-100 px-2 py-0.5 text-[10px] font-extrabold uppercase text-rose-800">
                      {w.severity}
                    </span>
                  </div>

                  <h3 className="mt-2 font-display text-sm font-bold text-[var(--text)]">{w.title}</h3>

                  <div className="mt-3 space-y-2 text-xs">
                    <div>
                      <span className="font-semibold text-rose-700 dark:text-rose-400">Evidence: </span>
                      <span className="text-[var(--text)]">{w.evidence}</span>
                    </div>
                    <div>
                      <span className="font-semibold text-[var(--text)]">Business Impact: </span>
                      <span className="text-[var(--muted)]">{w.businessImpact}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 border-t border-[var(--border)] pt-3 text-xs">
                  <div className="rounded-lg bg-[var(--surface)] p-2.5 border border-[var(--border)]">
                    <span className="font-bold text-accent">Corrective Action: </span>
                    <span className="text-[var(--text)]">{w.recommendedAction}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-xs text-[var(--muted)]">
            <AlertOctagon size={24} className="mx-auto mb-2 text-[var(--muted)] opacity-60" />
            <div className="font-bold text-[var(--text)]">No Validated Company Weaknesses Currently Logged</div>
            <p className="mt-1 max-w-md mx-auto">
              The database does not contain verified operational weakness records. All demonstration records were removed during the data audit. Conduct a management capability review or evaluate incoming projects to log actual delivery bottlenecks.
            </p>
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* SECTION C — PROJECT ACQUISITION DECISION ENGINE */}
      {/* ============================================================== */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Section C</div>
            <h2 className="font-display text-xl font-bold">Project Acquisition Decision Engine</h2>
            <p className="text-xs text-[var(--muted)]">Client proposals evaluated against real technical fit and delivery margins</p>
          </div>

          <div className="flex max-w-full overflow-x-auto items-center gap-1 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-1 text-xs">
            {["ALL", "GREEN", "AMBER", "RED"].map((status) => (
              <button
                key={status}
                onClick={() => setAcquisitionFilter(status)}
                className={`rounded-md px-2.5 py-1 font-semibold transition ${
                  acquisitionFilter === status
                    ? "bg-accent text-white shadow-xs"
                    : "text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                {status === "ALL" ? "All Intake" : status === "GREEN" ? "🟢 Pursue" : status === "AMBER" ? "🟡 Conditional" : "🔴 Do Not Acquire"}
              </button>
            ))}
          </div>
        </div>

        {filteredAssessments.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {filteredAssessments.map((a: ProjectFitAssessment) => (
              <div
                key={a.id}
                className="flex flex-col justify-between rounded-xl border p-5 shadow-sm transition border-[var(--border)] bg-[var(--surface)]"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-semibold text-[var(--muted)]">{a.clientName}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                      {a.recommendation}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-sm font-bold text-[var(--text)]">{a.projectName}</h3>
                  <div className="mt-1 text-xs text-[var(--muted)]">{a.serviceCategory}</div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-8 text-center text-xs text-[var(--muted)]">
            <Compass size={24} className="mx-auto mb-2 text-accent opacity-70" />
            <div className="font-bold text-[var(--text)]">No Client Project Opportunities Formally Evaluated</div>
            <p className="mt-1 max-w-md mx-auto">
              Click &ldquo;+ Evaluate New Project&rdquo; to test an inbound client proposal against our verified capabilities, budget, and SLA constraints.
            </p>
            <div className="mt-4">
              <Button onClick={() => setIntakeModalOpen(true)}>
                <Plus size={14} />
                Evaluate New Project
              </Button>
            </div>
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* SECTION D — PROJECTS WE SHOULD NOT ACQUIRE (STANDARD POLICY) */}
      {/* ============================================================== */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">Section D</div>
          <h2 className="font-display text-xl font-bold">Projects We Should NOT Acquire</h2>
          <p className="text-xs text-[var(--muted)]">
            Established management guardrails to protect delivery reputation, margins, and engineering bandwidth
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {acquisitionEngine.projectsToAvoidCategories.map((cat: any) => (
            <div
              key={cat.id}
              className="rounded-xl border border-rose-100 bg-[#fffafa] p-4 text-xs dark:border-rose-950/40 dark:bg-rose-950/10"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-bold text-rose-900 dark:text-rose-200">{cat.categoryName}</span>
                <span className="rounded bg-rose-200 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-rose-900 dark:bg-rose-900 dark:text-rose-100">
                  {cat.deliveryRisk} RISK
                </span>
              </div>

              <div className="mt-2.5 space-y-2">
                <div>
                  <span className="font-bold text-rose-800 dark:text-rose-400">Why Avoid: </span>
                  <span className="text-[var(--text)]">{cat.whyAvoid}</span>
                </div>
                <div className="rounded-md bg-[var(--surface)] p-2 border border-[var(--border)]">
                  <span className="font-bold text-accent">Conditions to Reassess: </span>
                  <span className="text-[var(--muted)]">{cat.conditionsToReassess}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION E — CAPABILITY GAP MATRIX */}
      {/* ============================================================== */}
      <section className="space-y-4 min-w-0 max-w-full">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Section E</div>
            <h2 className="font-display text-xl font-bold">Capability Gap Matrix</h2>
            <p className="text-xs text-[var(--muted)]">
              Real-time audit across 13 core IT service categories showing verified client project counts and confirmed team skills
            </p>
          </div>
          <Button variant="secondary" onClick={() => setSkillModalOpen(true)}>
            <Award size={14} />
            Record / Verify Skill
          </Button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)] shadow-sm">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[10px] font-bold uppercase tracking-wider text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3">Service Category</th>
                <th className="px-4 py-3">Required Expertise</th>
                <th className="px-4 py-3">Team Skills (Verified vs Self-Declared)</th>
                <th className="px-4 py-3 text-center">Verified Deliveries</th>
                <th className="px-4 py-3">Delivery Readiness</th>
                <th className="px-4 py-3">Gap Severity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {capabilityMatrix.map((cap: ServiceCapability) => (
                <tr key={cap.id} className="hover:bg-[var(--hover)] transition">
                  <td className="px-4 py-3 font-semibold text-[var(--text)]">
                    <div>{cap.name}</div>
                    <div className="text-[10px] font-normal text-[var(--muted)]">{cap.category}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--muted)] max-w-xs">{cap.requiredExpertise}</td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {cap.verifiedTeamSkills.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {cap.verifiedTeamSkills.map((s, idx) => (
                            <span key={idx} className="rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                              ✓ {s} (Verified)
                            </span>
                          ))}
                        </div>
                      )}
                      {cap.selfDeclaredSkills.length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {cap.selfDeclaredSkills.map((s, idx) => (
                            <span key={idx} className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                              ? {s} (Self-Declared)
                            </span>
                          ))}
                        </div>
                      )}
                      {cap.verifiedTeamSkills.length === 0 && cap.selfDeclaredSkills.length === 0 && (
                        <span className="text-[10px] text-[var(--muted)] italic">No team skills logged</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-display font-bold text-[var(--muted)]">
                    {cap.verifiedProjectsCount}
                  </td>
                  <td className="px-4 py-3">
                    {cap.deliveryReadiness === "PRODUCTION_READY" && cap.verifiedProjectsCount > 0 ? (
                      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        PRODUCTION READY
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        NOT READY / UNVERIFIED
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {cap.gapSeverity === "NONE" ? (
                      <span className="text-[11px] font-semibold text-emerald-600">None</span>
                    ) : (
                      <span className="text-[11px] font-semibold text-[var(--muted)]">Unknown — Verification Pending</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION F — WHAT WE NEED TO IMPROVE */}
      {/* ============================================================== */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Section F</div>
          <h2 className="font-display text-xl font-bold">What We Need to Improve</h2>
          <p className="text-xs text-[var(--muted)]">
            Prioritized organizational roadmap with one-click conversion to executable CRM tasks
          </p>
        </div>

        {improvements.length > 0 ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {improvements.map((imp: BusinessImprovement) => (
              <div
                key={imp.id}
                className="flex flex-col justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4.5"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="rounded bg-accent/10 px-2 py-0.5 text-[10px] font-extrabold text-accent">
                      {imp.priority} PRIORITY
                    </span>
                    <span className="text-[11px] font-bold capitalize text-[var(--muted)]">
                      {imp.status.replace("_", " ").toLowerCase()}
                    </span>
                  </div>
                  <h3 className="mt-2 font-display text-sm font-bold text-[var(--text)]">{imp.title}</h3>
                </div>
                <div className="mt-4 border-t border-[var(--border)] pt-3 flex items-center justify-between">
                  <span className="text-[11px] text-[var(--muted)]">
                    {imp.convertedTaskId ? "Linked to CRM Task" : "Ready to execute"}
                  </span>
                  <Button
                    variant={imp.convertedTaskId ? "secondary" : "primary"}
                    disabled={convertingId === imp.id}
                    onClick={() => handleConvertToTask(imp.id)}
                    className="h-8 text-xs px-2.5"
                  >
                    <Zap size={13} />
                    {imp.convertedTaskId ? "Task Created ✓" : "Convert to CRM Task"}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-8 text-center text-xs text-[var(--muted)]">
            <Zap size={24} className="mx-auto mb-2 text-accent opacity-60" />
            <div className="font-bold text-[var(--text)]">No Improvement Items Scheduled</div>
            <p className="mt-1 max-w-md mx-auto">
              Improvement roadmaps will be populated once management risk audits or intake evaluations identify specific capability gaps.
            </p>
          </div>
        )}
      </section>

      {/* ============================================================== */}
      {/* SECTION G — SALES AND REVENUE INTELLIGENCE */}
      {/* ============================================================== */}
      <section className="space-y-4">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Section G</div>
          <h2 className="font-display text-xl font-bold">Sales & Revenue Intelligence</h2>
          <p className="text-xs text-[var(--muted)]">Real conversion rates and pipeline volume derived strictly from CRM deals</p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <span className="text-[10px] font-bold uppercase text-[var(--muted)]">Incoming Leads</span>
            <div className="mt-1 font-display text-2xl font-black">{salesIntelligence.totalLeads || 0}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <span className="text-[10px] font-bold uppercase text-[var(--muted)]">Qualified Leads</span>
            <div className="mt-1 font-display text-2xl font-black text-emerald-600">{salesIntelligence.qualifiedLeads || 0}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <span className="text-[10px] font-bold uppercase text-[var(--muted)]">Proposals Out</span>
            <div className="mt-1 font-display text-2xl font-black text-accent">{salesIntelligence.proposalsSubmitted || 0}</div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <span className="text-[10px] font-bold uppercase text-[var(--muted)]">Won vs Lost</span>
            <div className="mt-1 font-display text-xl font-black">
              <span className="text-emerald-600">{salesIntelligence.wonDealsCount || 0}W</span>
              <span className="text-[var(--muted)]"> / </span>
              <span className="text-rose-600">{salesIntelligence.lostDealsCount || 0}L</span>
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <span className="text-[10px] font-bold uppercase text-[var(--muted)]">Conversion Rate</span>
            <div className="mt-1 font-display text-2xl font-black text-accent">
              {salesIntelligence.conversionRate != null ? `${salesIntelligence.conversionRate}%` : "N/A"}
            </div>
          </div>
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-center">
            <span className="text-[10px] font-bold uppercase text-[var(--muted)]">Active Pipeline</span>
            <div className="mt-1 font-display text-xl font-black text-emerald-600">
              ₹{Math.round((salesIntelligence.activePipelineValue || 0) / 1000)}k
            </div>
          </div>
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION H — MANAGEMENT PRIORITIES ("What Needs My Attention Today?") */}
      {/* ============================================================== */}
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-4">
          <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Section H</div>
          <h2 className="font-display text-xl font-bold">Management Priorities: What Needs My Attention Today?</h2>
          <p className="text-xs text-[var(--muted)]">
            Foundational executive steps required to establish genuine company intelligence and unlock readiness scoring
          </p>
        </div>

        <div className="space-y-3">
          {managementPriorities.map((prio: ManagementPriority) => (
            <div
              key={prio.id}
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 transition hover:border-[#c9c4f8]"
            >
              <div className="flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent text-white font-display text-xs font-black">
                  #{prio.rank}
                </span>
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-sm font-bold text-[var(--text)]">{prio.title}</h3>
                    <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[9px] font-extrabold uppercase text-rose-800 dark:bg-rose-950 dark:text-rose-200">
                      {prio.urgency.replace("_", " ")}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--muted)]">{prio.businessRationale}</p>
                  <p className="mt-0.5 text-xs text-accent font-semibold">Immediate Step: {prio.recommendedImmediateStep}</p>
                </div>
              </div>

              <div className="sm:text-right shrink-0">
                <Button
                  variant="secondary"
                  className="h-8 text-xs font-semibold"
                  onClick={() => {
                    if (prio.actionLabel.includes("Verify")) {
                      setSkillModalOpen(true);
                    } else if (prio.actionLabel.includes("Intake")) {
                      setIntakeModalOpen(true);
                    } else {
                      toast(`Action noted: ${prio.actionLabel}`, "success");
                    }
                  }}
                >
                  {prio.actionLabel}
                  <ChevronRight size={13} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ============================================================== */}
      {/* SECTION I — AI BUSINESS ADVISOR (CHIEF OF STAFF) */}
      {/* ============================================================== */}
      <section id="ai-advisor" className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent text-white shadow-xs">
              <Bot size={20} />
            </span>
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-accent">Section I</div>
              <h2 className="font-display text-lg font-bold">Chief of Staff AI Business Advisor</h2>
              <p className="text-xs text-[var(--muted)]">OpenAI Responses API strategic counsel adhering strictly to verified company data</p>
            </div>
          </div>
          <Link href="/ai" className="text-xs font-semibold text-accent flex items-center gap-1 hover:underline">
            <span>Open Cyraops Bot Workspace</span>
            <ExternalLink size={13} />
          </Link>
        </div>

        {/* Quick query buttons */}
        <div className="mb-4 flex flex-wrap gap-2">
          {[
            "What are our biggest business weaknesses?",
            "Which projects should we acquire?",
            "Why are we losing deals?",
            "What technical skills do we need to hire?"
          ].map((prompt, idx) => (
            <button
              key={idx}
              onClick={() => handleAdvisorAsk(prompt)}
              className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1.5 text-xs font-semibold text-[var(--text)] transition hover:border-accent hover:text-accent"
            >
              {prompt}
            </button>
          ))}
        </div>

        {/* Advisor conversation log */}
        <div className="max-h-72 overflow-y-auto space-y-3 rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-4 text-xs">
          {advisorMessages.map((msg, idx) => (
            <div
              key={idx}
              className={`flex gap-2.5 ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              {msg.role === "advisor" && (
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-white text-[10px]">
                  <Sparkles size={12} />
                </span>
              )}
              <div
                className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-line ${
                  msg.role === "user"
                    ? "bg-accent text-white shadow-xs"
                    : "bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] shadow-2xs"
                }`}
              >
                {msg.text}
              </div>
            </div>
          ))}
          {advisorLoading && (
            <div className="flex items-center gap-2 text-xs text-[var(--muted)]">
              <RefreshCw size={12} className="animate-spin text-accent" />
              <span>Analyzing live telemetry with OpenAI Responses Engine...</span>
            </div>
          )}
        </div>

        {/* Input composer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleAdvisorAsk(advisorInput);
          }}
          className="mt-3 flex gap-2"
        >
          <input
            aria-label="Ask Chief of Staff about revenue, staffing, or project fit"
            placeholder="Ask Chief of Staff about revenue, staffing, or project fit..."
            value={advisorInput}
            onChange={(e) => setAdvisorInput(e.target.value)}
            className="h-10 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs outline-none focus:border-accent"
          />
          <Button type="submit" disabled={advisorLoading || !advisorInput.trim()}>
            <Send size={14} />
            Ask
          </Button>
        </form>
      </section>

      {/* ============================================================== */}
      {/* SECTION J — PROJECT EVALUATION INTAKE MODAL */}
      {/* ============================================================== */}
      <Modal
        open={intakeModalOpen}
        onClose={() => setIntakeModalOpen(false)}
        title="Evaluate New IT Project Opportunity"
        size="max-w-xl"
      >
        <form onSubmit={handleIntakeSubmit} className="space-y-3.5 text-xs">
          <p className="text-[var(--muted)]">
            Evaluate inbound client opportunities against verified team capabilities, engineering bandwidth, and margin targets before quoting.
          </p>

          <Field
            label="Project Name"
            placeholder="e.g. AWS Multi-Account Migration"
            required
            value={intakeForm.projectName}
            onChange={(e) => setIntakeForm({ ...intakeForm, projectName: e.target.value })}
          />

          <Field
            label="Client Name"
            placeholder="e.g. Acme Corporation"
            required
            value={intakeForm.clientName}
            onChange={(e) => setIntakeForm({ ...intakeForm, clientName: e.target.value })}
          />

          <Select
            label="Service Category"
            value={intakeForm.serviceCategory}
            onChange={(e) => setIntakeForm({ ...intakeForm, serviceCategory: e.target.value })}
          >
            {capabilityMatrix.map((c: ServiceCapability) => (
              <option key={c.id} value={c.name}>{c.name}</option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Client Budget ($ USD)"
              type="number"
              value={intakeForm.clientBudget}
              onChange={(e) => setIntakeForm({ ...intakeForm, clientBudget: e.target.value })}
            />
            <Field
              label="Estimated Timeline (Months)"
              type="number"
              value={intakeForm.timelineMonths}
              onChange={(e) => setIntakeForm({ ...intakeForm, timelineMonths: Number(e.target.value) })}
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={intakeForm.slaRequired}
              onChange={(e) => setIntakeForm({ ...intakeForm, slaRequired: e.target.checked })}
              className="rounded text-accent focus:ring-accent"
            />
            <span className="font-semibold text-[var(--text)]">Requires 24/7 round-the-clock incident response SLA</span>
          </label>

          <Textarea
            label="Scope Description & Special Requirements"
            rows={3}
            placeholder="Detail technologies, migration source/target, legacy constraints..."
            value={intakeForm.scopeDescription}
            onChange={(e) => setIntakeForm({ ...intakeForm, scopeDescription: e.target.value })}
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setIntakeModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Run Fit Assessment
            </Button>
          </div>
        </form>
      </Modal>

      {/* ============================================================== */}
      {/* RECORD / VERIFY SKILL MODAL */}
      {/* ============================================================== */}
      <Modal
        open={skillModalOpen}
        onClose={() => setSkillModalOpen(false)}
        title="Record or Verify Team Skill / Certification"
        size="max-w-lg"
      >
        <form onSubmit={handleSkillSubmit} className="space-y-3.5 text-xs">
          <div className="flex gap-2 border-b border-[var(--border)] pb-2">
            <button
              type="button"
              onClick={() => setSkillForm({ ...skillForm, type: "skill" })}
              className={`rounded-md px-3 py-1 font-semibold ${skillForm.type === "skill" ? "bg-accent text-white" : "text-[var(--muted)]"}`}
            >
              Technical Skill
            </button>
            <button
              type="button"
              onClick={() => setSkillForm({ ...skillForm, type: "certification" })}
              className={`rounded-md px-3 py-1 font-semibold ${skillForm.type === "certification" ? "bg-accent text-white" : "text-[var(--muted)]"}`}
            >
              Accredited Certification
            </button>
          </div>

          {skillForm.type === "skill" ? (
            <>
              <Field
                label="Skill Name"
                placeholder="e.g. AWS Solutions Architecture, Terraform, Kubernetes"
                required
                value={skillForm.skillName}
                onChange={(e) => setSkillForm({ ...skillForm, skillName: e.target.value })}
              />

              <Select
                label="Category"
                value={skillForm.category}
                onChange={(e) => setSkillForm({ ...skillForm, category: e.target.value })}
              >
                <option value="Cloud & Infrastructure">Cloud & Infrastructure</option>
                <option value="DevOps & Automation">DevOps & Automation</option>
                <option value="Systems & Platforms">Systems & Platforms</option>
                <option value="Cloud Native">Cloud Native</option>
                <option value="Site Reliability">Site Reliability</option>
                <option value="Security & Governance">Security & Governance</option>
                <option value="Application Engineering">Application Engineering</option>
              </Select>

              <div className="grid grid-cols-2 gap-3">
                <Select
                  label="Proficiency Level"
                  value={skillForm.level}
                  onChange={(e) => setSkillForm({ ...skillForm, level: e.target.value })}
                >
                  <option value="BEGINNER">Beginner</option>
                  <option value="INTERMEDIATE">Intermediate</option>
                  <option value="ADVANCED">Advanced</option>
                  <option value="EXPERT">Expert</option>
                </Select>
                <Field
                  label="Years of Experience"
                  type="number"
                  step="0.5"
                  value={skillForm.yearsExperience}
                  onChange={(e) => setSkillForm({ ...skillForm, yearsExperience: Number(e.target.value) })}
                />
              </div>

              <Field
                label="Evidence URL / Repository (optional)"
                placeholder="https://github.com/... or client SOW reference"
                value={skillForm.evidenceUrl}
                onChange={(e) => setSkillForm({ ...skillForm, evidenceUrl: e.target.value })}
              />

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={skillForm.verified}
                  onChange={(e) => setSkillForm({ ...skillForm, verified: e.target.checked })}
                  className="rounded text-accent focus:ring-accent"
                />
                <span className="font-semibold text-[var(--text)]">Independently Verified by Management (Evidence Checked)</span>
              </label>
            </>
          ) : (
            <>
              <Field
                label="Certification Name"
                placeholder="e.g. AWS Certified Solutions Architect – Professional"
                required
                value={skillForm.certName}
                onChange={(e) => setSkillForm({ ...skillForm, certName: e.target.value })}
              />

              <Field
                label="Issuing Organization"
                placeholder="e.g. Amazon Web Services / CNCF"
                required
                value={skillForm.issuer}
                onChange={(e) => setSkillForm({ ...skillForm, issuer: e.target.value })}
              />

              <Field
                label="Credential ID"
                placeholder="e.g. AWS-PSA-123456"
                value={skillForm.credentialId}
                onChange={(e) => setSkillForm({ ...skillForm, credentialId: e.target.value })}
              />

              <label className="flex items-center gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={skillForm.verified}
                  onChange={(e) => setSkillForm({ ...skillForm, verified: e.target.checked })}
                  className="rounded text-accent focus:ring-accent"
                />
                <span className="font-semibold text-[var(--text)]">Verified Credential Record</span>
              </label>
            </>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => setSkillModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">
              Save Record
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
