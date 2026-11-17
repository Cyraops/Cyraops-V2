"use client";
import { useEffect, useState } from "react";
import { AlertCircle, Check, CheckCircle2, Clock, Copy, KeyRound, ShieldCheck, UserPlus, Users, UserX } from "lucide-react";
import { Avatar, Button, EmptyState, Field, Modal, SectionTitle, Select, useToast } from "@/components/ui";

type Profile = {
  id: string;
  name: string;
  email?: string | null;
  role: "OWNER" | "ADMIN" | "MEMBER";
  avatarUrl?: string | null;
  title?: string | null;
  createdAt: string;
  disabledAt?: string | null;
  hasPassword?: boolean;
  invitationStatus?: "PASSWORD_SET" | "INVITATION_PENDING" | "INVITATION_EXPIRED" | "NOT_INVITED";
  invitationExpiresAt?: string | null;
};

export function TeamModule() {
  const [team, setTeam] = useState<Profile[]>([]);
  const [user, setUser] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [inviteData, setInviteData] = useState<{ name: string; email: string; setupUrl: string; isRegenerate?: boolean; emailSent?: boolean; emailReason?: string } | null>(null);
  const [generatingInviteFor, setGeneratingInviteFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const load = async () => {
    const [teamResponse, meResponse] = await Promise.all([fetch("/api/team"), fetch("/api/auth/me")]);
    const [teamData, meData] = await Promise.all([teamResponse.json(), meResponse.json()]);
    setTeam(teamData.members ?? []);
    setUser(meData.user ?? null);
    setLoading(false);
  };
  useEffect(() => { void load(); }, []);

  const createProfile = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") || "").trim();
    const email = String(form.get("email") || "").trim();
    const role = String(form.get("role") || "MEMBER");

    const response = await fetch("/api/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, role }),
    });
    const data = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok) return toast(data.error ?? "Could not create team member", "error");
    setCreateOpen(false);
    toast("Team member added");

    if (data.setupUrl) {
      const fullUrl = data.setupUrl.startsWith("http://") || data.setupUrl.startsWith("https://")
        ? data.setupUrl
        : `${window.location.origin}${data.setupUrl}`;
      setInviteData({
        name,
        email,
        setupUrl: fullUrl,
        isRegenerate: false,
        emailSent: Boolean(data.emailSent),
        emailReason: data.emailReason,
      });
      setInviteModalOpen(true);
    } else if (data.emailSent) {
      toast(`Invitation emailed to ${email}`);
    }

    await load();
  };

  const generateInvite = async (member: Profile) => {
    setGeneratingInviteFor(member.id);
    const response = await fetch(`/api/team/${member.id}/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    setGeneratingInviteFor(null);
    if (!response.ok) return toast(data.error ?? "Could not generate setup link", "error");

    const fullUrl = data.setupUrl.startsWith("http://") || data.setupUrl.startsWith("https://")
      ? data.setupUrl
      : `${window.location.origin}${data.setupUrl}`;
    setInviteData({
      name: member.name,
      email: member.email ?? "",
      setupUrl: fullUrl,
      isRegenerate: member.invitationStatus !== "NOT_INVITED",
      emailSent: Boolean(data.emailSent),
      emailReason: data.emailReason,
    });
    setInviteModalOpen(true);
    toast(data.emailSent ? "Setup link generated and emailed" : "Setup link generated");
    await load();
  };

  const copyInviteLink = async () => {
    if (!inviteData?.setupUrl) return;
    await navigator.clipboard.writeText(inviteData.setupUrl);
    setCopied(true);
    toast("Setup link copied to clipboard");
    setTimeout(() => setCopied(false), 2500);
  };

  const updateProfile = async (id: string, body: { role?: string; disabled?: boolean }) => {
    const response = await fetch(`/api/team/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return toast(data.error ?? "Could not update profile", "error");
    toast(body.disabled ? "Account deactivated" : "Role updated");
    await load();
  };

  if (loading) return <div className="animate-pulse space-y-3">{[1, 2, 3].map((item) => <div key={item} className="h-20 rounded-xl bg-[var(--hover)]" />)}</div>;
  const canManage = user?.role === "OWNER" || user?.role === "ADMIN";

  const renderStatusBadge = (status?: Profile["invitationStatus"]) => {
    switch (status) {
      case "PASSWORD_SET":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300">
            <CheckCircle2 size={11} className="text-emerald-500" />
            Password set
          </span>
        );
      case "INVITATION_PENDING":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
            <Clock size={11} className="text-amber-500" />
            Invite pending
          </span>
        );
      case "INVITATION_EXPIRED":
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-medium text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
            <AlertCircle size={11} className="text-rose-500" />
            Invite expired
          </span>
        );
      case "NOT_INVITED":
      default:
        return (
          <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-400">
            Not invited
          </span>
        );
    }
  };

  return <div>
    <SectionTitle eyebrow="People" title="Team" subtitle="Manage workspace team members, individual accounts, and role permissions." action={canManage && <Button onClick={() => setCreateOpen(true)}><UserPlus size={15} />Add team member</Button>} />
    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><Users size={15} />Team members</div>
        <div className="mt-2 font-display text-2xl font-extrabold">{team.length}</div>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><ShieldCheck size={15} />Password configured</div>
        <div className="mt-2 font-display text-2xl font-extrabold text-emerald-600">
          {team.filter((m) => m.invitationStatus === "PASSWORD_SET").length}
        </div>
      </div>
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="flex items-center gap-2 text-xs text-[var(--muted)]"><KeyRound size={15} />Pending / Not invited</div>
        <div className="mt-2 font-display text-2xl font-extrabold text-amber-600">
          {team.filter((m) => m.invitationStatus !== "PASSWORD_SET").length}
        </div>
      </div>
    </div>
    <section className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-5 py-4"><h2 className="font-display font-bold">Workspace members</h2><p className="mt-1 text-xs text-[var(--muted)]">Each employee signs in with their individual corporate email and password.</p></div>
      {team.length ? <div className="divide-y divide-[var(--border)]">{team.map((member) => {
        const canManageTarget = (user?.role === "OWNER" && member.role !== "OWNER") || (user?.role === "ADMIN" && member.role === "MEMBER");
        return (
          <div key={member.id} className="flex flex-wrap items-center gap-3 px-5 py-3.5">
            <Avatar name={member.name} src={member.avatarUrl} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <b className="truncate text-xs">{member.name}</b>
                {user?.id === member.id ? <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">You</span> : null}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-[var(--muted)]">{member.email || "No email assigned"}</div>
            </div>
            {renderStatusBadge(member.invitationStatus)}
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${member.role === "OWNER" ? "bg-violet-50 text-violet-700 dark:bg-violet-950/40" : member.role === "ADMIN" ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40" : "bg-[var(--hover)] text-[var(--muted)]"}`}>{member.role}</span>
            {canManage && member.role !== "OWNER" && <div className="flex items-center gap-1.5">
              {canManageTarget && member.invitationStatus !== "PASSWORD_SET" && (
                <Button
                  type="button"
                  variant="secondary"
                  className="h-8 px-2.5 text-[11px]"
                  disabled={generatingInviteFor === member.id}
                  onClick={() => void generateInvite(member)}
                  title={member.invitationStatus === "NOT_INVITED" ? "Generate setup link" : "Regenerate setup link"}
                >
                  <KeyRound size={13} className="mr-1" />
                  {generatingInviteFor === member.id ? "Generating…" : member.invitationStatus === "NOT_INVITED" ? "Generate Link" : "Regenerate Link"}
                </Button>
              )}
              {canManageTarget && (
                <Select aria-label={`Role for ${member.name}`} className="h-8 w-[105px] text-[10px]" value={member.role} onChange={(event) => void updateProfile(member.id, { role: event.target.value })} disabled={user?.role === "ADMIN" && member.role !== "MEMBER"}>
                  <option value="MEMBER">Member</option>{user?.role === "OWNER" && <option value="ADMIN">Admin</option>}
                </Select>
              )}
              {canManageTarget && (
                <button title="Deactivate account" onClick={() => { if (confirm(`Deactivate ${member.name}'s account? All active sessions will be terminated.`)) void updateProfile(member.id, { disabled: true }); }} className="flex h-8 w-8 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30" aria-label={`Deactivate ${member.name}`}><UserX size={14} /></button>
              )}
            </div>}
          </div>
        );
      })}</div> : <EmptyState icon={<Users size={20} />} title="No team members yet" description="Add a name, email and role for each person who needs workspace access." action={canManage ? <Button onClick={() => setCreateOpen(true)}><UserPlus size={14} />Add team member</Button> : undefined} />}
    </section>

    {/* Add Member Modal */}
    <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add team member">
      <form onSubmit={createProfile} className="space-y-4">
        <Field label="Full name" name="name" required autoFocus maxLength={80} placeholder="e.g. Alex Morgan" />
        <Field label="Corporate email" name="email" type="email" required maxLength={254} placeholder="alex@cyraops.com" />
        {user?.role === "OWNER" ? <Select label="Role" name="role" defaultValue="MEMBER"><option value="MEMBER">Member</option><option value="ADMIN">Admin</option></Select> : <input type="hidden" name="role" value="MEMBER" />}
        <p className="text-xs leading-5 text-[var(--muted)]">A secure single-use setup link will be generated for the employee to choose their password.</p>
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={saving}>{saving ? "Adding…" : "Add member"}</Button></div>
      </form>
    </Modal>

    {/* Setup Link Generated Modal */}
    <Modal open={inviteModalOpen} onClose={() => setInviteModalOpen(false)} title={inviteData?.isRegenerate ? "Setup Link Regenerated" : "Account Setup Link"}>
      <div className="space-y-4">
        {inviteData?.emailSent ? (
          <p className="text-xs text-[var(--muted)]">
            We emailed a setup link to <strong>{inviteData?.email}</strong>. They can also use the link below.
            It expires in 48 hours and can only be used once.
          </p>
        ) : (
          <>
            <p className="text-xs text-[var(--muted)]">Share this secure setup link with <strong>{inviteData?.name}</strong> ({inviteData?.email}) to set their password. This link expires in 48 hours and can only be used once.</p>
            {inviteData?.emailReason && (
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[11px] text-amber-700 dark:text-amber-400">
                The invitation email was not sent: {inviteData.emailReason}. Share the link below manually.
              </p>
            )}
          </>
        )}
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-2">
          <input readOnly value={inviteData?.setupUrl ?? ""} className="flex-1 bg-transparent text-xs text-[var(--text)] outline-none" />
          <Button type="button" variant="secondary" onClick={copyInviteLink} className="h-8 px-3 text-xs">
            {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <div className="flex justify-end">
          <Button onClick={() => setInviteModalOpen(false)}>Done</Button>
        </div>
      </div>
    </Modal>
  </div>;
}
