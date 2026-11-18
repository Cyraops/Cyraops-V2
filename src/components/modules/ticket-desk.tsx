"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  Filter,
  Check,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  CircleDot,
  Clock,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { Button, Field, Modal, Select, Textarea, useToast } from "@/components/ui";

/**
 * The ticket desk.
 *
 * Tasks are worked as tickets here, in the shape a service desk expects: a
 * queue with the columns people scan (subject, contact, status, priority, owner,
 * created), and a detail pane with the properties, the conversation and the
 * resolution kept apart. The description is what the requester said; the
 * resolution is what we did about it — merging them loses that distinction.
 */

type Ticket = {
  id: string;
  number: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  kind?: string | null;
  source?: string | null;
  type?: string | null;
  groupName?: string | null;
  category?: string | null;
  requesterName?: string | null;
  requesterEmail?: string | null;
  resolution?: string;
  closedAt?: string | null;
  archivedAt?: string | null;
  dueDate?: string | null;
  createdAt: string;
  updatedAt?: string;
  project?: { id: string; name: string } | null;
  creator?: { id: string; name: string } | null;
  assignees?: Array<{ kind: string; id: string; name: string }>;
};

type Comment = { id: string; body: string; createdAt: string; author?: { name: string } | null };

const PAGE_SIZE = 20;

const STATUSES = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"] as const;
const STATUS_LABEL: Record<string, string> = {
  BACKLOG: "Backlog",
  TODO: "New",
  IN_PROGRESS: "In progress",
  IN_REVIEW: "In review",
  DONE: "Closed",
};
const statusTone = (status: string) =>
  status === "DONE"
    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
    : status === "IN_PROGRESS"
      ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
      : status === "IN_REVIEW"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "bg-[var(--hover)] text-[var(--muted)]";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "URGENT"] as const;
const priorityDot = (priority: string) =>
  priority === "URGENT" ? "bg-rose-500" : priority === "HIGH" ? "bg-amber-500" : priority === "MEDIUM" ? "bg-sky-500" : "bg-emerald-500";

const SOURCES = ["EMAIL", "PHONE", "CHAT", "WEB", "PORTAL", "API"] as const;
const TYPES = ["SERVICE_REQUEST", "INCIDENT", "PROBLEM", "CHANGE"] as const;
const humanise = (value?: string | null) =>
  value ? value.replaceAll("_", " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : "—";

const ticketRef = (n: number) => `#SR-${n}`;
const formatDate = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";


/** Width breakpoints for the two layouts. Inline styles are used rather than
 *  classes because a cached stylesheet silently kept the queue stacked. */
function useNarrow(query = "(max-width: 900px)") {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [query]);
  return narrow;
}

export function TicketDesk() {
  const toast = useToast();
  const narrow = useNarrow();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [openCount, setOpenCount] = useState(0);
  const [view, setView] = useState<"active" | "archived">("active");
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const ticketRequestRef = useRef(0);
  /**
   * Filters are kept as one object so "Clear" is a single reset and the count of
   * active filters is derivable, rather than six booleans to keep in sync.
   */
  const [filters, setFilters] = useState<{
    status: "open" | "all" | "closed" | string;
    priority: string;
    source: string;
    type: string;
    group: string;
    assignee: string;
  }>({ status: "open", priority: "", source: "", type: "", group: "", assignee: "" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"details" | "activity" | "resolution">("details");
  const [comments, setComments] = useState<Comment[]>([]);
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState<string>("");
  const [savingAssignee, setSavingAssignee] = useState<string>("");
  const [resolution, setResolution] = useState("");
  const [adding, setAdding] = useState(false);
  const [team, setTeam] = useState<Array<{ id: string; name: string; email?: string | null }>>([]);
  const [approvals, setApprovals] = useState<number>(0);
  const [projects, setProjects] = useState<Array<{ id: string; name: string }>>([]);
  const [me, setMe] = useState<{ role?: string } | null>(null);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [draftDescription, setDraftDescription] = useState("");

  /** Debounce the search box so a keystroke is not a request. */
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  /** Any filter, search or view change returns to the first page. */
  useEffect(() => {
    setPage(1);
  }, [filters, debouncedQuery, view]);

  const loadBase = useCallback(async () => {
    const [people, pending, projects, meRes] = await Promise.all([
      fetch("/api/team").then((r) => (r.ok ? r.json() : { members: [] })).catch(() => ({ members: [] })),
      fetch("/api/ai/approvals").then((r) => (r.ok ? r.json() : { approvals: [] })).catch(() => ({ approvals: [] })),
      fetch("/api/projects").then((r) => (r.ok ? r.json() : { projects: [] })).catch(() => ({ projects: [] })),
      fetch("/api/auth/me").then((r) => (r.ok ? r.json() : { user: null })).catch(() => ({ user: null })),
    ]);
    setTeam(people.members ?? []);
    setProjects(projects.projects ?? []);
    setApprovals((pending.approvals ?? []).length);
    setMe(meRes.user ?? null);
  }, []);

  useEffect(() => {
    void loadBase();
  }, [loadBase]);

  /** The queue is paged and filtered server-side now; the desk just renders the page it is given. */
  const loadTickets = useCallback(async () => {
    const requestId = ++ticketRequestRef.current;
    setTicketsLoading(true);
    try {
      const params = new URLSearchParams();
      params.set("page", String(page));
      params.set("pageSize", String(PAGE_SIZE));
      if (view === "archived") params.set("archived", "1");
      // The pills only exist in the active view; an archived page never inherits
      // the "open" default as a filter.
      const status = view === "archived" && ["open", "all", "closed"].includes(filters.status) ? "" : filters.status;
      if (status) params.set("status", status);
      if (filters.priority) params.set("priority", filters.priority);
      if (filters.source) params.set("source", filters.source);
      if (filters.type) params.set("type", filters.type);
      if (filters.group) params.set("group", filters.group);
      if (filters.assignee) params.set("assignee", filters.assignee);
      if (debouncedQuery.trim()) params.set("q", debouncedQuery.trim());
      const res = await fetch(`/api/tickets?${params.toString()}`);
      const data = res.ok ? await res.json() : { tickets: [], total: 0, open: 0, groups: [] };
      if (requestId !== ticketRequestRef.current) return;
      setTickets(data.tickets ?? []);
      setTotal(data.total ?? 0);
      setOpenCount(data.open ?? 0);
      setGroupOptions(data.groups ?? []);
    } finally {
      if (requestId === ticketRequestRef.current) setTicketsLoading(false);
    }
  }, [view, page, filters, debouncedQuery]);

  useEffect(() => {
    void loadTickets();
  }, [loadTickets]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  /** A row change (archive/restore) can empty the page we are on; step back. */
  useEffect(() => {
    if (!ticketsLoading && page > totalPages) setPage(totalPages);
  }, [ticketsLoading, page, totalPages]);

  const selected = tickets.find((t) => t.id === selectedId) ?? null;

  useEffect(() => {
    setEditing(false);
    setDraftTitle(selected?.title ?? "");
    setDraftDescription(selected?.description ?? "");
  }, [selected?.id, selected?.title, selected?.description]);

  useEffect(() => {
    setResolution(selected?.resolution ?? "");
    setComment("");
    if (!selected) return;
    fetch(`/api/tickets/${selected.id}/comments`)
      .then((r) => (r.ok ? r.json() : { comments: [] }))
      .then((d) => setComments(d.comments ?? []))
      .catch(() => setComments([]));
  }, [selected?.id, selected?.resolution]);

  /** Groups come from the server (the current view's whole scope), so the
   *  filter never offers a dead option now that the list is paged. */
  /** Display labels that disambiguate when two people share a name. */
  const teamLabels = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of team) counts.set(m.name, (counts.get(m.name) ?? 0) + 1);
    return new Map(
      team.map((m) => [
        m.id,
        (counts.get(m.name) ?? 0) > 1 && m.email ? `${m.name} · ${m.email}` : m.name,
      ])
    );
  }, [team]);

  const activeFilters = Object.entries(filters).filter(([key, value]) => value !== "" && !(key === "status" && value === "open")).length;

  /** Archiving stays project-scoped on /api/tasks/:id — the desk mirrors that
   *  gate: owner/admin always, otherwise a member of the ticket's project. */
  const isOwnerOrAdmin = me?.role === "OWNER" || me?.role === "ADMIN";
  const canArchive = (ticket: Ticket) =>
    isOwnerOrAdmin || Boolean(ticket.project && projects.some((p) => p.id === ticket.project!.id));

  const patch = async (id: string, body: Record<string, unknown>, field: string) => {
    setSaving(field);
    try {
      const res = await fetch(`/api/tickets/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save");
      setTickets((prev) => prev.map((t) => (t.id === id ? { ...t, ...(data.task ?? {}) } : t)));
      return true;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save", "error");
      return false;
    } finally {
      setSaving("");
    }
  };

  const createTicket = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const f = new FormData(form);
    const subject = String(f.get("subject") ?? "").trim();
    if (!subject) {
      toast("Give the ticket a subject", "error");
      return;
    }
    const projectId = String(f.get("projectId") ?? "");
    if (!projectId) {
      toast("Choose a project for the ticket", "error");
      return;
    }
    setAdding(true);
    try {
      const assigneeId = String(f.get("assigneeId") ?? "");
      const response = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: subject,
          description: String(f.get("description") ?? ""),
          projectId,
          priority: f.get("priority") || undefined,
          status: f.get("status") || undefined,
          source: f.get("source") || undefined,
          type: f.get("type") || undefined,
          groupName: f.get("groupName") || null,
          category: f.get("category") || null,
          requesterName: f.get("requesterName") || null,
          requesterEmail: f.get("requesterEmail") || null,
          assigneeIds: assigneeId ? [assigneeId] : [],
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not create the ticket");
      setCreateOpen(false);
      form.reset();
      setView("active");
      await loadTickets();
      if (data.task?.id) setSelectedId(data.task.id);
      toast(`Ticket ${data.task?.number ? `#SR-${data.task.number}` : ""} created`.trim());
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not create the ticket", "error");
    } finally {
      setAdding(false);
    }
  };

  const addComment = async () => {
    if (!selected || !comment.trim()) return;
    setSaving("comment");
    try {
      const res = await fetch(`/api/tickets/${selected.id}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: comment.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not add the note");
      setComments((prev) => [...prev, data.comment]);
      setComment("");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not add the note", "error");
    } finally {
      setSaving("");
    }
  };

  /** Assign from the queue: one request, one row updated, no page reload. */
  const assignTicket = async (ticketId: string, userId: string) => {
    setSavingAssignee(ticketId);
    try {
      const response = await fetch(`/api/tickets/${ticketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigneeIds: userId ? [userId] : [] }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not change the assignee");
      const next = (data.task?.assignees ?? []).map((a: { kind: string; id: string; name: string }) => a);
      setTickets((prev) =>
        prev.map((t) =>
          t.id === ticketId
            ? { ...t, assignees: next.length ? next : userId ? [{ kind: "user", id: userId, name: team.find((m) => m.id === userId)?.name ?? "Assigned" }] : [] }
            : t
        )
      );
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not change the assignee", "error");
    } finally {
      setSavingAssignee("");
    }
  };

  /** Edit the subject and description in place, then return to reading mode. */
  const saveEdit = async () => {
    if (!selected) return;
    const title = draftTitle.trim();
    if (!title) {
      toast("A ticket needs a subject", "error");
      return;
    }
    setSaving("edit");
    try {
      const res = await fetch(`/api/tickets/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: draftDescription }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not save the ticket");
      setTickets((prev) => prev.map((t) => (t.id === selected.id ? { ...t, title, description: draftDescription } : t)));
      setEditing(false);
      toast("Ticket updated");
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save the ticket", "error");
    } finally {
      setSaving("");
    }
  };

  const closeTicket = async () => {
    if (!selected) return;
    const ok = await patch(selected.id, { status: "DONE", resolution }, "close");
    if (ok) toast("Ticket closed");
  };

  /** Archiving is project-scoped, so it goes through /api/tasks/:id exactly as
   *  the project view does — the desk mirrors that permission path. */
  const archiveTicket = async (id: string) => {
    setSaving("archive");
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not archive the ticket");
      setSelectedId((current) => (current === id ? null : current));
      toast("Ticket archived");
      await loadTickets();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not archive the ticket", "error");
    } finally {
      setSaving("");
    }
  };

  /** Restore clears archivedAt. The permission path mirrors archiving: the same
   *  project-scoped route and gate, so only owner/admin or a member of the
   *  ticket's project can bring it back. */
  const restoreTicket = async (id: string) => {
    setSaving("restore");
    try {
      const res = await fetch(`/api/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ archive: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not restore the ticket");
      toast("Ticket restored");
      await loadTickets();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not restore the ticket", "error");
    } finally {
      setSaving("");
    }
  };

  const propRow = (label: string, control: React.ReactNode, hint?: string) => (
    <label className="block">
      <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">{label}</span>
      {control}
      {hint && <span className="mt-0.5 block text-[10px] text-[var(--muted)]">{hint}</span>}
    </label>
  );
  const selectCls =
    "h-8 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-caption outline-none focus:border-accent";
  /** A row-level control: looks like text until you hover it. */
  const rowSelectCls =
    "h-7 w-full cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent px-1 text-caption outline-none transition hover:border-[var(--border)] hover:bg-[var(--surface-2)] focus:border-accent";
  const inputCls = selectCls;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 p-4 sm:p-6">
      {/* ---------------- A ticket is open: the ticket owns the screen ---------------- */}
      {selected ? (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setSelectedId(null)}
              className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            >
              <ArrowLeft size={13} /> All tickets
            </button>
            <span className="font-mono text-caption text-[var(--muted)]">{ticketRef(selected.number)}</span>
            <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusTone(selected.status)}`}>
              {STATUS_LABEL[selected.status] ?? selected.status}
            </span>
            {canArchive(selected) && (
              <button
                onClick={() => void archiveTicket(selected.id)}
                disabled={saving === "archive"}
                className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2.5 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-50"
              >
                <Archive size={13} /> Archive
              </button>
            )}
            {saving && <Loader2 size={13} className="animate-spin text-[var(--muted)]" />}
          </div>

          <div
            className="ticket-layout flex-1"
            style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr)" : "minmax(0,1fr) 320px", gap: 16, alignItems: "start" }}
          >
            {/* The conversation */}
            <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              <header className="border-b border-[var(--border)] px-5 py-4">
                {editing ? (
                <div className="flex items-start gap-2">
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    aria-label="Ticket subject"
                    maxLength={180}
                    autoFocus
                    className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-base font-bold outline-none focus:border-accent"
                  />
                  <Button onClick={() => void saveEdit()} disabled={saving === "edit"} className="h-9 shrink-0">
                    {saving === "edit" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
                  </Button>
                  <Button
                    variant="secondary"
                    className="h-9 shrink-0"
                    onClick={() => {
                      setEditing(false);
                      setDraftTitle(selected.title);
                      setDraftDescription(selected.description);
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <h1 className="min-w-0 text-lg font-bold leading-snug">{selected.title}</h1>
                  <button
                    onClick={() => setEditing(true)}
                    aria-label="Edit ticket"
                    className="mt-0.5 flex h-7 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-2 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  >
                    <Pencil size={12} /> Edit
                  </button>
                </div>
              )}
                <p className="mt-1 text-caption text-[var(--muted)]">
                  <span className="font-semibold text-[var(--text)]">{selected.requesterName || selected.creator?.name || "Unknown"}</span>
                  {" reported "}
                  {formatDate(selected.createdAt)}
                  {selected.source ? ` via ${humanise(selected.source)}` : ""}
                  {selected.requesterEmail ? ` · ${selected.requesterEmail}` : ""}
                </p>
              </header>

              <nav className="flex gap-1 border-b border-[var(--border)] px-3" role="tablist">
                {(["details", "activity", "resolution"] as const).map((value) => (
                  <button
                    key={value}
                    role="tab"
                    aria-selected={tab === value}
                    onClick={() => setTab(value)}
                    className={`border-b-2 px-3 py-2.5 text-caption font-semibold capitalize transition ${
                      tab === value ? "border-accent text-accent" : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                    }`}
                  >
                    {value}
                  </button>
                ))}
              </nav>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                {tab === "details" && (
                  <section>
                    <h2 className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Description</h2>
                    {editing ? (
                      <textarea
                        value={draftDescription}
                        onChange={(event) => setDraftDescription(event.target.value)}
                        rows={10}
                        aria-label="Ticket description"
                        placeholder="What the requester reported…"
                        className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-meta leading-relaxed outline-none focus:border-accent"
                      />
                    ) : (
                      <p className="whitespace-pre-wrap text-meta leading-relaxed">{selected.description || "No description."}</p>
                    )}
                    {selected.project && (
                      <p className="mt-4 flex items-center gap-1 text-[10px] text-[var(--muted)]">
                        <ChevronRight size={10} /> Project: {selected.project.name}
                      </p>
                    )}
                  </section>
                )}

                {tab === "activity" && (
                  <div className="space-y-3">
                    {comments.length === 0 && (
                      <p className="text-caption text-[var(--muted)]">No notes yet. Anything you add here is kept with the ticket.</p>
                    )}
                    {comments.map((c) => (
                      <div key={c.id} className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-[10px] font-semibold text-[var(--muted)]">
                          {c.author?.name ?? "Someone"} · {formatDate(c.createdAt)}
                        </p>
                        <p className="mt-1 whitespace-pre-wrap text-meta">{c.body}</p>
                      </div>
                    ))}
                    <div className="flex gap-2">
                      <input
                        value={comment}
                        onChange={(e) => setComment(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && void addComment()}
                        placeholder="Add an internal note…"
                        aria-label="Add an internal note"
                        className="h-9 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2.5 text-meta outline-none focus:border-accent"
                      />
                      <Button onClick={() => void addComment()} disabled={saving === "comment" || !comment.trim()}>
                        <MessageSquare size={12} /> Note
                      </Button>
                    </div>
                  </div>
                )}

                {tab === "resolution" && (
                  <div className="space-y-3">
                    <p className="text-caption text-[var(--muted)]">
                      What we actually did. Kept separate from the description, which is what the requester said.
                    </p>
                    <textarea
                      value={resolution}
                      onChange={(e) => setResolution(e.target.value)}
                      rows={8}
                      placeholder="Root cause, the fix, and anything the requester should know…"
                      aria-label="Resolution"
                      className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-3 text-meta outline-none focus:border-accent"
                    />
                    <div className="flex flex-wrap items-center gap-2">
                      <Button onClick={() => void patch(selected.id, { resolution }, "resolution")} disabled={saving === "resolution"}>
                        <Check size={12} /> Save resolution
                      </Button>
                      {selected.status !== "DONE" ? (
                        <Button variant="secondary" onClick={() => void closeTicket()} disabled={saving === "close"}>
                          <AlertTriangle size={12} /> Resolve &amp; close
                        </Button>
                      ) : (
                        <Button variant="secondary" onClick={() => void patch(selected.id, { status: "IN_PROGRESS" }, "reopen")} disabled={saving === "reopen"}>
                          Reopen ticket
                        </Button>
                      )}
                      {selected.closedAt && <span className="text-[10px] text-[var(--muted)]">Closed {formatDate(selected.closedAt)}</span>}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Properties, on the right edge like a service desk */}
            <aside
              className="ticket-props"
              style={{
                border: "1px solid var(--border)",
                borderRadius: 12,
                background: "var(--surface)",
                overflow: "hidden",
                ...(narrow ? {} : { position: "sticky", top: 16, maxHeight: "calc(100vh - 8rem)" }),
              }}
            >
              <h2 className="border-b border-[var(--border)] px-4 py-3 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                Properties
              </h2>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
                {propRow("Priority", (
                  <select value={selected.priority} disabled={saving === "priority"} onChange={(e) => void patch(selected.id, { priority: e.target.value }, "priority")} className={selectCls}>
                    {PRIORITIES.map((x) => <option key={x} value={x}>{humanise(x)}</option>)}
                  </select>
                ))}
                {propRow("Status", (
                  <select value={selected.status} disabled={saving === "status"} onChange={(e) => void patch(selected.id, { status: e.target.value }, "status")} className={selectCls}>
                    {["BACKLOG", ...STATUSES].map((x) => <option key={x} value={x}>{STATUS_LABEL[x] ?? x}</option>)}
                  </select>
                ))}
                {propRow("Source", (
                  <select value={selected.source ?? ""} disabled={saving === "source"} onChange={(e) => void patch(selected.id, { source: e.target.value || null }, "source")} className={selectCls}>
                    <option value="">—</option>
                    {SOURCES.map((x) => <option key={x} value={x}>{humanise(x)}</option>)}
                  </select>
                ))}
                {propRow("Type", (
                  <select value={selected.type ?? ""} disabled={saving === "type"} onChange={(e) => void patch(selected.id, { type: e.target.value || null }, "type")} className={selectCls}>
                    <option value="">—</option>
                    {TYPES.map((x) => <option key={x} value={x}>{humanise(x)}</option>)}
                  </select>
                ))}
                {propRow("Group", (
                  <input defaultValue={selected.groupName ?? ""} placeholder="e.g. ANZ_Wintel" onBlur={(e) => e.target.value !== (selected.groupName ?? "") && void patch(selected.id, { groupName: e.target.value || null }, "group")} className={inputCls} />
                ))}
                {propRow("Category", (
                  <input defaultValue={selected.category ?? ""} placeholder="e.g. Cloud alarm" onBlur={(e) => e.target.value !== (selected.category ?? "") && void patch(selected.id, { category: e.target.value || null }, "category")} className={inputCls} />
                ))}
                {propRow("Agent", (
                  <select
                    value={selected.assignees?.find((a) => a.kind === "user")?.id ?? ""}
                    disabled={saving === "assignee"}
                    onChange={(e) => void patch(selected.id, { assigneeIds: e.target.value ? [e.target.value] : [] }, "assignee")}
                    className={selectCls}
                  >
                    <option value="">Unassigned</option>
                    {team.map((m) => <option key={m.id} value={m.id}>{teamLabels.get(m.id) ?? m.name}</option>)}
                  </select>
                ))}
                {propRow("Kind", (
                  <span className="flex h-8 items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 text-caption">
                    <CircleDot size={11} className="text-[var(--muted)]" />
                    {selected.kind ? selected.kind.toLowerCase() : "unclassified"}
                  </span>
                ))}
              </div>
            </aside>
          </div>
        </div>
      ) : (
        <>
          {/* ---------------- The queue ---------------- */}
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="font-display text-xl font-extrabold tracking-tight">Tickets</h1>
              <p className="text-caption text-[var(--muted)]">
                {view === "archived"
                  ? `${total} archived · tickets set aside — restore brings one back to the queue`
                  : `${openCount} open · ${total} total · every task is a ticket, with a number, a requester and a resolution`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2.5">
                <Search size={13} className="text-[var(--muted)]" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={view === "archived" ? "Search archived…" : "Search tickets…"}
                  aria-label="Search tickets"
                  className="w-44 bg-transparent text-meta outline-none placeholder:text-[var(--muted)]"
                />
              </label>
              {view === "active" && (
                <div className="flex h-9 items-center rounded-lg border border-[var(--border)] p-0.5">
                  {(["open", "all", "closed"] as const).map((value) => (
                    <button
                      key={value}
                      onClick={() => setFilters((f) => ({ ...f, status: value }))}
                      aria-pressed={filters.status === value}
                      className={`h-8 rounded-md px-2.5 text-caption font-semibold capitalize transition ${
                        filters.status === value ? "bg-accent/10 text-accent" : "text-[var(--muted)] hover:bg-[var(--hover)]"
                      }`}
                    >
                      {value}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex h-9 items-center rounded-lg border border-[var(--border)] p-0.5">
                {(["active", "archived"] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setView(value)}
                    aria-pressed={view === value}
                    className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-caption font-semibold capitalize transition ${
                      view === value ? "bg-accent/10 text-accent" : "text-[var(--muted)] hover:bg-[var(--hover)]"
                    }`}
                  >
                    {value === "archived" && <Archive size={12} />}
                    {value}
                  </button>
                ))}
              </div>
            </div>
          </header>

          <div className="flex items-center justify-between gap-3">
            <p className="text-caption text-[var(--muted)]">
              A ticket has a number, a requester and a resolution — create it here, or in chat with <span className="font-semibold">@tasks</span>.
            </p>
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={13} /> New ticket
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            <div style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr) 96px 32px" : "minmax(0,1fr) 130px 130px 100px 80px 140px 140px 32px", gap: 12, alignItems: "center" }}
              className="ticket-grid-head relative border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
              <span>Subject</span>
              {!narrow && <span>Project</span>}
              {!narrow && <span>Contact</span>}
              <span>Status</span>
              {!narrow && <span>Priority</span>}
              {!narrow && <span>Assignee</span>}
              {!narrow && <span>Created</span>}
              <span className="flex justify-end">
                <button
                  onClick={() => setFiltersOpen((open) => !open)}
                  aria-label="Filter tickets"
                  aria-expanded={filtersOpen}
                  title={activeFilters ? `${activeFilters} filter${activeFilters === 1 ? "" : "s"} active` : "Filter tickets"}
                  className={`relative flex h-6 w-6 items-center justify-center rounded-md border transition ${
                    activeFilters
                      ? "border-accent/40 bg-accent/10 text-accent"
                      : "border-transparent text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                  }`}
                >
                  <Filter size={13} />
                  {activeFilters > 0 && (
                    <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                      {activeFilters}
                    </span>
                  )}
                </button>
              </span>

              {filtersOpen && (
                <>
                  <button className="fixed inset-0 z-20 cursor-default" aria-label="Close filters" onClick={() => setFiltersOpen(false)} />
                  <div className="absolute right-2 top-full z-30 mt-1 w-[min(560px,calc(100vw-40px))] rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left shadow-xl">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">Filter tickets</span>
                      <span className="text-[10px] font-semibold normal-case text-[var(--muted)]">{total} shown</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {([
                        ["status", "Status", ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"].map((v) => [v, STATUS_LABEL[v] ?? v])],
                        ["priority", "Priority", PRIORITIES.map((v) => [v, humanise(v)])],
                        ["source", "Source", SOURCES.map((v) => [v, humanise(v)])],
                        ["type", "Type", TYPES.map((v) => [v, humanise(v)])],
                        ["group", "Group", groupOptions.map((v) => [v, v])],
                        ["assignee", "Agent", [["unassigned", "Unassigned"], ...team.map((m) => [m.id, teamLabels.get(m.id) ?? m.name] as [string, string])]],
                      ] as Array<[keyof typeof filters, string, Array<[string, string]>]>).map(([key, label, options]) => (
                        <label key={key} className="block">
                          <span className="mb-1 block text-[10px] font-semibold text-[var(--muted)]">{label}</span>
                          <select
                            aria-label={`Filter by ${label}`}
                            value={["open", "all", "closed"].includes(filters[key]) ? "" : filters[key]}
                            onChange={(event) => setFilters((f) => ({ ...f, [key]: event.target.value }))}
                            className={`h-8 w-full rounded-lg border px-2 text-caption normal-case tracking-normal outline-none focus:border-accent ${
                              filters[key] && !["open", "all", "closed"].includes(filters[key])
                                ? "border-accent/40 bg-accent/5 font-semibold text-accent"
                                : "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)]"
                            }`}
                          >
                            <option value="">All {label.toLowerCase()}</option>
                            {options.length === 0 && <option value="" disabled>none yet</option>}
                            {options.map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                          </select>
                        </label>
                      ))}
                    </div>
                    <div className="mt-2 flex items-center justify-end gap-2">
                      <button
                        onClick={() => setFilters({ status: "open", priority: "", source: "", type: "", group: "", assignee: "" })}
                        disabled={activeFilters === 0}
                        className="h-7 rounded-lg px-2 text-[11px] font-semibold text-accent disabled:opacity-40"
                      >
                        Clear all
                      </button>
                      <Button variant="secondary" className="h-7 px-2 text-[11px]" onClick={() => setFiltersOpen(false)}>Done</Button>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
              {ticketsLoading ? (
                <p className="px-3 py-8 text-center text-meta text-[var(--muted)]"><Loader2 size={14} className="mx-auto animate-spin" /></p>
              ) : view === "archived" && tickets.length === 0 ? (
                <p className="px-3 py-10 text-center text-meta text-[var(--muted)]">
                  No archived tickets.
                </p>
              ) : tickets.length === 0 && (activeFilters > 0 || query.trim()) ? (
                <p className="px-3 py-10 text-center text-meta text-[var(--muted)]">
                  No tickets match these filters.
                </p>
              ) : tickets.length === 0 ? (
                <p className="px-3 py-10 text-center text-meta text-[var(--muted)]">
                  No tickets here yet. Add one above, or ask the bot in chat with <span className="font-semibold">@tasks</span>.
                </p>
              ) : (
                tickets.map((t) => {
                  const owners = t.assignees ?? [];
                  const contact = t.requesterName || t.creator?.name || "Unknown";
                  if (view === "archived") {
                    const owner = owners.find((o) => o.kind === "user");
                    return (
                      <div
                        key={t.id}
                        style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr) 96px 32px" : "minmax(0,1fr) 130px 130px 100px 80px 140px 140px 32px", gap: 12, alignItems: "center" }}
                        className="ticket-grid w-full border-b border-[var(--border)] px-3 py-2.5 text-left"
                      >
                        <span className="min-w-0">
                          <span className="block truncate text-meta font-semibold text-[var(--muted)]">{t.title}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                            <span className="font-mono">{ticketRef(t.number)}</span>
                            {t.type && <span>· {humanise(t.type)}</span>}
                            {t.groupName && <span>· {t.groupName}</span>}
                            {t.archivedAt && <span>· Archived {formatDate(t.archivedAt)}</span>}
                          </span>
                        </span>
                        {!narrow && <span className="truncate text-caption text-[var(--muted)]">{t.project?.name ?? "—"}</span>}
                        {!narrow && (
                          <span className="flex min-w-0 items-center gap-1.5">
                            <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[9px] font-bold uppercase text-[var(--muted)]">
                              {contact.slice(0, 1)}
                            </span>
                            <span className="truncate text-caption text-[var(--muted)]">{contact}</span>
                          </span>
                        )}
                        <span className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${statusTone(t.status)}`}>
                          {STATUS_LABEL[t.status] ?? t.status}
                        </span>
                        {!narrow && (
                          <span className="flex items-center gap-1 text-caption capitalize text-[var(--muted)]">
                            <span className={`h-2 w-2 shrink-0 rounded-sm ${priorityDot(t.priority)}`} /> {humanise(t.priority)}
                          </span>
                        )}
                        {!narrow && <span className="truncate text-caption text-[var(--muted)]">{owner ? owner.name : "Unassigned"}</span>}
                        {!narrow && (
                          <span className="flex items-center gap-1.5 text-caption text-[var(--muted)]">
                            <Clock size={10} /> {formatDate(t.createdAt)}
                          </span>
                        )}
                        {canArchive(t) ? (
                          <button
                            onClick={() => void restoreTicket(t.id)}
                            disabled={saving === "restore"}
                            aria-label={`Restore ${t.title}`}
                            title="Restore this ticket to the queue"
                            className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40"
                          >
                            <RotateCcw size={13} />
                          </button>
                        ) : (
                          <span aria-hidden />
                        )}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={t.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => { setSelectedId(t.id); setTab("details"); }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setSelectedId(t.id);
                          setTab("details");
                        }
                      }}
                      style={{ display: "grid", gridTemplateColumns: narrow ? "minmax(0,1fr) 96px 32px" : "minmax(0,1fr) 130px 130px 100px 80px 140px 140px 32px", gap: 12, alignItems: "center" }}
                      className="ticket-grid w-full cursor-pointer border-b border-[var(--border)] px-3 py-2.5 text-left transition hover:bg-[var(--hover)]"
                    >
                      <span className="min-w-0">
                        <span className={`block truncate text-meta font-semibold ${t.status === "DONE" ? "text-[var(--muted)]" : ""}`}>{t.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                          <span className="font-mono">{ticketRef(t.number)}</span>
                          {t.type && <span>· {humanise(t.type)}</span>}
                          {t.groupName && <span>· {t.groupName}</span>}
                        </span>
                      </span>
                      {!narrow && (
                        <span className="relative flex min-w-0 items-center">
                          <select
                            value={t.project?.id ?? ""}
                            onChange={(event) => void patch(t.id, { projectId: event.target.value }, "project")}
                            aria-label={`Project for ${t.title}`}
                            title="Move this ticket to another project"
                            className={rowSelectCls}
                          >
                            {!t.project && <option value="">No project</option>}
                            {projects.map((project) => (
                              <option key={project.id} value={project.id}>{project.name}</option>
                            ))}
                          </select>
                          <ChevronDown size={11} className="pointer-events-none absolute right-0.5 text-[var(--muted)]" />
                        </span>
                      )}
                      {!narrow && (
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--surface-2)] text-[9px] font-bold uppercase text-[var(--muted)]">
                            {contact.slice(0, 1)}
                          </span>
                          <span className="truncate text-caption text-[var(--muted)]">{contact}</span>
                        </span>
                      )}
                      <span className="relative flex items-center">
                        <select
                          value={t.status}
                          onChange={(event) => void patch(t.id, { status: event.target.value }, "status")}
                          aria-label={`Status for ${t.title}`}
                          title="Change the status"
                          className={rowSelectCls}
                        >
                          {["BACKLOG", ...STATUSES].map((status) => (
                            <option key={status} value={status}>{STATUS_LABEL[status] ?? status}</option>
                          ))}
                        </select>
                        <ChevronDown size={11} className="pointer-events-none absolute right-0.5 text-[var(--muted)]" />
                      </span>
                      {!narrow && (
                        <span className="relative flex items-center gap-1">
                          <span className={`h-2 w-2 shrink-0 rounded-sm ${priorityDot(t.priority)}`} />
                          <select
                            value={t.priority}
                            onChange={(event) => void patch(t.id, { priority: event.target.value }, "priority")}
                            aria-label={`Priority for ${t.title}`}
                            title="Change the priority"
                            className={`${rowSelectCls} capitalize`}
                          >
                            {PRIORITIES.map((priority) => (
                              <option key={priority} value={priority}>{humanise(priority)}</option>
                            ))}
                          </select>
                          <ChevronDown size={11} className="pointer-events-none absolute right-0.5 text-[var(--muted)]" />
                        </span>
                      )}
                      {!narrow && (
                        <span className="relative flex min-w-0 items-center">
                          <select
                            value={owners.find((o) => o.kind === "user")?.id ?? ""}
                            disabled={savingAssignee === t.id}
                            onClick={(event) => event.stopPropagation()}
                            onKeyDown={(event) => event.stopPropagation()}
                            onChange={(event) => void assignTicket(t.id, event.target.value)}
                            aria-label={`Assignee for ${t.title}`}
                            title="Change the assignee"
                            className={`h-7 w-full cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent pl-1 pr-5 text-caption outline-none transition hover:border-[var(--border)] hover:bg-[var(--surface-2)] focus:border-accent ${
                              owners.length ? "text-[var(--text)]" : "text-[var(--muted)]"
                            }`}
                          >
                            <option value="">Unassigned</option>
                            {team.map((member) => (
                              <option key={member.id} value={member.id}>{teamLabels.get(member.id) ?? member.name}</option>
                            ))}
                          </select>
                          <ChevronDown size={11} className="pointer-events-none absolute right-1 text-[var(--muted)]" />
                        </span>
                      )}
                      {!narrow && (
                        <span className="flex items-center gap-1.5 text-caption text-[var(--muted)]">
                          <Clock size={10} /> {formatDate(t.createdAt)}
                        </span>
                      )}
                      {canArchive(t) ? (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            void archiveTicket(t.id);
                          }}
                          disabled={saving === "archive"}
                          aria-label={`Archive ${t.title}`}
                          title="Archive this ticket"
                          className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)] disabled:opacity-40"
                        >
                          <Archive size={13} />
                        </button>
                      ) : (
                        <span aria-hidden />
                      )}
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border)] px-3 py-2">
              <span className="text-caption text-[var(--muted)]">
                {total === 0
                  ? "0 tickets"
                  : `Page ${page} of ${totalPages} · ${total} ticket${total === 1 ? "" : "s"}`}
              </span>
              <div className="flex items-center gap-1.5">
                <Button variant="secondary" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="h-7 px-2 text-caption">
                  <ChevronLeft size={13} /> Prev
                </Button>
                <Button variant="secondary" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="h-7 px-2 text-caption">
                  Next <ChevronRight size={13} />
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New ticket" size="max-w-2xl">
        <form onSubmit={createTicket} className="space-y-3">
          <Field label="Subject" name="subject" required autoFocus maxLength={180} placeholder="What is this about?" />
          <Textarea label="Description" name="description" rows={3} maxLength={10000} placeholder="What the requester reported…" />

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Project" name="projectId" required defaultValue={projects[0]?.id ?? ""}>
              {projects.length === 0 && <option value="">No projects yet</option>}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </Select>
            <Select label="Agent" name="assigneeId" defaultValue="">
              <option value="">Unassigned</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>{member.name}</option>
              ))}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Requester name" name="requesterName" maxLength={120} placeholder="e.g. cis-alarm" />
            <Field label="Requester email" name="requesterEmail" type="email" maxLength={200} placeholder="requester@company.com" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Source" name="source" defaultValue="PORTAL">
              {SOURCES.map((source) => <option key={source} value={source}>{humanise(source)}</option>)}
            </Select>
            <Select label="Type" name="type" defaultValue="SERVICE_REQUEST">
              {TYPES.map((type) => <option key={type} value={type}>{humanise(type)}</option>)}
            </Select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Group" name="groupName" maxLength={80} placeholder="e.g. ANZ_Wintel" />
            <Field label="Category" name="category" maxLength={80} placeholder="e.g. Cloud alarm" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Priority" name="priority" defaultValue="MEDIUM">
              {PRIORITIES.map((priority) => <option key={priority} value={priority}>{humanise(priority)}</option>)}
            </Select>
            <Select label="Status" name="status" defaultValue="TODO">
              {["BACKLOG", ...STATUSES].map((status) => <option key={status} value={status}>{STATUS_LABEL[status] ?? status}</option>)}
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={adding}>
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create ticket
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
