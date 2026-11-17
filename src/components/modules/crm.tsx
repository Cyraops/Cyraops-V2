"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Building2,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Kanban,
  Layers,
  MoreVertical,
  Phone,
  Plus,
  RefreshCw,
  Search,
  Table as TableIcon,
  Target,
  Trash2,
  TrendingUp,
  User,
  UserCheck,
  Users,
  Wallet,
  X,
  FileCheck2,
} from "lucide-react";
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  formatDate,
  formatRelative,
  IconButton,
  Loading,
  Modal,
  SectionTitle,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

const CRM_TABS = [
  { id: "overview", label: "Overview", icon: TrendingUp },
  { id: "leads", label: "Leads", icon: UserCheck },
  { id: "contacts", label: "Contacts", icon: Users },
  { id: "companies", label: "Companies", icon: Building2 },
  { id: "deals", label: "Deals & Pipeline", icon: Target },
];

const LEAD_STATUSES = ["NEW", "CONTACTED", "QUALIFIED", "UNQUALIFIED", "CONVERTED"];
const DEAL_STAGES = ["DISCOVERY", "PROPOSAL", "NEGOTIATION", "CLOSED_WON", "CLOSED_LOST"];
const CONTACT_STATUSES = ["LEAD", "CUSTOMER", "PARTNER", "INACTIVE"];

function isSafeHttpUrl(url: string | null | undefined): boolean {
  if (!url || typeof url !== "string") return false;
  const trimmed = url.trim();
  if (trimmed.startsWith("//")) return false;
  try {
    const parsed = new URL(trimmed);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      !parsed.username &&
      !parsed.password &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function CrmModule() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState("overview");
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);

  // Stats
  const [stats, setStats] = useState<any>(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Entities state
  const [leads, setLeads] = useState<any[]>([]);
  const [leadsTotal, setLeadsTotal] = useState(0);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactsTotal, setContactsTotal] = useState(0);
  const [companies, setCompanies] = useState<any[]>([]);
  const [companiesTotal, setCompaniesTotal] = useState(0);
  const [deals, setDeals] = useState<any[]>([]);
  const [dealsTotal, setDealsTotal] = useState(0);

  // Selected details
  const [selectedLead, setSelectedLead] = useState<any>(null);
  const [selectedContact, setSelectedContact] = useState<any>(null);
  const [selectedCompany, setSelectedCompany] = useState<any>(null);
  const [selectedDeal, setSelectedDeal] = useState<any>(null);
  const [detailActivities, setDetailActivities] = useState<any[]>([]);

  // Loading states
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [platformFilter, setPlatformFilter] = useState("ALL");
  const [dealsView, setDealsView] = useState<"pipeline" | "table">("pipeline");

  // Modals
  const [createLeadOpen, setCreateLeadOpen] = useState(false);
  const [editLeadOpen, setEditLeadOpen] = useState(false);
  const [createContactOpen, setCreateContactOpen] = useState(false);
  const [editContactOpen, setEditContactOpen] = useState(false);
  const [createCompanyOpen, setCreateCompanyOpen] = useState(false);
  const [editCompanyOpen, setEditCompanyOpen] = useState(false);
  const [createDealOpen, setCreateDealOpen] = useState(false);
  const [editDealOpen, setEditDealOpen] = useState(false);
  const [convertDealOpen, setConvertDealOpen] = useState(false);
  const [createProposalOpen, setCreateProposalOpen] = useState(false);
  const [acceptProposalModal, setAcceptProposalModal] = useState<any | null>(null);
  const [proposalBusy, setProposalBusy] = useState(false);
  const [proposalTemplate, setProposalTemplate] = useState("cloud_infra");

  // API helper
  const api = useCallback(async (url: string, method = "GET", body?: any) => {
    const res = await fetch(url, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "API request failed");
    return data;
  }, []);

  // Initial load
  const loadBase = useCallback(async () => {
    try {
      const [meRes, teamRes] = await Promise.all([
        api("/api/auth/me"),
        api("/api/team"),
      ]);
      setCurrentUser(meRes.user);
      setTeamMembers(teamRes.members ?? []);
    } catch (err: any) {
      console.error(err);
    }
  }, [api]);

  const loadStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const data = await api("/api/crm/stats");
      setStats(data);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setStatsLoading(false);
    }
  }, [api, toast]);

  const loadLeads = useCallback(async () => {
    setLoading(true);
    try {
      const q = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
      const s = statusFilter !== "ALL" ? `&status=${statusFilter}` : "";
      const data = await api(`/api/crm/leads?limit=50${q}${s}`);
      setLeads(data.leads ?? []);
      setLeadsTotal(data.total ?? 0);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [api, searchQuery, statusFilter, toast]);

  const loadContacts = useCallback(async () => {
    setLoading(true);
    try {
      const q = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
      const data = await api(`/api/crm/contacts?limit=50${q}`);
      setContacts(data.contacts ?? []);
      setContactsTotal(data.total ?? 0);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [api, searchQuery, toast]);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    try {
      const q = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
      const data = await api(`/api/crm/companies?limit=50${q}`);
      setCompanies(data.companies ?? []);
      setCompaniesTotal(data.total ?? 0);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [api, searchQuery, toast]);

  const loadDeals = useCallback(async () => {
    setLoading(true);
    try {
      const q = searchQuery ? `&q=${encodeURIComponent(searchQuery)}` : "";
      const s = statusFilter !== "ALL" ? `&stage=${statusFilter}` : "";
      const p = platformFilter !== "ALL" ? `&sourcePlatform=${platformFilter}` : "";
      const v = dealsView === "pipeline" ? "&view=pipeline" : "";
      const data = await api(`/api/crm/deals?limit=100${q}${s}${p}${v}`);
      setDeals(data.deals ?? []);
      setDealsTotal(data.total ?? 0);
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setLoading(false);
    }
  }, [api, searchQuery, statusFilter, platformFilter, dealsView, toast]);

  // Read URL query params on mount
  useEffect(() => {
    void loadBase();
    void loadStats();
  }, [loadBase, loadStats]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && CRM_TABS.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
    const idParam = searchParams.get("id");
    if (tabParam === "leads" && idParam) {
      void loadLeadDetail(idParam);
    } else if (tabParam === "deals" && idParam) {
      void loadDealDetail(idParam);
    } else if (tabParam === "contacts" && idParam) {
      void loadContactDetail(idParam);
    } else if (tabParam === "companies" && idParam) {
      void loadCompanyDetail(idParam);
    }
  }, [searchParams]);

  // Tab change fetcher
  useEffect(() => {
    if (activeTab === "overview") void loadStats();
    if (activeTab === "leads") void loadLeads();
    if (activeTab === "contacts") void loadContacts();
    if (activeTab === "companies") void loadCompanies();
    if (activeTab === "deals") void loadDeals();
  }, [activeTab, loadStats, loadLeads, loadContacts, loadCompanies, loadDeals]);

  // Detail loaders
  const loadLeadDetail = async (id: string) => {
    try {
      const data = await api(`/api/crm/leads/${id}`);
      setSelectedLead(data.lead);
      setDetailActivities(data.activities ?? []);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const loadDealDetail = async (id: string) => {
    try {
      const data = await api(`/api/crm/deals/${id}`);
      setSelectedDeal(data.deal);
      setDetailActivities(data.activities ?? []);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const loadContactDetail = async (id: string) => {
    try {
      const data = await api(`/api/crm/contacts/${id}`);
      setSelectedContact(data.contact);
      setDetailActivities(data.activities ?? []);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const loadCompanyDetail = async (id: string) => {
    try {
      const data = await api(`/api/crm/companies/${id}`);
      setSelectedCompany(data.company);
      setDetailActivities(data.activities ?? []);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Stage advancement for deals
  const advanceDealStage = async (deal: any, nextStage: string) => {
    try {
      await api(`/api/crm/deals/${deal.id}`, "PATCH", { stage: nextStage });
      toast(`Deal advanced to ${nextStage.replaceAll("_", " ")}`);
      void loadDeals();
      void loadStats();
      if (selectedDeal?.id === deal.id) void loadDealDetail(deal.id);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  // Convert deal to project
  const convertDealToProject = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!selectedDeal) return;
    const form = new FormData(e.currentTarget);
    try {
      const res = await api(`/api/crm/deals/${selectedDeal.id}/convert`, "POST", {
        confirm: true,
        projectName: form.get("projectName"),
        description: form.get("description"),
        priority: form.get("priority"),
        deadline: form.get("deadline") ? new Date(String(form.get("deadline"))).toISOString() : null,
        ownerId: form.get("ownerId") || undefined,
      });
      toast(`Converted to project "${res.project.name}"!`);
      setConvertDealOpen(false);
      void loadDeals();
      void loadStats();
      void loadDealDetail(selectedDeal.id);
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  const isOwnerOrAdmin = currentUser?.role === "OWNER" || currentUser?.role === "ADMIN";

  return (
    <div className="space-y-6">
      {/* Module Title & Tab Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[var(--border)] pb-4">
        <div>
          <div className="mb-1 text-[11px] font-bold uppercase tracking-[.16em] text-accent">
            Sales & Customer Intelligence
          </div>
          <h1 className="font-display text-[26px] font-extrabold tracking-[-.035em]">
            CRM & Pipeline
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Manage your leads, client relationships, companies, and active deal pipelines.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => {
              void loadStats();
              if (activeTab === "leads") void loadLeads();
              if (activeTab === "contacts") void loadContacts();
              if (activeTab === "companies") void loadCompanies();
              if (activeTab === "deals") void loadDeals();
            }}
          >
            <RefreshCw size={14} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <Button onClick={() => setCreateLeadOpen(true)}>
            <Plus size={14} />
            New Lead
          </Button>
          <Button onClick={() => setCreateDealOpen(true)}>
            <Target size={14} />
            New Deal
          </Button>
        </div>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto border-b border-[var(--border)] pb-1">
        {CRM_TABS.map(({ id, label, icon: Icon }) => {
          const isActive = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => {
                setActiveTab(id);
                setSelectedLead(null);
                setSelectedContact(null);
                setSelectedCompany(null);
                setSelectedDeal(null);
                setSearchQuery("");
                setStatusFilter("ALL");
                router.replace(`/crm?tab=${id}`, { scroll: false });
              }}
              className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
                isActive
                  ? "bg-accent text-white shadow-sm"
                  : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
              }`}
            >
              <Icon size={15} />
              <span>{label}</span>
              {id === "leads" && leadsTotal > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${isActive ? "bg-white/20" : "bg-[var(--hover)]"}`}>
                  {leadsTotal}
                </span>
              )}
              {id === "deals" && dealsTotal > 0 && (
                <span className={`rounded-full px-1.5 py-0.2 text-[10px] ${isActive ? "bg-white/20" : "bg-[var(--hover)]"}`}>
                  {dealsTotal}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* TAB 1: OVERVIEW & DASHBOARD */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          {statsLoading ? (
            <Loading />
          ) : stats ? (
            <>
              {/* Top Metric Cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                  <div className="flex items-center justify-between text-[var(--muted)]">
                    <span className="text-xs font-bold uppercase tracking-wider">Active Pipeline</span>
                    <Wallet size={18} className="text-accent" />
                  </div>
                  <div className="mt-3 text-2xl font-extrabold tracking-tight">
                    ₹{stats.pipelineValue.toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Across {stats.openDeals} open deals
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                  <div className="flex items-center justify-between text-[var(--muted)]">
                    <span className="text-xs font-bold uppercase tracking-wider">Closed Won Revenue</span>
                    <CheckCircle2 size={18} className="text-emerald-500" />
                  </div>
                  <div className="mt-3 text-2xl font-extrabold tracking-tight text-emerald-600 dark:text-emerald-400">
                    ₹{stats.wonValue.toLocaleString()}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {stats.wonDeals} deals won · {stats.winRate}% win rate
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                  <div className="flex items-center justify-between text-[var(--muted)]">
                    <span className="text-xs font-bold uppercase tracking-wider">Total Leads</span>
                    <UserCheck size={18} className="text-blue-500" />
                  </div>
                  <div className="mt-3 text-2xl font-extrabold tracking-tight">
                    {stats.totalLeads}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    {stats.newLeads} new · {stats.qualifiedLeads} qualified
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm">
                  <div className="flex items-center justify-between text-[var(--muted)]">
                    <span className="text-xs font-bold uppercase tracking-wider">CRM Directory</span>
                    <Building2 size={18} className="text-indigo-500" />
                  </div>
                  <div className="mt-3 text-2xl font-extrabold tracking-tight">
                    {stats.totalCompanies}
                  </div>
                  <div className="mt-1 text-xs text-[var(--muted)]">
                    Companies · {stats.totalContacts} Contacts
                  </div>
                </div>
              </div>

              {/* Action Banner */}
              <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-accent/20 bg-accent/5 p-5">
                <div>
                  <h3 className="font-display font-bold text-accent">Ready to log new business?</h3>
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    Keep your CRM fresh: log inbound inquiries, associate them with client organizations, and advance negotiations.
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setCreateContactOpen(true)}>
                    + Contact
                  </Button>
                  <Button variant="secondary" onClick={() => setCreateCompanyOpen(true)}>
                    + Company
                  </Button>
                  <Button onClick={() => setCreateDealOpen(true)}>
                    + Add Deal
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* TAB 2: LEADS */}
      {activeTab === "leads" && (
        <div className="space-y-4">
          {selectedLead ? (
            /* Lead Detail View */
            <div className="space-y-5">
              <button
                onClick={() => setSelectedLead(null)}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
              >
                <ArrowLeft size={14} /> Back to all leads
              </button>

              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                      {selectedLead.status}
                    </span>
                    {selectedLead.companyName && (
                      <span className="text-xs text-[var(--muted)]">· {selectedLead.companyName}</span>
                    )}
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-extrabold">{selectedLead.title}</h2>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                    {selectedLead.email && <span>Email: <b className="text-[var(--text)]">{selectedLead.email}</b></span>}
                    {selectedLead.phone && <span>Phone: <b className="text-[var(--text)]">{selectedLead.phone}</b></span>}
                    {selectedLead.estimatedValue && (
                      <span>Est. Value: <b className="text-accent">₹{selectedLead.estimatedValue.toLocaleString()}</b></span>
                    )}
                    <span>Score: <b>{selectedLead.score}/100</b></span>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Select
                    label=""
                    className="w-36 text-xs"
                    value={selectedLead.status}
                    onChange={async (e) => {
                      const next = e.target.value;
                      try {
                        await api(`/api/crm/leads/${selectedLead.id}`, "PATCH", { status: next });
                        toast(`Status updated to ${next}`);
                        void loadLeadDetail(selectedLead.id);
                        void loadLeads();
                      } catch (err: any) {
                        toast(err.message, "error");
                      }
                    }}
                  >
                    {LEAD_STATUSES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </Select>

                  <Button variant="secondary" onClick={() => setEditLeadOpen(true)}>
                    Edit Details
                  </Button>

                  {isOwnerOrAdmin && (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Archive lead "${selectedLead.title}"?`)) return;
                        try {
                          await api(`/api/crm/leads/${selectedLead.id}`, "DELETE");
                          toast("Lead archived");
                          setSelectedLead(null);
                          void loadLeads();
                        } catch (err: any) {
                          toast(err.message, "error");
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Lead Details Grid */}
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-5 lg:col-span-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Notes & Lead Intelligence</h3>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                      {selectedLead.notes || "No notes recorded for this lead yet."}
                    </p>
                  </div>

                  {/* Activity History */}
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Activity History</h3>
                    <div className="mt-4 divide-y divide-[var(--border)]">
                      {detailActivities.length > 0 ? (
                        detailActivities.map((act) => (
                          <div key={act.id} className="flex items-start gap-3 py-3">
                            <Avatar name={act.user?.name || "User"} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs">
                                <b>{act.user?.name}</b> {act.summary}
                              </p>
                              <span className="text-[10px] text-[var(--muted)]">
                                {formatDate(act.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="py-6 text-center text-xs text-[var(--muted)]">
                          No logged activities for this lead.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Assigned Owner</h3>
                    <div className="mt-3 flex items-center gap-3">
                      <Avatar name={selectedLead.assignedTo?.name || "Unassigned"} size="md" />
                      <div>
                        <div className="text-xs font-bold">{selectedLead.assignedTo?.name || "Unassigned"}</div>
                        <div className="text-[10px] text-[var(--muted)]">{selectedLead.assignedTo?.email || "No assignee"}</div>
                      </div>
                    </div>
                  </div>

                  {selectedLead.company && (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                      <h3 className="font-display font-bold">Associated Company</h3>
                      <div className="mt-2 text-sm font-semibold">{selectedLead.company.name}</div>
                      {selectedLead.company.domain && (
                        <div className="text-xs text-[var(--muted)]">{selectedLead.company.domain}</div>
                      )}
                    </div>
                  )}

                  {selectedLead.contact && (
                    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                      <h3 className="font-display font-bold">Associated Contact</h3>
                      <div className="mt-2 text-sm font-semibold">
                        {selectedLead.contact.firstName} {selectedLead.contact.lastName}
                      </div>
                      <div className="text-xs text-[var(--muted)]">{selectedLead.contact.email || selectedLead.contact.phone}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Leads Table / List */
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-64">
                    <Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" />
                    <input
                      placeholder="Search leads..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-accent"
                    />
                  </div>

                  <Select
                    label=""
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="h-9 text-xs"
                  >
                    <option value="ALL">All Statuses</option>
                    {LEAD_STATUSES.map((st) => (
                      <option key={st} value={st}>{st}</option>
                    ))}
                  </Select>
                </div>

                <div className="text-xs text-[var(--muted)]">
                  {leadsTotal} total leads
                </div>
              </div>

              {loading ? (
                <Loading />
              ) : leads.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                  <div className="divide-y divide-[var(--border)]">
                    {leads.map((lead) => (
                      <div
                        key={lead.id}
                        onClick={() => void loadLeadDetail(lead.id)}
                        className="group flex cursor-pointer flex-wrap items-center justify-between gap-4 p-4 transition hover:bg-[var(--hover)]"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-display text-sm font-bold group-hover:text-accent">
                              {lead.title}
                            </span>
                            <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-bold text-accent">
                              {lead.status}
                            </span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
                            {lead.companyName && <span>🏢 {lead.companyName}</span>}
                            {lead.email && <span>✉️ {lead.email}</span>}
                            {lead.phone && <span>📞 {lead.phone}</span>}
                            {lead.source && <span>Source: {lead.source}</span>}
                          </div>
                        </div>

                        <div className="flex items-center gap-4">
                          {lead.estimatedValue ? (
                            <div className="text-right">
                              <div className="text-xs font-bold text-accent">
                                ₹{lead.estimatedValue.toLocaleString()}
                              </div>
                              <div className="text-[10px] text-[var(--muted)]">Score: {lead.score}/100</div>
                            </div>
                          ) : null}

                          <Avatar name={lead.assignedTo?.name || "Unassigned"} size="sm" />
                          <ArrowRight size={14} className="text-[var(--muted)] group-hover:text-accent" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<UserCheck size={24} />}
                  title="No leads found"
                  description="Start building your business pipeline by logging a prospective customer lead."
                  action={
                    <Button onClick={() => setCreateLeadOpen(true)}>
                      <Plus size={14} /> Create First Lead
                    </Button>
                  }
                />
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 3: CONTACTS */}
      {activeTab === "contacts" && (
        <div className="space-y-4">
          {selectedContact ? (
            /* Contact Detail View */
            <div className="space-y-5">
              <button
                onClick={() => setSelectedContact(null)}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
              >
                <ArrowLeft size={14} /> Back to all contacts
              </button>

              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                      {selectedContact.status}
                    </span>
                    {selectedContact.title && (
                      <span className="text-xs text-[var(--muted)]">· {selectedContact.title}</span>
                    )}
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-extrabold">
                    {selectedContact.firstName} {selectedContact.lastName}
                  </h2>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                    {selectedContact.email && <span>Email: <b className="text-[var(--text)]">{selectedContact.email}</b></span>}
                    {selectedContact.phone && <span>Phone: <b className="text-[var(--text)]">{selectedContact.phone}</b></span>}
                    {selectedContact.company && (
                      <span>Company: <b className="text-accent">{selectedContact.company.name}</b></span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => setEditContactOpen(true)}>
                    Edit Details
                  </Button>
                  {isOwnerOrAdmin && (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Archive contact "${selectedContact.firstName} ${selectedContact.lastName}"?`)) return;
                        try {
                          await api(`/api/crm/contacts/${selectedContact.id}`, "DELETE");
                          toast("Contact archived");
                          setSelectedContact(null);
                          void loadContacts();
                        } catch (err: any) {
                          toast(err.message, "error");
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Associated deals & leads */}
              <div className="grid gap-6 lg:grid-cols-2">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h3 className="font-display font-bold">Associated Deals</h3>
                  <div className="mt-3 divide-y divide-[var(--border)]">
                    {selectedContact.deals?.length > 0 ? (
                      selectedContact.deals.map((deal: any) => (
                        <div key={deal.id} className="flex items-center justify-between py-2 text-xs">
                          <div>
                            <b>{deal.title}</b>
                            <span className="ml-2 text-[10px] text-[var(--muted)]">{deal.stage}</span>
                          </div>
                          <span className="font-bold text-accent">₹{deal.value.toLocaleString()}</span>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-xs text-[var(--muted)]">No deals linked to this contact.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h3 className="font-display font-bold">Associated Leads</h3>
                  <div className="mt-3 divide-y divide-[var(--border)]">
                    {selectedContact.leads?.length > 0 ? (
                      selectedContact.leads.map((lead: any) => (
                        <div key={lead.id} className="flex items-center justify-between py-2 text-xs">
                          <div>
                            <b>{lead.title}</b>
                            <span className="ml-2 text-[10px] text-[var(--muted)]">{lead.status}</span>
                          </div>
                          {lead.estimatedValue && (
                            <span className="font-bold text-accent">₹{lead.estimatedValue.toLocaleString()}</span>
                          )}
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-xs text-[var(--muted)]">No leads linked to this contact.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Contacts Grid */
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-64">
                  <Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" />
                  <input
                    placeholder="Search contacts..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-accent"
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button onClick={() => setCreateContactOpen(true)}>
                    <Plus size={14} /> New Contact
                  </Button>
                </div>
              </div>

              {loading ? (
                <Loading />
              ) : contacts.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {contacts.map((contact) => (
                    <div
                      key={contact.id}
                      onClick={() => void loadContactDetail(contact.id)}
                      className="group cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-soft"
                    >
                      <div className="flex items-start justify-between">
                        <Avatar name={`${contact.firstName} ${contact.lastName}`} size="md" />
                        <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[9px] font-bold uppercase text-accent">
                          {contact.status}
                        </span>
                      </div>
                      <h3 className="mt-3 font-display text-sm font-bold group-hover:text-accent">
                        {contact.firstName} {contact.lastName}
                      </h3>
                      {contact.title && (
                        <p className="text-xs text-[var(--muted)]">{contact.title}</p>
                      )}
                      {contact.company && (
                        <div className="mt-2 text-xs font-semibold text-accent">
                          🏢 {contact.company.name}
                        </div>
                      )}
                      <div className="mt-4 border-t border-[var(--border)] pt-3 text-[11px] text-[var(--muted)] space-y-1">
                        {contact.email && <div className="truncate">✉️ {contact.email}</div>}
                        {contact.phone && <div>📞 {contact.phone}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Users size={24} />}
                  title="No contacts found"
                  description="Build your directory of clients, decision makers, and partner contacts."
                  action={
                    <Button onClick={() => setCreateContactOpen(true)}>
                      <Plus size={14} /> Add Contact
                    </Button>
                  }
                />
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 4: COMPANIES */}
      {activeTab === "companies" && (
        <div className="space-y-4">
          {selectedCompany ? (
            /* Company Detail View */
            <div className="space-y-5">
              <button
                onClick={() => setSelectedCompany(null)}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
              >
                <ArrowLeft size={14} /> Back to all companies
              </button>

              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <div>
                  <h2 className="font-display text-2xl font-extrabold">{selectedCompany.name}</h2>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                    {selectedCompany.industry && <span>Industry: <b className="text-[var(--text)]">{selectedCompany.industry}</b></span>}
                    {selectedCompany.size && <span>Size: <b className="text-[var(--text)]">{selectedCompany.size}</b></span>}
                    {selectedCompany.website && <span>Web: <b className="text-accent">{selectedCompany.website}</b></span>}
                    {selectedCompany.phone && <span>Phone: <b className="text-[var(--text)]">{selectedCompany.phone}</b></span>}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button variant="secondary" onClick={() => setEditCompanyOpen(true)}>
                    Edit Company
                  </Button>
                  {isOwnerOrAdmin && (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Archive company "${selectedCompany.name}"?`)) return;
                        try {
                          await api(`/api/crm/companies/${selectedCompany.id}`, "DELETE");
                          toast("Company archived");
                          setSelectedCompany(null);
                          void loadCompanies();
                        } catch (err: any) {
                          toast(err.message, "error");
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Related Records Tabs / Columns */}
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h3 className="font-display font-bold">Contacts ({selectedCompany.contacts?.length ?? 0})</h3>
                  <div className="mt-3 divide-y divide-[var(--border)]">
                    {selectedCompany.contacts?.length > 0 ? (
                      selectedCompany.contacts.map((c: any) => (
                        <div key={c.id} className="py-2 text-xs">
                          <b className="block">{c.firstName} {c.lastName}</b>
                          <span className="text-[10px] text-[var(--muted)]">{c.title || c.email}</span>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-xs text-[var(--muted)]">No contacts linked.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h3 className="font-display font-bold">Deals ({selectedCompany.deals?.length ?? 0})</h3>
                  <div className="mt-3 divide-y divide-[var(--border)]">
                    {selectedCompany.deals?.length > 0 ? (
                      selectedCompany.deals.map((d: any) => (
                        <div key={d.id} className="py-2 text-xs flex justify-between">
                          <div>
                            <b className="block">{d.title}</b>
                            <span className="text-[10px] text-[var(--muted)]">{d.stage}</span>
                          </div>
                          <span className="font-bold text-accent">₹{d.value.toLocaleString()}</span>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-xs text-[var(--muted)]">No deals recorded.</p>
                    )}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                  <h3 className="font-display font-bold">Leads ({selectedCompany.leads?.length ?? 0})</h3>
                  <div className="mt-3 divide-y divide-[var(--border)]">
                    {selectedCompany.leads?.length > 0 ? (
                      selectedCompany.leads.map((l: any) => (
                        <div key={l.id} className="py-2 text-xs">
                          <b className="block">{l.title}</b>
                          <span className="text-[10px] text-[var(--muted)]">{l.status}</span>
                        </div>
                      ))
                    ) : (
                      <p className="py-4 text-xs text-[var(--muted)]">No leads recorded.</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Companies Grid */
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="relative w-64">
                  <Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" />
                  <input
                    placeholder="Search companies..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-accent"
                  />
                </div>
                <Button onClick={() => setCreateCompanyOpen(true)}>
                  <Plus size={14} /> New Company
                </Button>
              </div>

              {loading ? (
                <Loading />
              ) : companies.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {companies.map((co) => (
                    <div
                      key={co.id}
                      onClick={() => void loadCompanyDetail(co.id)}
                      className="group cursor-pointer rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:-translate-y-0.5 hover:border-accent/30 hover:shadow-soft"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10 text-accent font-bold">
                          {co.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="truncate font-display text-sm font-bold group-hover:text-accent">
                            {co.name}
                          </h3>
                          <p className="truncate text-xs text-[var(--muted)]">{co.domain || co.industry || "Company profile"}</p>
                        </div>
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[11px] text-[var(--muted)]">
                        <span>{co._count?.contacts ?? 0} Contacts</span>
                        <span>{co._count?.deals ?? 0} Deals</span>
                        <span>{co._count?.leads ?? 0} Leads</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyState
                  icon={<Building2 size={24} />}
                  title="No companies found"
                  description="Register prospective and active client companies in your account database."
                  action={
                    <Button onClick={() => setCreateCompanyOpen(true)}>
                      <Plus size={14} /> Add Company
                    </Button>
                  }
                />
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 5: DEALS & PIPELINE */}
      {activeTab === "deals" && (
        <div className="space-y-4">
          {selectedDeal ? (
            /* Deal Detail View */
            <div className="space-y-5">
              <button
                onClick={() => setSelectedDeal(null)}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
              >
                <ArrowLeft size={14} /> Back to deals
              </button>

              <div className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-accent/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-accent">
                      {selectedDeal.stage.replaceAll("_", " ")}
                    </span>
                    {selectedDeal.company && (
                      <span className="text-xs text-[var(--muted)]">· {selectedDeal.company.name}</span>
                    )}
                  </div>
                  <h2 className="mt-2 font-display text-2xl font-extrabold">{selectedDeal.title}</h2>
                  <div className="mt-2 flex flex-wrap gap-4 text-xs text-[var(--muted)]">
                    <span>Value: <b className="text-accent text-sm">₹{selectedDeal.value.toLocaleString()}</b></span>
                    <span>Probability: <b>{selectedDeal.probability}%</b></span>
                    {selectedDeal.expectedCloseDate && (
                      <span>Close Date: <b>{formatDate(selectedDeal.expectedCloseDate)}</b></span>
                    )}
                    <span>Owner: <b>{selectedDeal.owner?.name || "Unassigned"}</b></span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {/* Stage Advancement */}
                  {selectedDeal.stage !== "CLOSED_WON" && selectedDeal.stage !== "CLOSED_LOST" && (
                    <Button
                      variant="primary"
                      onClick={() => {
                        const idx = DEAL_STAGES.indexOf(selectedDeal.stage);
                        if (idx < DEAL_STAGES.length - 2) {
                          void advanceDealStage(selectedDeal, DEAL_STAGES[idx + 1]);
                        } else {
                          void advanceDealStage(selectedDeal, "CLOSED_WON");
                        }
                      }}
                    >
                      Advance Stage →
                    </Button>
                  )}

                  {/* Project Conversion Button */}
                  {isOwnerOrAdmin && !selectedDeal.convertedProjectId && (
                    <Button
                      variant="secondary"
                      className="border-emerald-300 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-800 dark:text-emerald-400"
                      onClick={() => setConvertDealOpen(true)}
                    >
                      <FileCheck2 size={14} /> Convert to Project
                    </Button>
                  )}

                  {selectedDeal.convertedProject && (
                    <Button
                      variant="secondary"
                      onClick={() => router.push(`/projects?project=${selectedDeal.convertedProject.id}`)}
                    >
                      <ExternalLink size={14} /> View Project ({selectedDeal.convertedProject.name})
                    </Button>
                  )}

                  <Button variant="secondary" onClick={() => setEditDealOpen(true)}>
                    Edit Deal
                  </Button>

                  {isOwnerOrAdmin && (
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!confirm(`Archive deal "${selectedDeal.title}"?`)) return;
                        try {
                          await api(`/api/crm/deals/${selectedDeal.id}`, "DELETE");
                          toast("Deal archived");
                          setSelectedDeal(null);
                          void loadDeals();
                        } catch (err: any) {
                          toast(err.message, "error");
                        }
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              </div>

              {/* Deal Grid */}
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="space-y-5 lg:col-span-2">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Deal Scope & Notes</h3>
                    <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--muted)]">
                      {selectedDeal.notes || "No notes recorded for this deal."}
                    </p>
                  </div>

                  {/* Proposals & Client Quotations */}
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="font-display font-bold">Proposals & Quotations</h3>
                        <p className="text-xs text-[var(--muted)] mt-0.5">
                          Technical proposals, deliverables, and commercial pricing.
                        </p>
                      </div>
                      <Button
                        variant="secondary"
                        onClick={() => setCreateProposalOpen(true)}
                        className="text-xs"
                      >
                        <Plus size={13} /> Draft Proposal
                      </Button>
                    </div>

                    <div className="mt-4 space-y-3">
                      {selectedDeal.proposals && selectedDeal.proposals.length > 0 ? (
                        selectedDeal.proposals.map((prop: any) => (
                          <div
                            key={prop.id}
                            className="p-4 rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 space-y-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-xs">v{prop.version}: {prop.title}</span>
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  prop.status === "ACCEPTED"
                                    ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                                    : prop.status === "READY_TO_SEND" || prop.status === "SENT"
                                    ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40"
                                    : prop.status === "INTERNAL_REVIEW"
                                    ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                                    : "bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400"
                                }`}>
                                  {prop.status.replaceAll("_", " ")}
                                </span>
                              </div>
                              <span className="font-bold text-accent text-xs">
                                ₹{prop.pricing.toLocaleString()}
                              </span>
                            </div>

                            <p className="text-xs text-[var(--muted)] line-clamp-2">
                              {prop.problemStatement || prop.scope}
                            </p>

                            <div className="flex items-center justify-between pt-2 border-t border-[var(--border)] text-[11px]">
                              <span className="text-[var(--muted)]">Timeline: {prop.timeline}</span>
                              <div className="flex items-center gap-1.5">
                                {prop.status === "DRAFT" && (
                                  <Button
                                    variant="secondary"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={async () => {
                                      await api(`/api/crm/proposals/${prop.id}`, "PATCH", { status: "INTERNAL_REVIEW" });
                                      toast("Submitted for internal team review");
                                      void loadDealDetail(selectedDeal.id);
                                    }}
                                  >
                                    Submit for Review
                                  </Button>
                                )}
                                {prop.status === "INTERNAL_REVIEW" && (
                                  <Button
                                    variant="secondary"
                                    className="h-7 px-2.5 text-xs"
                                    onClick={async () => {
                                      await api(`/api/crm/proposals/${prop.id}`, "PATCH", { status: "READY_TO_SEND" });
                                      toast("Proposal marked ready to send");
                                      void loadDealDetail(selectedDeal.id);
                                    }}
                                  >
                                    Approve & Ready
                                  </Button>
                                )}
                                {(prop.status === "READY_TO_SEND" || prop.status === "SENT") && (
                                  <Button
                                    variant="primary"
                                    className="h-7 px-2.5 text-xs bg-emerald-600 hover:bg-emerald-700"
                                    onClick={() => setAcceptProposalModal(prop)}
                                  >
                                    Record Client Acceptance ✓
                                  </Button>
                                )}
                              </div>
                            </div>
                            {prop.status === "ACCEPTED" && prop.acceptanceChannel && (
                              <div className="mt-2 text-[10px] text-emerald-800 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/50 p-2 rounded-lg">
                                <span className="font-bold">Verified Client Acceptance:</span> Received via {prop.acceptanceChannel.replace("_", " ")} (Ref: {prop.acceptanceReference})
                                {prop.acceptanceNotes && <span className="block mt-0.5 text-neutral-600 dark:text-neutral-400">Notes: {prop.acceptanceNotes}</span>}
                              </div>
                            )}
                          </div>
                        ))
                      ) : (
                        <p className="py-4 text-center text-xs text-[var(--muted)]">
                          No proposals drafted yet. Draft an initial technical proposal or quotation.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Activity History */}
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Activity History</h3>
                    <div className="mt-4 divide-y divide-[var(--border)]">
                      {detailActivities.length > 0 ? (
                        detailActivities.map((act) => (
                          <div key={act.id} className="flex items-start gap-3 py-3">
                            <Avatar name={act.user?.name || "User"} size="sm" />
                            <div className="min-w-0 flex-1">
                              <p className="text-xs">
                                <b>{act.user?.name}</b> {act.summary}
                              </p>
                              <span className="text-[10px] text-[var(--muted)]">
                                {formatDate(act.createdAt, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                              </span>
                            </div>
                          </div>
                        ))
                      ) : (
                        <p className="py-6 text-center text-xs text-[var(--muted)]">
                          No logged activities for this deal.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Channel & Opportunity</h3>
                    <div className="mt-3 space-y-2.5 text-xs">
                      <div>
                        Acquisition Platform:{" "}
                        <span className="font-bold text-accent">
                          {selectedDeal.sourcePlatform || "Direct Inquiry"}
                        </span>
                      </div>
                      {selectedDeal.externalUrl && isSafeHttpUrl(selectedDeal.externalUrl) && (
                        <div>
                          <a
                            href={selectedDeal.externalUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 text-accent hover:underline font-semibold"
                          >
                            <ExternalLink size={12} /> Open Job Posting ↗
                          </a>
                        </div>
                      )}
                      {selectedDeal.nextAction && (
                        <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200">
                          <b className="block">Next Action:</b>
                          <p className="mt-0.5">{selectedDeal.nextAction}</p>
                        </div>
                      )}
                      {selectedDeal.followUpDate && (
                        <div>
                          Follow-up Due: <b>{formatDate(selectedDeal.followUpDate)}</b>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                    <h3 className="font-display font-bold">Client Information</h3>
                    <div className="mt-3 space-y-2 text-xs">
                      <div>Company: <b>{selectedDeal.company?.name || "None specified"}</b></div>
                      <div>Contact: <b>{selectedDeal.contact ? `${selectedDeal.contact.firstName} ${selectedDeal.contact.lastName}` : "None"}</b></div>
                      {selectedDeal.contact?.email && <div>Email: {selectedDeal.contact.email}</div>}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Pipeline or Table View */
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative w-64">
                    <Search size={15} className="absolute left-3 top-2.5 text-[var(--muted)]" />
                    <input
                      placeholder="Search deals..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="h-9 w-full rounded-lg border border-[var(--border)] bg-[var(--surface)] pl-9 pr-3 text-xs outline-none focus:border-accent"
                    />
                  </div>

                  {/* Channel / Platform Filter */}
                  <select
                    value={platformFilter}
                    onChange={(e) => setPlatformFilter(e.target.value)}
                    className="h-9 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5 text-xs font-semibold focus:border-accent focus:outline-none"
                  >
                    <option value="ALL">All Acquisition Channels</option>
                    <option value="UPWORK">Upwork</option>
                    <option value="FREELANCER">Freelancer</option>
                    <option value="FIVERR">Fiverr</option>
                    <option value="LINKEDIN">LinkedIn</option>
                    <option value="DIRECT">Direct Client</option>
                    <option value="REFERRAL">Referral</option>
                    <option value="OTHER">Other</option>
                  </select>

                  <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
                    <button
                      onClick={() => setDealsView("pipeline")}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                        dealsView === "pipeline" ? "bg-accent text-white" : "text-[var(--muted)]"
                      }`}
                    >
                      <Kanban size={13} /> Pipeline
                    </button>
                    <button
                      onClick={() => setDealsView("table")}
                      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${
                        dealsView === "table" ? "bg-accent text-white" : "text-[var(--muted)]"
                      }`}
                    >
                      <TableIcon size={13} /> Table
                    </button>
                  </div>
                </div>

                <Button onClick={() => setCreateDealOpen(true)}>
                  <Plus size={14} /> New Opportunity
                </Button>
              </div>

              {loading ? (
                <Loading />
              ) : dealsView === "pipeline" ? (
                /* Kanban Columns */
                <div className="grid gap-4 overflow-x-auto pb-4 md:grid-cols-5 min-w-[900px]">
                  {DEAL_STAGES.map((stage) => {
                    const stageDeals = deals.filter((d) => d.stage === stage);
                    const stageSum = stageDeals.reduce((sum, d) => sum + (d.currency === "INR" || !d.currency ? d.value : 0), 0);

                    return (
                      <div
                        key={stage}
                        className="flex flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-2)]/60 p-3"
                      >
                        <div className="mb-3 flex items-center justify-between px-1">
                          <span className="text-xs font-bold text-[var(--muted)]">
                            {stage.replaceAll("_", " ")} ({stageDeals.length})
                          </span>
                          <span className="text-[11px] font-extrabold text-accent">
                            ₹{stageSum.toLocaleString()}
                          </span>
                        </div>

                        <div className="flex-1 space-y-3">
                          {stageDeals.length > 0 ? (
                            stageDeals.map((deal) => (
                              <div
                                key={deal.id}
                                onClick={() => void loadDealDetail(deal.id)}
                                className="group cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-accent hover:shadow-soft"
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="font-display text-xs font-bold group-hover:text-accent flex-1">
                                    {deal.title}
                                  </div>
                                  {deal.externalUrl && isSafeHttpUrl(deal.externalUrl) && (
                                    <a
                                      href={deal.externalUrl}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      onClick={(e) => e.stopPropagation()}
                                      className="text-[var(--muted)] hover:text-accent p-0.5"
                                      title="Open original job posting"
                                    >
                                      <ExternalLink size={12} />
                                    </a>
                                  )}
                                </div>

                                <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted)]">
                                  {deal.sourcePlatform && (
                                    <span className="rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 px-1.5 py-0.2 font-bold">
                                      {deal.sourcePlatform}
                                    </span>
                                  )}
                                  {deal.company && <span>🏢 {deal.company.name}</span>}
                                  {deal.proposals && deal.proposals.length > 0 && (
                                    <span className="rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-0.2 font-bold">
                                      {deal.proposals.length} proposal{deal.proposals.length > 1 ? "s" : ""}
                                    </span>
                                  )}
                                </div>

                                {deal.nextAction && (
                                  <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-300 font-medium truncate">
                                    🎯 {deal.nextAction}
                                  </div>
                                )}

                                {deal.followUpDate && (
                                  <div className="mt-1 text-[10px] text-[var(--muted)]">
                                    📅 Follow-up: {formatDate(deal.followUpDate)}
                                  </div>
                                )}

                                <div className="mt-3 flex items-center justify-between border-t border-[var(--border)] pt-2 text-xs">
                                  <span className="font-bold text-accent">₹{deal.value.toLocaleString()}</span>
                                  <span className="text-[10px] text-[var(--muted)]">{deal.probability}%</span>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="rounded-xl border border-dashed border-[var(--border)] py-8 text-center text-[11px] text-[var(--muted)]">
                              No deals
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                /* Table View */
                deals.length > 0 ? (
                  <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]">
                        <tr>
                          <th className="px-4 py-3 font-semibold">Deal Name</th>
                          <th className="px-4 py-3 font-semibold">Company</th>
                          <th className="px-4 py-3 font-semibold">Stage</th>
                          <th className="px-4 py-3 font-semibold">Value</th>
                          <th className="px-4 py-3 font-semibold">Prob.</th>
                          <th className="px-4 py-3 font-semibold">Owner</th>
                          <th className="px-4 py-3 font-semibold">Close Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)]">
                        {deals.map((deal) => (
                          <tr
                            key={deal.id}
                            onClick={() => void loadDealDetail(deal.id)}
                            className="cursor-pointer transition hover:bg-[var(--hover)]"
                          >
                            <td className="px-4 py-3 font-semibold">{deal.title}</td>
                            <td className="px-4 py-3 text-[var(--muted)]">{deal.company?.name || "—"}</td>
                            <td className="px-4 py-3">
                              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[9px] font-bold text-accent">
                                {deal.stage.replaceAll("_", " ")}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-accent">₹{deal.value.toLocaleString()}</td>
                            <td className="px-4 py-3 text-[var(--muted)]">{deal.probability}%</td>
                            <td className="px-4 py-3 text-[var(--muted)]">{deal.owner?.name || "Unassigned"}</td>
                            <td className="px-4 py-3 text-[var(--muted)]">{deal.expectedCloseDate ? formatDate(deal.expectedCloseDate) : "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <EmptyState
                    icon={<Target size={24} />}
                    title="No deals found"
                    description="Create a deal to track incoming revenue and commercial contracts."
                    action={
                      <Button onClick={() => setCreateDealOpen(true)}>
                        <Plus size={14} /> Add First Deal
                      </Button>
                    }
                  />
                )
              )}
            </>
          )}
        </div>
      )}

      {/* MODAL: CREATE LEAD */}
      <Modal open={createLeadOpen} onClose={() => setCreateLeadOpen(false)} title="Create Inbound Lead">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("/api/crm/leads", "POST", {
                title: form.get("title"),
                companyName: form.get("companyName"),
                email: form.get("email"),
                phone: form.get("phone"),
                status: form.get("status"),
                source: form.get("source"),
                estimatedValue: form.get("estimatedValue") ? Number(form.get("estimatedValue")) : undefined,
                score: form.get("score") ? Number(form.get("score")) : 0,
                assignedToId: form.get("assignedToId") || undefined,
                notes: form.get("notes"),
              });
              toast("Lead created successfully");
              setCreateLeadOpen(false);
              void loadLeads();
              void loadStats();
            } catch (err: any) {
              toast(err.message, "error");
            }
          }}
          className="space-y-4"
        >
          <Field label="Lead Title / Name *" name="title" required placeholder="e.g. Acme Cloud Modernization" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company Name" name="companyName" placeholder="e.g. Acme Corp" />
            <Field label="Source" name="source" placeholder="e.g. Referral, Website, Cold Outreach" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" name="email" type="email" placeholder="name@company.com" />
            <Field label="Phone" name="phone" placeholder="+91 98765 43210" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Estimated Value (₹)" name="estimatedValue" type="number" min="0" placeholder="500000" />
            <Select label="Status" name="status" defaultValue="NEW">
              {LEAD_STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </Select>
          </div>
          <Select label="Assigned Owner" name="assignedToId" defaultValue={currentUser?.id || ""}>
            <option value="">Assign to Me</option>
            {teamMembers.map((m) => (
              <option key={m.id} value={m.id}>{m.name} ({m.role.toLowerCase()})</option>
            ))}
          </Select>
          <Textarea label="Lead Notes / Requirements" name="notes" rows={3} placeholder="Key requirements, client context..." />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateLeadOpen(false)}>Cancel</Button>
            <Button>Create Lead</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CREATE CONTACT */}
      <Modal open={createContactOpen} onClose={() => setCreateContactOpen(false)} title="Add Contact">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("/api/crm/contacts", "POST", {
                firstName: form.get("firstName"),
                lastName: form.get("lastName"),
                email: form.get("email"),
                phone: form.get("phone"),
                title: form.get("title"),
                status: form.get("status"),
                companyId: form.get("companyId") || undefined,
                notes: form.get("notes"),
              });
              toast("Contact added successfully");
              setCreateContactOpen(false);
              void loadContacts();
            } catch (err: any) {
              toast(err.message, "error");
            }
          }}
          className="space-y-4"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="First Name *" name="firstName" required placeholder="John" />
            <Field label="Last Name *" name="lastName" required placeholder="Doe" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Email" name="email" type="email" placeholder="john.doe@client.com" />
            <Field label="Phone" name="phone" placeholder="+91 98765 43210" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Job Title" name="title" placeholder="e.g. Chief Technology Officer" />
            <Select label="Status" name="status" defaultValue="LEAD">
              {CONTACT_STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </Select>
          </div>
          <Select label="Associate Company" name="companyId">
            <option value="">No Company</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
          <Textarea label="Contact Notes" name="notes" rows={2} placeholder="Background, preferences..." />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateContactOpen(false)}>Cancel</Button>
            <Button>Add Contact</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CREATE COMPANY */}
      <Modal open={createCompanyOpen} onClose={() => setCreateCompanyOpen(false)} title="Register Company">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("/api/crm/companies", "POST", {
                name: form.get("name"),
                domain: form.get("domain"),
                industry: form.get("industry"),
                size: form.get("size"),
                website: form.get("website"),
                phone: form.get("phone"),
                address: form.get("address"),
                notes: form.get("notes"),
              });
              toast("Company registered successfully");
              setCreateCompanyOpen(false);
              void loadCompanies();
            } catch (err: any) {
              toast(err.message, "error");
            }
          }}
          className="space-y-4"
        >
          <Field label="Company Name *" name="name" required placeholder="e.g. Global Logistics Inc" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Domain" name="domain" placeholder="globallogistics.com" />
            <Field label="Industry" name="industry" placeholder="Supply Chain / Tech" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Company Size" name="size" placeholder="e.g. 50-200 employees" />
            <Field label="Website" name="website" placeholder="https://globallogistics.com" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Phone" name="phone" placeholder="+1 (555) 019-2834" />
            <Field label="Address / Location" name="address" placeholder="Mumbai, MH, India" />
          </div>
          <Textarea label="Company Notes" name="notes" rows={2} placeholder="Account summary..." />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateCompanyOpen(false)}>Cancel</Button>
            <Button>Register Company</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CREATE DEAL */}
      <Modal open={createDealOpen} onClose={() => setCreateDealOpen(false)} title="Add Project Opportunity">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            try {
              await api("/api/crm/deals", "POST", {
                title: form.get("title"),
                value: Number(form.get("value")) || 0,
                currency: "INR",
                stage: form.get("stage"),
                companyId: form.get("companyId") || undefined,
                contactId: form.get("contactId") || undefined,
                expectedCloseDate: form.get("closeDate") ? new Date(String(form.get("closeDate"))).toISOString() : undefined,
                ownerId: form.get("ownerId") || undefined,
                sourcePlatform: form.get("sourcePlatform") || undefined,
                externalUrl: form.get("externalUrl") || undefined,
                nextAction: form.get("nextAction") || undefined,
                followUpDate: form.get("followUpDate") ? new Date(String(form.get("followUpDate"))).toISOString() : undefined,
                notes: form.get("notes"),
              });
              toast("Opportunity created successfully");
              setCreateDealOpen(false);
              void loadDeals();
              void loadStats();
            } catch (err: any) {
              toast(err.message, "error");
            }
          }}
          className="space-y-4"
        >
          <Field label="Opportunity Title *" name="title" required placeholder="e.g. AWS Migration & High-Availability ECS" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Deal Value (₹) *" name="value" type="number" min="0" required placeholder="35000" />
            <Select label="Stage" name="stage" defaultValue="DISCOVERY">
              {DEAL_STAGES.map((st) => (
                <option key={st} value={st}>{st.replaceAll("_", " ")}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Acquisition Channel" name="sourcePlatform" defaultValue="UPWORK">
              <option value="UPWORK">Upwork</option>
              <option value="FREELANCER">Freelancer</option>
              <option value="FIVERR">Fiverr</option>
              <option value="LINKEDIN">LinkedIn</option>
              <option value="DIRECT">Direct Client</option>
              <option value="REFERRAL">Referral</option>
              <option value="OTHER">Other</option>
            </Select>
            <Field label="Job / RFP Posting URL" name="externalUrl" type="url" placeholder="https://www.upwork.com/jobs/..." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Company" name="companyId">
              <option value="">No Company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Select label="Primary Contact" name="contactId">
              <option value="">No Contact</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </Select>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Next Operational Action" name="nextAction" placeholder="e.g. Draft technical proposal by 5 PM" />
            <Field label="Follow-up Date" name="followUpDate" type="date" />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expected Close Date" name="closeDate" type="date" />
            <Select label="Deal Owner" name="ownerId" defaultValue={currentUser?.id || ""}>
              <option value="">Assign to Me</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
          </div>
          <Textarea label="Commercial Notes & Scope" name="notes" rows={3} placeholder="Pricing structure, deliverable terms, client expectations..." />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateDealOpen(false)}>Cancel</Button>
            <Button>Create Opportunity</Button>
          </div>
        </form>
      </Modal>

      {/* MODAL: CONVERT WON DEAL TO PROJECT */}
      <Modal open={convertDealOpen} onClose={() => setConvertDealOpen(false)} title="Convert Deal to Delivery Project">
        {selectedDeal && (
          <form onSubmit={convertDealToProject} className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4 dark:border-emerald-950 dark:bg-emerald-950/20">
              <h4 className="text-xs font-bold text-emerald-800 dark:text-emerald-300">
                Commercial Contract Won: {selectedDeal.title}
              </h4>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Converting this deal will automatically set the deal status to <b>CLOSED WON</b>, create an active
                delivery project in the Project workspace, and link both records for delivery traceability.
              </p>
            </div>

            <Field
              label="Project Name *"
              name="projectName"
              required
              defaultValue={selectedDeal.title}
            />

            <Textarea
              label="Project Delivery Brief"
              name="description"
              rows={3}
              defaultValue={selectedDeal.notes || `Delivery project originating from sales deal: ${selectedDeal.title}`}
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Priority" name="priority" defaultValue="HIGH">
                <option value="LOW">Low</option>
                <option value="MEDIUM">Medium</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </Select>

              <Field
                label="Target Deadline"
                name="deadline"
                type="date"
                defaultValue={selectedDeal.expectedCloseDate ? new Date(selectedDeal.expectedCloseDate).toISOString().slice(0, 10) : ""}
              />
            </div>

            <Select label="Designated Project Lead" name="ownerId" defaultValue={selectedDeal.ownerId || currentUser?.id}>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name} ({m.role.toLowerCase()})</option>
              ))}
            </Select>

            <div className="flex justify-end gap-2 pt-3">
              <Button type="button" variant="secondary" onClick={() => setConvertDealOpen(false)}>
                Cancel
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700">
                Confirm & Create Project
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: EDIT LEAD (F-P2-04) */}
      <Modal open={editLeadOpen} onClose={() => setEditLeadOpen(false)} title="Edit Inbound Lead">
        {selectedLead && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await api(`/api/crm/leads/${selectedLead.id}`, "PATCH", {
                  title: form.get("title"),
                  companyName: form.get("companyName") || null,
                  companyId: form.get("companyId") || null,
                  contactId: form.get("contactId") || null,
                  email: form.get("email") || null,
                  phone: form.get("phone") || null,
                  status: form.get("status"),
                  source: form.get("source") || null,
                  estimatedValue: form.get("estimatedValue") ? Number(form.get("estimatedValue")) : null,
                  score: form.get("score") ? Number(form.get("score")) : 0,
                  assignedToId: form.get("assignedToId") || null,
                  notes: form.get("notes"),
                });
                toast("Lead updated successfully");
                setEditLeadOpen(false);
                void loadLeadDetail(selectedLead.id);
                void loadLeads();
                void loadStats();
              } catch (err: any) {
                toast(err.message, "error");
              }
            }}
            className="space-y-4"
          >
            <Field label="Lead Title / Name *" name="title" required defaultValue={selectedLead.title} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company Name" name="companyName" defaultValue={selectedLead.companyName || ""} placeholder="Acme Corp" />
              <Select label="Linked Company" name="companyId" defaultValue={selectedLead.companyId || ""}>
                <option value="">No linked company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email Address" name="email" type="email" defaultValue={selectedLead.email || ""} placeholder="lead@acme.com" />
              <Field label="Phone" name="phone" defaultValue={selectedLead.phone || ""} placeholder="+1 (555) 019-2834" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Status" name="status" defaultValue={selectedLead.status}>
                {LEAD_STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </Select>
              <Field label="Lead Score (0-100)" name="score" type="number" min="0" max="100" defaultValue={selectedLead.score || 0} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Source Channel" name="source" defaultValue={selectedLead.source || ""} placeholder="Referral, Inbound, Event" />
              <Field label="Estimated Value (₹)" name="estimatedValue" type="number" min="0" defaultValue={selectedLead.estimatedValue || ""} placeholder="500000" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Assigned Team Member" name="assignedToId" defaultValue={selectedLead.assignedToId || ""}>
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </Select>
              <Select label="Primary Contact" name="contactId" defaultValue={selectedLead.contactId || ""}>
                <option value="">No linked contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                ))}
              </Select>
            </div>
            <Textarea label="Lead Notes / Context" name="notes" rows={3} defaultValue={selectedLead.notes || ""} placeholder="Initial conversation notes, requirements..." />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditLeadOpen(false)}>Cancel</Button>
              <Button>Save Changes</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: EDIT CONTACT (F-P2-04) */}
      <Modal open={editContactOpen} onClose={() => setEditContactOpen(false)} title="Edit Contact">
        {selectedContact && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await api(`/api/crm/contacts/${selectedContact.id}`, "PATCH", {
                  firstName: form.get("firstName"),
                  lastName: form.get("lastName"),
                  email: form.get("email") || null,
                  phone: form.get("phone") || null,
                  title: form.get("title") || null,
                  status: form.get("status"),
                  companyId: form.get("companyId") || null,
                  notes: form.get("notes"),
                });
                toast("Contact updated successfully");
                setEditContactOpen(false);
                void loadContactDetail(selectedContact.id);
                void loadContacts();
                void loadStats();
              } catch (err: any) {
                toast(err.message, "error");
              }
            }}
            className="space-y-4"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="First Name *" name="firstName" required defaultValue={selectedContact.firstName} />
              <Field label="Last Name *" name="lastName" required defaultValue={selectedContact.lastName} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email" name="email" type="email" defaultValue={selectedContact.email || ""} placeholder="contact@company.com" />
              <Field label="Phone" name="phone" defaultValue={selectedContact.phone || ""} placeholder="+1 (555) 019-2834" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Job Title" name="title" defaultValue={selectedContact.title || ""} placeholder="VP Engineering" />
              <Select label="Status" name="status" defaultValue={selectedContact.status}>
                {CONTACT_STATUSES.map((st) => (
                  <option key={st} value={st}>{st}</option>
                ))}
              </Select>
            </div>
            <Select label="Company" name="companyId" defaultValue={selectedContact.companyId || ""}>
              <option value="">No Company</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Textarea label="Contact Notes" name="notes" rows={3} defaultValue={selectedContact.notes || ""} placeholder="Personal preferences, relationship notes..." />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditContactOpen(false)}>Cancel</Button>
              <Button>Save Changes</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: EDIT COMPANY (F-P2-04) */}
      <Modal open={editCompanyOpen} onClose={() => setEditCompanyOpen(false)} title="Edit Company Details">
        {selectedCompany && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await api(`/api/crm/companies/${selectedCompany.id}`, "PATCH", {
                  name: form.get("name"),
                  domain: form.get("domain") || null,
                  industry: form.get("industry") || null,
                  size: form.get("size") || null,
                  website: form.get("website") || null,
                  phone: form.get("phone") || null,
                  address: form.get("address") || null,
                  notes: form.get("notes"),
                });
                toast("Company updated successfully");
                setEditCompanyOpen(false);
                void loadCompanyDetail(selectedCompany.id);
                void loadCompanies();
              } catch (err: any) {
                toast(err.message, "error");
              }
            }}
            className="space-y-4"
          >
            <Field label="Company Name *" name="name" required defaultValue={selectedCompany.name} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Domain" name="domain" defaultValue={selectedCompany.domain || ""} placeholder="globallogistics.com" />
              <Field label="Industry" name="industry" defaultValue={selectedCompany.industry || ""} placeholder="Supply Chain / Tech" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Company Size" name="size" defaultValue={selectedCompany.size || ""} placeholder="e.g. 50-200 employees" />
              <Field label="Website" name="website" defaultValue={selectedCompany.website || ""} placeholder="https://globallogistics.com" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Phone" name="phone" defaultValue={selectedCompany.phone || ""} placeholder="+1 (555) 019-2834" />
              <Field label="Address / Location" name="address" defaultValue={selectedCompany.address || ""} placeholder="Mumbai, MH, India" />
            </div>
            <Textarea label="Company Notes" name="notes" rows={2} defaultValue={selectedCompany.notes || ""} placeholder="Account summary..." />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditCompanyOpen(false)}>Cancel</Button>
              <Button>Save Changes</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: EDIT DEAL (F-P2-04) */}
      <Modal open={editDealOpen} onClose={() => setEditDealOpen(false)} title="Edit Opportunity Details">
        {selectedDeal && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await api(`/api/crm/deals/${selectedDeal.id}`, "PATCH", {
                  title: form.get("title"),
                  value: Number(form.get("value")) || 0,
                  currency: "INR",
                  stage: form.get("stage"),
                  probability: form.get("probability") ? Number(form.get("probability")) : undefined,
                  companyId: form.get("companyId") || null,
                  contactId: form.get("contactId") || null,
                  sourcePlatform: form.get("sourcePlatform") || null,
                  externalUrl: form.get("externalUrl") || null,
                  nextAction: form.get("nextAction") || null,
                  followUpDate: form.get("followUpDate") ? new Date(String(form.get("followUpDate"))).toISOString() : null,
                  expectedCloseDate: form.get("closeDate") ? new Date(String(form.get("closeDate"))).toISOString() : null,
                  ownerId: form.get("ownerId") || null,
                  notes: form.get("notes"),
                });
                toast("Deal updated successfully");
                setEditDealOpen(false);
                void loadDealDetail(selectedDeal.id);
                void loadDeals();
                void loadStats();
              } catch (err: any) {
                toast(err.message, "error");
              }
            }}
            className="space-y-4"
          >
            <Field label="Deal Title *" name="title" required defaultValue={selectedDeal.title} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Deal Value (₹) *" name="value" type="number" min="0" required defaultValue={selectedDeal.value} />
              <Select label="Stage" name="stage" defaultValue={selectedDeal.stage}>
                {DEAL_STAGES.map((st) => (
                  <option key={st} value={st}>{st.replaceAll("_", " ")}</option>
                ))}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Acquisition Channel" name="sourcePlatform" defaultValue={selectedDeal.sourcePlatform || "UPWORK"}>
                <option value="UPWORK">Upwork</option>
                <option value="FREELANCER">Freelancer</option>
                <option value="FIVERR">Fiverr</option>
                <option value="LINKEDIN">LinkedIn</option>
                <option value="DIRECT">Direct Client</option>
                <option value="REFERRAL">Referral</option>
                <option value="OTHER">Other</option>
              </Select>
              <Field label="Job / RFP Posting URL" name="externalUrl" type="url" defaultValue={selectedDeal.externalUrl || ""} placeholder="https://..." />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Next Operational Action" name="nextAction" defaultValue={selectedDeal.nextAction || ""} placeholder="e.g. Follow up on proposal" />
              <Field
                label="Follow-up Date"
                name="followUpDate"
                type="date"
                defaultValue={selectedDeal.followUpDate ? new Date(selectedDeal.followUpDate).toISOString().slice(0, 10) : ""}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Probability (%)" name="probability" type="number" min="0" max="100" defaultValue={selectedDeal.probability} />
              <Field
                label="Expected Close Date"
                name="closeDate"
                type="date"
                defaultValue={selectedDeal.expectedCloseDate ? new Date(selectedDeal.expectedCloseDate).toISOString().slice(0, 10) : ""}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Company" name="companyId" defaultValue={selectedDeal.companyId || ""}>
                <option value="">No Company</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
              <Select label="Primary Contact" name="contactId" defaultValue={selectedDeal.contactId || ""}>
                <option value="">No Contact</option>
                {contacts.map((c) => (
                  <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                ))}
              </Select>
            </div>
            <Select label="Deal Owner" name="ownerId" defaultValue={selectedDeal.ownerId || ""}>
              <option value="">Unassigned</option>
              {teamMembers.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
            <Textarea label="Commercial Notes & Scope" name="notes" rows={3} defaultValue={selectedDeal.notes || ""} placeholder="Pricing structure, deliverable terms..." />
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setEditDealOpen(false)}>Cancel</Button>
              <Button>Save Changes</Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: DRAFT PROPOSAL */}
      <Modal open={createProposalOpen} onClose={() => setCreateProposalOpen(false)} title="Draft Technical Proposal / SOW">
        {selectedDeal && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              setProposalBusy(true);
              try {
                await api("/api/crm/proposals", "POST", {
                  dealId: selectedDeal.id,
                  title: form.get("title"),
                  clientName: form.get("clientName") || selectedDeal.company?.name || "Prospective Client",
                  problemStatement: form.get("problemStatement"),
                  solution: form.get("solution"),
                  scope: form.get("scope"),
                  deliverables: form.get("deliverables"),
                  timeline: form.get("timeline"),
                  pricing: Number(form.get("pricing")) || 0,
                  currency: "INR",
                  paymentTerms: form.get("paymentTerms"),
                  status: "DRAFT",
                });
                toast("Proposal drafted successfully");
                setCreateProposalOpen(false);
                void loadDealDetail(selectedDeal.id);
                void loadDeals();
              } catch (err: any) {
                toast(err.message, "error");
              } finally {
                setProposalBusy(false);
              }
            }}
            className="space-y-4"
          >
            <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)]/40 p-3">
              <label className="text-xs font-bold text-neutral-900 dark:text-neutral-100 block mb-1">
                Proposal Outline Template
              </label>
              <select
                value={proposalTemplate}
                onChange={(e) => setProposalTemplate(e.target.value)}
                className="w-full h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-semibold"
              >
                <option value="cloud_infra">AWS Cloud Infrastructure Setup & Migration (Fixed Price ₹35,000)</option>
                <option value="aws_ops">24/7 Managed Server & AWS Cloud Operations (Retainer ₹20,000/mo)</option>
                <option value="devops_ci">DevOps CI/CD Pipeline & Containerization (Fixed Price ₹25,000)</option>
                <option value="custom">Custom Empty Proposal</option>
              </select>
            </div>

            <Field
              label="Proposal Title *"
              name="title"
              required
              defaultValue={
                proposalTemplate === "cloud_infra"
                  ? `AWS Cloud Infrastructure Architecture for ${selectedDeal.title}`
                  : proposalTemplate === "aws_ops"
                  ? `24/7 Managed Cloud Operations for ${selectedDeal.title}`
                  : proposalTemplate === "devops_ci"
                  ? `CI/CD Automation & Docker Deployment for ${selectedDeal.title}`
                  : `Proposal: ${selectedDeal.title}`
              }
            />

            <Field
              label="Client Organization / Name *"
              name="clientName"
              required
              defaultValue={selectedDeal.company?.name || "Client Enterprise"}
            />

            <Textarea
              label="Problem Statement & Context *"
              name="problemStatement"
              required
              rows={2}
              defaultValue={
                proposalTemplate === "cloud_infra"
                  ? "Client requires a secure, high-availability AWS foundation to eliminate downtime and scale reliably."
                  : proposalTemplate === "aws_ops"
                  ? "Client requires 24/7 continuous cloud infrastructure monitoring, security patching, and proactive incident response."
                  : proposalTemplate === "devops_ci"
                  ? "Release cycle is manual and slow. Client requires an automated CI/CD pipeline with containerized deployments."
                  : "Client requirements summary..."
              }
            />

            <Textarea
              label="Proposed Technical Solution *"
              name="solution"
              required
              rows={2}
              defaultValue={
                proposalTemplate === "cloud_infra"
                  ? "Multi-AZ AWS architecture utilizing Terraform IaC, Application Load Balancers, hardened EC2 instances, and RDS PostgreSQL Multi-AZ."
                  : proposalTemplate === "aws_ops"
                  ? "Implementation of Prometheus/Grafana and CloudWatch monitoring with automated Slack/Telegram alert triggers and SLA guarantees."
                  : proposalTemplate === "devops_ci"
                  ? "Containerization using Docker multi-stage builds and automated GitHub Actions workflow for zero-downtime rolling deploys."
                  : "Technical architecture and strategy..."
              }
            />

            <Textarea
              label="Deliverables & Acceptance Scope *"
              name="deliverables"
              required
              rows={3}
              defaultValue={
                proposalTemplate === "cloud_infra"
                  ? "1. Terraform IaC scripts in Git repo\n2. Hardened VPC, EC2, and RDS Multi-AZ\n3. CloudFront SSL setup\n4. Zero-downtime database migration\n5. Handover runbook"
                  : proposalTemplate === "aws_ops"
                  ? "1. Real-time Grafana/CloudWatch dashboards\n2. Automated daily backup verification\n3. Monthly security patch updates\n4. < 1 hr incident response SLA"
                  : proposalTemplate === "devops_ci"
                  ? "1. Optimized Dockerfile (< 100MB)\n2. Automated GitHub Actions CI/CD pipeline\n3. Zero-downtime rolling restart\n4. Local development docker-compose"
                  : "Key milestone deliverables..."
              }
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Timeline / Duration *"
                name="timeline"
                required
                defaultValue={
                  proposalTemplate === "cloud_infra"
                    ? "2 weeks"
                    : proposalTemplate === "aws_ops"
                    ? "Monthly Retainer"
                    : proposalTemplate === "devops_ci"
                    ? "10 days"
                    : "2 weeks"
                }
              />
              <Field
                label="Proposed Fee (₹ INR) *"
                name="pricing"
                type="number"
                min="0"
                required
                defaultValue={
                  proposalTemplate === "cloud_infra"
                    ? 35000
                    : proposalTemplate === "aws_ops"
                    ? 20000
                    : proposalTemplate === "devops_ci"
                    ? 25000
                    : selectedDeal.value || 30000
                }
              />
            </div>

            <Textarea
              label="Payment Terms & Invoicing Schedule *"
              name="paymentTerms"
              required
              rows={2}
              defaultValue={
                proposalTemplate === "aws_ops"
                  ? "100% advance monthly retainer invoice on the 1st of each month."
                  : "50% upfront deposit upon contract signing, 50% upon final acceptance & production handover."
              }
            />

            <input
              type="hidden"
              name="scope"
              value={
                proposalTemplate === "cloud_infra"
                  ? "Full AWS architecture setup and migration"
                  : proposalTemplate === "aws_ops"
                  ? "Ongoing 24/7 cloud operations and support"
                  : "CI/CD and container automation"
              }
            />

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="secondary" onClick={() => setCreateProposalOpen(false)}>
                Cancel
              </Button>
              <Button disabled={proposalBusy}>
                {proposalBusy ? "Saving…" : "Save Proposal Draft"}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* MODAL: RECORD CLIENT ACCEPTANCE EVIDENCE */}
      <Modal
        open={Boolean(acceptProposalModal)}
        onClose={() => setAcceptProposalModal(null)}
        title="Record Client Proposal Acceptance"
      >
        {acceptProposalModal && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              const channel = form.get("acceptanceChannel") as string;
              const ref = form.get("acceptanceReference") as string;
              const notes = form.get("acceptanceNotes") as string;

              if (!channel || !ref) {
                return toast("Acceptance channel and reference ID are required", "error");
              }

              try {
                await api(`/api/crm/proposals/${acceptProposalModal.id}`, "PATCH", {
                  status: "ACCEPTED",
                  acceptanceChannel: channel,
                  acceptanceReference: ref,
                  acceptanceNotes: notes || null,
                });
                toast("Proposal acceptance recorded and deal marked CLOSED_WON.");
                setAcceptProposalModal(null);
                void loadDealDetail(selectedDeal.id);
                void loadDeals();
              } catch (err: any) {
                toast(err.message, "error");
              }
            }}
            className="space-y-4"
          >
            <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-3 text-xs text-amber-800 dark:text-amber-200">
              Audit Standard: An operator must record the client confirmation channel and communication reference before marking a proposal accepted.
            </div>
            <Select label="Acceptance Channel *" name="acceptanceChannel" required defaultValue="UPWORK_CONTRACT">
              <option value="UPWORK_CONTRACT">Upwork Contract Award</option>
              <option value="EMAIL">Client Email Confirmation</option>
              <option value="SIGNED_AGREEMENT">Counter-Signed SOW / Agreement</option>
              <option value="PURCHASE_ORDER">Purchase Order (PO)</option>
              <option value="OTHER">Other Documented Channel</option>
            </Select>
            <Field
              label="Confirmation Reference Identifier / URL *"
              name="acceptanceReference"
              required
              placeholder="e.g. Contract URL, Email Message ID, or PO number"
            />
            <Textarea
              label="Acceptance Notes / Specific Deliverable Confirmation"
              name="acceptanceNotes"
              rows={2}
              placeholder="Optional confirmation notes or client instructions..."
            />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" type="button" onClick={() => setAcceptProposalModal(null)}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" className="bg-emerald-600 hover:bg-emerald-700">
                Confirm & Record Acceptance
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}

