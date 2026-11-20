"use client";
import { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import {
  Briefcase,
  Building2,
  CheckCircle2,
  Clock,
  Edit,
  FolderGit2,
  KeyRound,
  Laptop,
  ListChecks,
  LockKeyhole,
  Network,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  UserCheck,
  Users,
  Activity,
} from "lucide-react";
import { Avatar, Button, Field, Modal, SectionTitle, Select, Textarea, useToast } from "@/components/ui";
import { AiUsagePanel } from "@/components/modules/ai-usage";
import { AiProvidersPanel } from "@/components/ai-providers-panel";

interface ReadinessItem {
  id: string;
  category: string;
  title: string;
  description: string;
  status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
  ownerId?: string | null;
  notes?: string | null;
  completedAt?: string | null;
  owner?: { id: string; name: string; email: string } | null;
}

interface ReadinessSummary {
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  progressPercent: number;
}

export function SettingsModule() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") as any;
  const [tab, setTab] = useState<"general" | "company" | "readiness" | "services" | "portfolio" | "usage" | "providers">(
    initialTab && ["general", "company", "readiness", "services", "portfolio", "usage", "providers"].includes(initialTab)
      ? initialTab
      : "general"
  );
  const [user, setUser] = useState<any>();
  const [workspace, setWorkspace] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [workspaceBusy, setWorkspaceBusy] = useState(false);

  // Readiness state
  const [readinessItems, setReadinessItems] = useState<ReadinessItem[]>([]);
  const [readinessSummary, setReadinessSummary] = useState<ReadinessSummary | null>(null);
  const [readinessLoading, setReadinessLoading] = useState(false);

  const toast = useToast();

  const loadData = () => {
    Promise.all([
      fetch("/api/auth/me").then((res) => res.json()),
      fetch("/api/workspace").then((res) => res.json()),
    ]).then(([me, result]) => {
      setUser(me.user);
      setWorkspace(result.workspace);
      setLoading(false);
    });
  };

  const loadReadiness = () => {
    setReadinessLoading(true);
    fetch("/api/company/readiness")
      .then((res) => res.json())
      .then((data) => {
        if (data.items) {
          setReadinessItems(data.items);
          setReadinessSummary(data.summary);
        }
      })
      .finally(() => setReadinessLoading(false));
  };

  useEffect(() => {
    loadData();
    loadReadiness();
  }, []);

  const saveProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setProfileBusy(true);
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        title: form.get("title") || null,
        avatarUrl: form.get("avatarUrl") || null,
      }),
    });
    const data = await response.json();
    setProfileBusy(false);
    if (!response.ok) return toast(data.error, "error");
    setUser({ ...user, ...data.user });
    toast("Profile updated");
  };

  const changePassword = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setPasswordBusy(true);
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentPassword: form.get("currentPassword"),
        newPassword: form.get("newPassword"),
      }),
    });
    const data = await response.json();
    setPasswordBusy(false);
    if (!response.ok) return toast(data.error ?? "Failed to update password", "error");
    formElement.reset();
    toast("Password updated successfully. Other active sessions for this account were signed out.");
  };

  const saveWorkspaceDetails = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setWorkspaceBusy(true);
    const payload = {
      name: form.get("name"),
      tagline: form.get("tagline") || null,
      industry: form.get("industry") || null,
      website: form.get("website") || null,
      phone: form.get("phone") || null,
      address: form.get("address") || null,
      timezone: form.get("timezone") || null,
      ...(user.role === "OWNER" ? { registrationDetails: form.get("registrationDetails") || null } : {}),
      loginEmail: form.get("loginEmail"),
    };
    const response = await fetch("/api/workspace", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setWorkspaceBusy(false);
    if (!response.ok) return toast(data.error, "error");
    setWorkspace(data.workspace);
    toast("Company profile updated successfully.");
  };

  const updateReadinessStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/company/readiness/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast(`Readiness status set to ${newStatus.replace("_", " ")}`);
        loadReadiness();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to update readiness status", "error");
      }
    } catch {
      toast("Error updating readiness item", "error");
    }
  };

  if (loading)
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-12 w-52 rounded bg-[var(--hover)]" />
        <div className="h-52 rounded-2xl bg-[var(--hover)]" />
      </div>
    );

  return (
    <div>
      <SectionTitle
        eyebrow="Workspace & Operations"
        title="Settings & Company Setup"
        subtitle="Configure company identity, business readiness checklist, individual profile, and remote access."
      />

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-[var(--border)] pb-2 text-sm font-semibold">
        <button
          onClick={() => setTab("general")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
            tab === "general"
              ? "bg-accent text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          }`}
        >
          <KeyRound size={15} />
          Profile & Access
        </button>
        <button
          onClick={() => setTab("company")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
            tab === "company"
              ? "bg-accent text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          }`}
        >
          <Building2 size={15} />
          Company Profile
        </button>
        <button
          onClick={() => setTab("readiness")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
            tab === "readiness"
              ? "bg-accent text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          }`}
        >
          <ListChecks size={15} />
          Launch Readiness
          {readinessSummary && (
            <span className="ml-1 rounded-full bg-white/20 px-1.5 py-0.2 text-[10px]">
              {readinessSummary.progressPercent}%
            </span>
          )}
        </button>
        <button
          onClick={() => setTab("services")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
            tab === "services"
              ? "bg-accent text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          }`}
        >
          <Briefcase size={15} />
          Services
        </button>
        <button
          onClick={() => setTab("portfolio")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
            tab === "portfolio"
              ? "bg-accent text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          }`}
        >
          <FolderGit2 size={15} />
          Portfolio
        </button>
        <button
          onClick={() => setTab("usage")}
          className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
            tab === "usage"
              ? "bg-accent text-white"
              : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
          }`}
        >
          <Activity size={15} />
          AI Usage
        </button>
        {(user?.role === "OWNER" || user?.role === "ADMIN") && (
          <button
            onClick={() => setTab("providers")}
            className={`flex items-center gap-2 rounded-lg px-3 py-1.5 transition ${
              tab === "providers"
                ? "bg-accent text-white"
                : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
            }`}
          >
            <KeyRound size={15} />
            AI Providers
          </button>
        )}
      </div>

      {/* TAB 1: GENERAL & PROFILE */}
      {tab === "general" && (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,.8fr)]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-3">
                <Avatar name={user.name} src={user.avatarUrl} size="lg" />
                <div>
                  <h2 className="font-display font-bold">Active Profile</h2>
                  <p className="text-xs text-[var(--muted)]">This identity is visible across tasks, proposals, and team activities.</p>
                </div>
              </div>
              <form onSubmit={saveProfile} className="space-y-4">
                <Field label="Name" name="name" required defaultValue={user.name} maxLength={80} />
                <Field label="Job title" name="title" defaultValue={user.title ?? ""} maxLength={100} placeholder="e.g. Lead DevOps Engineer / Founder" />
                <Field label="Profile picture URL" name="avatarUrl" type="url" defaultValue={user.avatarUrl ?? ""} placeholder="https://..." />
                <p className="-mt-2 text-[10px] text-[var(--muted)]">Use an HTTPS image URL for your team avatar.</p>
                <Button disabled={profileBusy}>
                  <Save size={14} />
                  {profileBusy ? "Saving…" : "Save profile"}
                </Button>
              </form>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6">
              <div className="mb-5 flex items-center gap-2">
                <KeyRound size={16} className="text-accent" />
                <div>
                  <h2 className="font-display font-bold">Account Security & Password</h2>
                  <p className="text-xs text-[var(--muted)]">Update your individual account credentials.</p>
                </div>
              </div>
              <div className="mb-4">
                <Field label="Your corporate email" value={user.email ?? "No individual email configured"} disabled />
              </div>
              <form onSubmit={changePassword} className="space-y-4">
                <Field label="Current password" name="currentPassword" type="password" required autoComplete="current-password" placeholder="Enter current password" />
                <Field label="New password" name="newPassword" type="password" required minLength={12} maxLength={128} autoComplete="new-password" placeholder="At least 12 characters" />
                <Button variant="secondary" disabled={passwordBusy}>
                  <LockKeyhole size={14} />
                  {passwordBusy ? "Updating…" : "Update password"}
                </Button>
              </form>
              <p className="mt-3 text-[10px] leading-4 text-[var(--muted)]">
                Passwords must be at least 12 characters long. Changing your password invalidates all other active sessions for your account.
              </p>
            </section>
          </div>

          <div className="space-y-5">
            {(user?.role === "OWNER" || user?.role === "ADMIN") && <PermissionsCard />}

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="mb-4 flex items-center gap-2">
                <Laptop size={16} className="text-accent" />
                <h2 className="font-display font-bold">Self-Hosting & Shared Access</h2>
              </div>
              <div className="space-y-4 text-xs">
                <div>
                  <b className="flex items-center gap-1.5"><Network size={13} />Local access</b>
                  <p className="mt-1 leading-5 text-[var(--muted)]">Development runs on <code className="rounded bg-[var(--hover)] px-1 py-0.5">http://localhost:3001</code>. For same-room peer access, use this laptop&apos;s Wi-Fi LAN IP.</p>
                </div>
                <div>
                  <b className="flex items-center gap-1.5"><ShieldCheck size={13} />Remote collaborator access</b>
                  <p className="mt-1 leading-5 text-[var(--muted)]">Use Cloudflare Tunnel (<code className="rounded bg-[var(--hover)] px-1 py-0.5">cloudflared tunnel</code>) or Tailscale for private HTTPS access without exposing ports.</p>
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <h2 className="font-display font-bold">Active Role</h2>
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-full bg-[#f0efff] px-2.5 py-1 text-[10px] font-bold text-accent dark:bg-[#302c4e]">{user.role}</span>
                <span className="text-xs text-[var(--muted)]">Authorized account</span>
              </div>
            </section>
          </div>
        </div>
      )}

      {/* TAB 2: COMPANY PROFILE */}
      {tab === "company" && (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6 max-w-4xl">
          <div className="mb-6">
            <h2 className="text-base font-display font-bold text-neutral-900 dark:text-neutral-100">
              Company Identity & Business Details
            </h2>
            <p className="text-xs text-[var(--muted)] mt-1">
              These details appear on proposals, client invoices, and represent Cyraops across channels.
            </p>
          </div>

          <form onSubmit={saveWorkspaceDetails} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Company Name" name="name" defaultValue={workspace?.name ?? "Cyraops"} required minLength={2} maxLength={100} />
              <Field label="Official Tagline" name="tagline" defaultValue={workspace?.tagline ?? "Cloud Infrastructure & Managed IT Services"} maxLength={255} placeholder="e.g. Cloud Infrastructure, 24/7 Ops & DevOps" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Industry Focus" name="industry" defaultValue={workspace?.industry ?? "IT Services & Cloud Consulting"} maxLength={100} />
              <Field label="Primary Website" name="website" type="url" defaultValue={workspace?.website ?? "https://cyraops.com"} maxLength={255} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Support / Invoicing Email" name="loginEmail" type="email" defaultValue={workspace?.loginEmail ?? "admin@cyraops.com"} required maxLength={254} />
              <Field label="Contact Phone / WhatsApp" name="phone" defaultValue={workspace?.phone ?? ""} maxLength={50} placeholder="+91 98765 43210" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Operational Timezone" name="timezone" defaultValue={workspace?.timezone ?? "Asia/Kolkata"} maxLength={50} />
              <Field label="Office / Registered Address" name="address" defaultValue={workspace?.address ?? ""} maxLength={500} placeholder="City, State, Country" />
            </div>

            {user.role === "OWNER" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-[var(--muted)]">Tax / GST / Bank Account Details</label>
                <textarea
                  name="registrationDetails"
                  defaultValue={workspace?.registrationDetails ?? ""}
                  rows={3}
                  placeholder="GSTIN, PAN, or Bank Transfer Details"
                  className="w-full rounded-xl border border-[var(--border)] bg-transparent p-3 text-xs focus:border-accent focus:outline-none"
                />
                <p className="text-[11px] text-amber-600 dark:text-amber-400">
                  Security advisory: Do not store internet banking passwords, UPI PINs, or transaction credentials here. Real bank account details should not be entered until an encrypted vault policy is deployed.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 text-xs text-[var(--muted)]">
                <p className="font-semibold text-neutral-800 dark:text-neutral-200">Tax & Banking Information</p>
                <p className="text-[11px] mt-0.5">Commercial registration and banking transfer details are restricted to the Workspace Owner.</p>
              </div>
            )}

            {user.role === "OWNER" ? (
              <Button disabled={workspaceBusy}>
                <Save size={14} />
                {workspaceBusy ? "Saving…" : "Save Company Profile"}
              </Button>
            ) : (
              <p className="text-xs text-amber-600">Only the Workspace Owner can modify company identity fields.</p>
            )}
          </form>
        </section>
      )}

      {/* TAB 3: BUSINESS READINESS CHECKLIST */}
      {tab === "readiness" && (
        <div className="space-y-6 max-w-4xl">
          {/* Progress Header */}
          {readinessSummary && (
            <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                    Business Launch Readiness Progress
                  </h3>
                  <p className="text-xs text-[var(--muted)] mt-0.5">
                    {readinessSummary.completed} of {readinessSummary.total} essential operational gates completed
                  </p>
                </div>
                <span className="text-xl font-bold font-display text-accent">
                  {readinessSummary.progressPercent}%
                </span>
              </div>
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-[var(--hover)]">
                <div
                  className="h-full bg-accent transition-all duration-500 rounded-full"
                  style={{ width: `${readinessSummary.progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Checklist Items */}
          <div className="space-y-3">
            {readinessItems.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-neutral-300 dark:hover:border-neutral-700"
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="rounded-md bg-neutral-100 dark:bg-neutral-800 px-2 py-0.5 text-[10px] font-bold text-neutral-600 dark:text-neutral-300">
                        {item.category.replace("_", " ")}
                      </span>
                      <h4 className="text-sm font-bold text-neutral-900 dark:text-neutral-100">
                        {item.title}
                      </h4>
                    </div>
                    <p className="text-xs text-[var(--muted)]">{item.description}</p>
                    {item.notes && (
                      <p className="mt-2 text-xs text-neutral-700 dark:text-neutral-300 italic bg-[var(--hover)] p-2 rounded-lg">
                        Note: {item.notes}
                      </p>
                    )}
                  </div>

                  {/* Status Dropdown / Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    <select
                      value={item.status}
                      onChange={(e) => updateReadinessStatus(item.id, e.target.value)}
                      className={`h-8 rounded-lg border px-2.5 text-xs font-semibold focus:outline-none ${
                        item.status === "COMPLETED"
                          ? "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-400"
                          : item.status === "IN_PROGRESS"
                          ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-400"
                          : "border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]"
                      }`}
                    >
                      <option value="NOT_STARTED">Not Started</option>
                      <option value="IN_PROGRESS">In Progress</option>
                      <option value="COMPLETED">Completed</option>
                      <option value="BLOCKED">Blocked</option>
                    </select>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: SERVICES CATALOGUE */}
      {tab === "services" && <ServicesTab user={user} />}

      {/* TAB 5: PORTFOLIO & CASE STUDIES */}
      {tab === "portfolio" && <PortfolioTab user={user} />}

      {/* AI usage and spend, per person */}
      {tab === "usage" && <AiUsagePanel />}

      {/* Bring-your-own-key AI providers */}
      {tab === "providers" && <AiProvidersPanel />}
    </div>
  );
}

// ============================================================================
// UNIFIED PERMISSION MANAGER CARD
// ============================================================================
const PERMISSION_MODE_OPTIONS = [
  { value: "READ_ONLY", label: "Read only", description: "Every mutating action is denied; agents can only read." },
  { value: "CONTROLLED", label: "Controlled (default)", description: "Reads run freely; writes wait for approval." },
  { value: "FULL_CONTROL", label: "Full control", description: "Owner actions run without approval; others stay controlled." },
  { value: "SYSTEM", label: "System", description: "Full control plus harness shell and filesystem tools." },
];

interface PermissionAgent {
  id: string;
  slug: string;
  name: string;
  mode: string | null;
  effective: string;
}

interface PermissionState {
  workspace: { id: string; name: string; mode: string };
  agents: PermissionAgent[];
}

/** GET /api/bot/status — the user's mode resolved through the turn path. */
interface BotStatus {
  mode: string;
  effectiveMode: string;
  workspace: { id: string; ownerId: string; permissionMode: string } | null;
  workspaceOwnerMatch: boolean;
  root: string | null;
  shellEnabled: boolean;
  systemToolsEnabled: boolean;
}

/**
 * Functional replacement for the static Access & Collaboration card. Rendered
 * only for OWNER/ADMIN (the API is Owner/Admin gated); members never see the
 * controls. Backed by GET/POST /api/ai/permission-mode.
 */
function PermissionsCard() {
  const [state, setState] = useState<PermissionState | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState<string | null>(null);
  const [agentDrafts, setAgentDrafts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [botStatus, setBotStatus] = useState<BotStatus | null>(null);

  // Wave 1a: the user's effective mode, resolved through the SAME ownership-
  // verified path turns use, so the card can never disagree with a turn.
  const loadBotStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/bot/status");
      const data = await res.json();
      if (res.ok) setBotStatus(data);
    } catch {
      // Non-fatal: the mode selects still work without the status banner.
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/permission-mode");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load permission modes");
      setState(data);
      setWorkspaceDraft(null);
      setAgentDrafts({});
    } catch (err: any) {
      setError(err.message ?? "Failed to load permission modes");
    } finally {
      setLoading(false);
    }
    void loadBotStatus();
  }, [loadBotStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    if (!state) return;
    setSaving(true);
    setError(null);
    setSaved(false);

    // One POST per changed field; each response carries the full new state.
    const patches: { workspaceMode?: string; agentId?: string; agentMode?: string | null }[] = [];
    if (workspaceDraft && workspaceDraft !== state.workspace.mode) {
      patches.push({ workspaceMode: workspaceDraft });
    }
    for (const agent of state.agents) {
      const current = agent.mode ?? "";
      const draft = agentDrafts[agent.id] ?? current;
      if (draft !== current) {
        patches.push({ agentId: agent.id, agentMode: draft === "" ? null : draft });
      }
    }
    if (patches.length === 0) {
      setSaving(false);
      return;
    }

    try {
      let latest: PermissionState | null = null;
      for (const patch of patches) {
        const res = await fetch("/api/ai/permission-mode", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to save permission modes");
        latest = data;
      }
      if (latest) {
        setState(latest);
        setWorkspaceDraft(null);
        setAgentDrafts({});
      }
      setSaved(true);
    } catch (err: any) {
      setError(err.message ?? "Failed to save permission modes");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="animate-pulse space-y-3">
          <div className="h-4 w-36 rounded bg-[var(--hover)]" />
          <div className="h-9 rounded-lg bg-[var(--hover)]" />
          <div className="h-9 rounded-lg bg-[var(--hover)]" />
          <div className="h-9 rounded-lg bg-[var(--hover)]" />
        </div>
      </section>
    );
  }

  if (!state) {
    return (
      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <div className="mb-4 flex items-center gap-2">
          <ShieldCheck size={16} className="text-emerald-600" />
          <h2 className="font-display font-bold">Permissions</h2>
        </div>
        <p className="text-xs text-rose-600">{error ?? "Could not load permission modes."}</p>
        <Button variant="secondary" className="mt-3" onClick={() => void load()}>
          Retry
        </Button>
      </section>
    );
  }

  const workspaceMode = workspaceDraft ?? state.workspace.mode;

  return (
    <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center gap-2">
        <ShieldCheck size={16} className="text-emerald-600" />
        <div>
          <h2 className="font-display font-bold">Permissions</h2>
          <p className="text-[10px] text-[var(--muted)]">Unified AI permission modes for the workspace and its agents.</p>
        </div>
      </div>

      {botStatus && (
        <div className="mb-4 space-y-2">
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[var(--muted)]">Your bot&apos;s effective mode:</span>
            <span className="rounded-full bg-accent/10 px-2.5 py-1 text-[11px] font-bold text-accent">
              {botStatus.effectiveMode.replace(/_/g, " ")}
            </span>
          </div>
          {!botStatus.workspaceOwnerMatch && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-amber-200">
              This workspace is owned by someone else, so your bot turns resolve to {botStatus.effectiveMode.replace(/_/g, " ")}. Contact the owner or switch to your own workspace.
            </div>
          )}
        </div>
      )}

      <div className="space-y-4">
        <Select
          label="Workspace mode"
          value={workspaceMode}
          onChange={(event) => {
            setWorkspaceDraft(event.target.value);
            setSaved(false);
          }}
        >
          {PERMISSION_MODE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label} — {option.description}
            </option>
          ))}
        </Select>

        <div>
          <div className="mb-1.5 text-xs font-semibold text-[var(--muted)]">Active agents</div>
          <div className="divide-y divide-[var(--border)] rounded-xl border border-[var(--border)]">
            {state.agents.map((agent) => {
              const agentMode = agentDrafts[agent.id] ?? agent.mode ?? "";
              return (
                <div key={agent.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-bold">{agent.name}</div>
                    <div className="text-[10px] text-[var(--muted)]">
                      Effective: {agent.effective.replace("_", " ")}
                      {agent.mode ? " (override)" : " (inherits workspace)"}
                    </div>
                  </div>
                  <select
                    value={agentMode}
                    onChange={(event) => {
                      setAgentDrafts({ ...agentDrafts, [agent.id]: event.target.value });
                      setSaved(false);
                    }}
                    className="h-8 shrink-0 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-[11px] font-semibold text-[var(--text)] focus:border-accent focus:outline-none"
                  >
                    <option value="">Inherit workspace ({workspaceMode.replace("_", " ")})</option>
                    {PERMISSION_MODE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
            {state.agents.length === 0 && (
              <div className="px-3 py-2.5 text-xs text-[var(--muted)]">No active agents yet.</div>
            )}
          </div>
        </div>

        {error && <p className="text-xs text-rose-600">{error}</p>}
        {saved && !error && (
          <p className="flex items-center gap-1.5 text-xs text-emerald-600">
            <CheckCircle2 size={13} />
            Saved — effective modes updated.
          </p>
        )}

        <Button onClick={() => void save()} disabled={saving}>
          <Save size={14} />
          {saving ? "Saving…" : "Save permissions"}
        </Button>
      </div>
    </section>
  );
}

// ============================================================================
// SERVICES MANAGEMENT COMPONENT
// ============================================================================
function ServicesTab({ user }: { user: any }) {
  const toast = useToast();
  const [services, setServices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const loadServices = useCallback(async () => {
    try {
      const res = await fetch("/api/company/services");
      const data = await res.json();
      setServices(data.services || []);
    } catch {
      toast("Failed to load service capabilities", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadServices();
  }, [loadServices]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const deliverablesRaw = form.get("typicalDeliverables") as string;
    const deliverables = deliverablesRaw ? deliverablesRaw.split("\n").map(s => s.trim()).filter(Boolean) : [];

    const payload = {
      name: form.get("name"),
      category: form.get("category"),
      description: form.get("description"),
      requiredExpertise: form.get("requiredExpertise"),
      deliveryReadiness: form.get("deliveryReadiness"),
      pricingModel: form.get("pricingModel"),
      startingPrice: Number(form.get("startingPrice")) || 0,
      expectedDuration: form.get("expectedDuration"),
      typicalDeliverables: deliverables,
      isActive: form.get("isActive") === "on",
    };

    try {
      const url = editingService ? `/api/company/services/${editingService.id}` : "/api/company/services";
      const method = editingService ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save service");
      toast(editingService ? "Service capability updated" : "Service capability added");
      setModalOpen(false);
      setEditingService(null);
      void loadServices();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete service "${name}"?`)) return;
    try {
      const res = await fetch(`/api/company/services/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete service");
      toast("Service deleted");
      void loadServices();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  if (loading) return <div className="text-xs text-[var(--muted)]">Loading service capabilities...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/20 p-4 text-xs text-amber-800 dark:text-amber-200">
        <p className="font-bold">Operational Pricing Notice:</p>
        <p className="mt-0.5">
          Starting prices and rate models displayed here are internal baseline guidelines. All client-facing proposals must be confirmed by the Workspace Owner before issuance.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-display font-bold">Service Capabilities & Delivery Readiness</h2>
          <p className="text-xs text-[var(--muted)]">Core IT consulting and cloud services offered by Cyraops.</p>
        </div>
        {user?.role === "OWNER" && (
          <Button onClick={() => { setEditingService(null); setModalOpen(true); }}>
            <Plus size={14} /> Add Service
          </Button>
        )}
      </div>

      <div className="grid gap-4">
        {services.map((svc) => {
          let deliverables: string[] = [];
          try {
            deliverables = typeof svc.typicalDeliverables === "string" ? JSON.parse(svc.typicalDeliverables) : (svc.typicalDeliverables || []);
          } catch {
            deliverables = [];
          }

          return (
            <div key={svc.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-neutral-900 dark:text-neutral-100">{svc.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                      {svc.category}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      svc.deliveryReadiness === "PRODUCTION_READY"
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                        : "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                    }`}>
                      {svc.deliveryReadiness.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">{svc.description}</p>
                </div>

                {user?.role === "OWNER" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => { setEditingService(svc); setModalOpen(true); }}
                      className="p-1.5 text-[var(--muted)] hover:text-accent rounded-lg hover:bg-[var(--hover)] transition"
                      title="Edit service"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(svc.id, svc.name)}
                      className="p-1.5 text-[var(--muted)] hover:text-red-600 rounded-lg hover:bg-[var(--hover)] transition"
                      title="Delete service"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-2 border-t border-[var(--border)] text-xs">
                <div>
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Starting Rate</span>
                  <div className="font-bold text-accent">₹{svc.startingPrice?.toLocaleString()} ({svc.pricingModel?.replace("_", " ")})</div>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Typical Duration</span>
                  <div className="font-semibold">{svc.expectedDuration || "Variable"}</div>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold">Required Expertise</span>
                  <div className="text-[var(--muted)] truncate">{svc.requiredExpertise || "DevOps / Cloud"}</div>
                </div>
              </div>

              {deliverables.length > 0 && (
                <div className="pt-2">
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold block mb-1">Standard Deliverables:</span>
                  <ul className="list-disc list-inside text-xs space-y-0.5 text-neutral-700 dark:text-neutral-300">
                    {deliverables.slice(0, 4).map((d: string, idx: number) => (
                      <li key={idx}>{d}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal: Add/Edit Service */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingService(null); }}
        title={editingService ? "Edit Service Capability" : "Add Service Capability"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Service Name *" name="name" required defaultValue={editingService?.name ?? ""} placeholder="e.g. AWS Cloud Architecture & Migration" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category *" name="category" required defaultValue={editingService?.category ?? "Cloud & Infrastructure"} />
            <Select label="Delivery Readiness" name="deliveryReadiness" defaultValue={editingService?.deliveryReadiness ?? "NOT_READY"}>
              <option value="PRODUCTION_READY">Production Ready</option>
              <option value="CONDITIONAL_PARTNER">Conditional / Partner</option>
              <option value="CAPACITY_CONSTRAINED">Capacity Constrained</option>
              <option value="NOT_READY">Not Ready</option>
            </Select>
          </div>
          <Textarea label="Service Description" name="description" rows={2} defaultValue={editingService?.description ?? ""} placeholder="What this service delivers to clients..." />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Starting Price (₹) *" name="startingPrice" type="number" min="0" required defaultValue={editingService?.startingPrice ?? 25000} />
            <Select label="Pricing Model" name="pricingModel" defaultValue={editingService?.pricingModel ?? "FIXED_PRICE"}>
              <option value="FIXED_PRICE">Fixed Price</option>
              <option value="HOURLY">Hourly Rate</option>
              <option value="RETAINER">Monthly Retainer</option>
              <option value="MILESTONE">Milestone-based</option>
            </Select>
            <Field label="Expected Duration" name="expectedDuration" defaultValue={editingService?.expectedDuration ?? "1 - 3 weeks"} placeholder="e.g. 2 - 4 weeks" />
          </div>
          <Field label="Required Expertise / Certifications" name="requiredExpertise" defaultValue={editingService?.requiredExpertise ?? ""} placeholder="e.g. AWS Solutions Architect, Terraform" />
          <Textarea
            label="Typical Deliverables (one per line)"
            name="typicalDeliverables"
            rows={3}
            defaultValue={(() => {
              try {
                const arr = typeof editingService?.typicalDeliverables === "string" ? JSON.parse(editingService.typicalDeliverables) : editingService?.typicalDeliverables;
                return Array.isArray(arr) ? arr.join("\n") : "";
              } catch {
                return "";
              }
            })()}
            placeholder="Architecture diagram&#10;Terraform infrastructure code&#10;Automated backups"
          />
          <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer">
            <input type="checkbox" name="isActive" defaultChecked={editingService?.isActive ?? true} />
            Active service available for client proposals
          </label>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => { setModalOpen(false); setEditingService(null); }}>
              Cancel
            </Button>
            <Button disabled={saving}>
              {saving ? "Saving..." : "Save Service"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ============================================================================
// PORTFOLIO MANAGEMENT COMPONENT
// ============================================================================
function PortfolioTab({ user }: { user: any }) {
  const toast = useToast();
  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);

  const loadPortfolio = useCallback(async () => {
    try {
      const res = await fetch("/api/company/portfolio");
      const data = await res.json();
      setItems(data.items || []);
    } catch {
      toast("Failed to load portfolio items", "error");
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void loadPortfolio();
  }, [loadPortfolio]);

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    const form = new FormData(e.currentTarget);
    const techRaw = form.get("technologies") as string;
    const technologies = techRaw ? techRaw.split(",").map(s => s.trim()).filter(Boolean) : [];

    const isRealClient = form.get("isRealClient") === "on";
    const isPublic = form.get("isPublic") === "on";

    if (isPublic && !isRealClient) {
      toast("Unverified sample templates cannot be marked as public case studies. Keeping unpublished.", "error");
      setSaving(false);
      return;
    }

    const payload = {
      title: form.get("title"),
      category: form.get("category"),
      clientName: form.get("clientName") || null,
      description: form.get("description"),
      problem: form.get("problem"),
      solution: form.get("solution"),
      workDone: form.get("workDone"),
      outcome: form.get("outcome"),
      metrics: form.get("metrics") || null,
      technologies,
      isRealClient,
      isPublic,
    };

    try {
      const url = editingItem ? `/api/company/portfolio/${editingItem.id}` : "/api/company/portfolio";
      const method = editingItem ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to save case study");
      toast(editingItem ? "Portfolio case study updated" : "Portfolio case study added");
      setModalOpen(false);
      setEditingItem(null);
      void loadPortfolio();
    } catch (err: any) {
      toast(err.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string, title: string) => {
    if (!confirm(`Delete case study "${title}"?`)) return;
    try {
      const res = await fetch(`/api/company/portfolio/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete item");
      toast("Case study deleted");
      void loadPortfolio();
    } catch (err: any) {
      toast(err.message, "error");
    }
  };

  if (loading) return <div className="text-xs text-[var(--muted)]">Loading portfolio items...</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 dark:border-blue-900/50 dark:bg-blue-950/20 p-4 text-xs text-blue-900 dark:text-blue-200">
        <p className="font-bold">Portfolio Truthfulness & Verification Standard:</p>
        <p className="mt-0.5">
          Cyraops strictly enforces factual data integrity. Only verified client engagements with authorized sign-off may be marked as "Real Client" and "Public". Internal demonstration case studies remain private baseline templates.
        </p>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-display font-bold">Portfolio & Case Studies</h2>
          <p className="text-xs text-[var(--muted)]">Track record of technical deliverables and architectures.</p>
        </div>
        {user?.role === "OWNER" && (
          <Button onClick={() => { setEditingItem(null); setModalOpen(true); }}>
            <Plus size={14} /> Add Case Study
          </Button>
        )}
      </div>

      <div className="grid gap-4">
        {items.map((item) => {
          let tech: string[] = [];
          try {
            tech = typeof item.technologies === "string" ? JSON.parse(item.technologies) : (item.technologies || []);
          } catch {
            tech = [];
          }

          return (
            <div key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-sm text-neutral-900 dark:text-neutral-100">{item.title}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                      {item.category}
                    </span>
                    {item.isRealClient ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40">
                        Verified Client: {item.clientName || "Confidential"}
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/40">
                        Internal Sample (Unverified)
                      </span>
                    )}
                    {item.isPublic ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/40">
                        Public
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-400">
                        Unpublished / Internal
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--muted)] mt-1">{item.description}</p>
                </div>

                {user?.role === "OWNER" && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => { setEditingItem(item); setModalOpen(true); }}
                      className="p-1.5 text-[var(--muted)] hover:text-accent rounded-lg hover:bg-[var(--hover)] transition"
                      title="Edit case study"
                    >
                      <Edit size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id, item.title)}
                      className="p-1.5 text-[var(--muted)] hover:text-red-600 rounded-lg hover:bg-[var(--hover)] transition"
                      title="Delete case study"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </div>

              {item.metrics && (
                <div className="rounded-lg bg-[var(--hover)] p-2.5 text-xs">
                  <span className="font-bold text-accent">Key Metrics / Impact: </span>
                  <span className="text-neutral-800 dark:text-neutral-200">{item.metrics}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                <div>
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold block">Client Challenge:</span>
                  <p className="text-neutral-700 dark:text-neutral-300 mt-0.5 line-clamp-2">{item.problem}</p>
                </div>
                <div>
                  <span className="text-[10px] text-[var(--muted)] uppercase font-semibold block">Delivered Solution:</span>
                  <p className="text-neutral-700 dark:text-neutral-300 mt-0.5 line-clamp-2">{item.solution}</p>
                </div>
              </div>

              {tech.length > 0 && (
                <div className="flex items-center gap-1.5 flex-wrap pt-1">
                  {tech.map((t: string, idx: number) => (
                    <span key={idx} className="px-2 py-0.5 rounded bg-[var(--surface-2)] text-[10px] font-mono text-[var(--muted)]">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal: Add/Edit Portfolio */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditingItem(null); }}
        title={editingItem ? "Edit Case Study" : "Add Portfolio Case Study"}
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Case Study Title *" name="title" required defaultValue={editingItem?.title ?? ""} placeholder="e.g. High-Availability Multi-AZ AWS Setup" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Category *" name="category" required defaultValue={editingItem?.category ?? "Cloud & Infrastructure"} />
            <Field label="Client Name" name="clientName" defaultValue={editingItem?.clientName ?? ""} placeholder="e.g. Acme Corp (or leave blank if confidential)" />
          </div>

          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3 space-y-2 text-xs">
            <label className="flex items-center gap-2 cursor-pointer font-semibold">
              <input type="checkbox" name="isRealClient" defaultChecked={editingItem?.isRealClient ?? false} />
              Verified real client engagement (uncheck for demonstration/sample templates)
            </label>
            <label className="flex items-center gap-2 cursor-pointer font-semibold">
              <input type="checkbox" name="isPublic" defaultChecked={editingItem?.isPublic ?? false} />
              Publish on public presence (only permitted for verified client work)
            </label>
          </div>

          <Textarea label="Executive Overview *" name="description" rows={2} required defaultValue={editingItem?.description ?? ""} placeholder="Summary of the architecture or engagement..." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Textarea label="Client Problem / Challenge *" name="problem" rows={2} required defaultValue={editingItem?.problem ?? ""} placeholder="Outages, performance bottlenecks, manual deployments..." />
            <Textarea label="Designed Solution *" name="solution" rows={2} required defaultValue={editingItem?.solution ?? ""} placeholder="Terraform, Docker, RDS Multi-AZ failover..." />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Textarea label="Work Completed *" name="workDone" rows={2} required defaultValue={editingItem?.workDone ?? ""} placeholder="Details of engineering execution..." />
            <Textarea label="Business Outcome *" name="outcome" rows={2} required defaultValue={editingItem?.outcome ?? ""} placeholder="Zero downtime achieved, 40% latency reduction..." />
          </div>
          <Field label="Key Metrics" name="metrics" defaultValue={editingItem?.metrics ?? ""} placeholder="e.g. 99.99% Uptime, 3x faster deployments" />
          <Field label="Technologies (comma separated)" name="technologies" defaultValue={(() => {
            try {
              const arr = typeof editingItem?.technologies === "string" ? JSON.parse(editingItem.technologies) : editingItem?.technologies;
              return Array.isArray(arr) ? arr.join(", ") : "";
            } catch { return ""; }
          })()} placeholder="AWS, Terraform, Docker, Nginx" />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" type="button" onClick={() => { setModalOpen(false); setEditingItem(null); }}>
              Cancel
            </Button>
            <Button disabled={saving}>
              {saving ? "Saving..." : "Save Case Study"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
