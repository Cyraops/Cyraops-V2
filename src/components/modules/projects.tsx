"use client";
import { useCallback, useEffect, useState } from "react";
import { FileViewer } from "@/components/modules/file-viewer";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock3,
  FileText,
  FolderKanban,
  Layers,
  MessageCircle,
  Plus,
  Settings2,
  Trash2,
  Users,
  Wallet,
  ShieldCheck,
} from "lucide-react";
import {
  Avatar,
  Button,
  EmptyState,
  Field,
  formatDate,
  Modal,
  SectionTitle,
  Select,
  Textarea,
  useToast,
} from "@/components/ui";

const KIND_TONE: Record<string, string> = {
  BUG: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  SERVICE: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  CATEGORY: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
};

/** What kind of work this is: bug, service item, or category. Null stays invisible. */
export function TaskKindBadge({ kind, className = "" }: { kind?: string | null; className?: string }) {
  if (!kind) return null;
  return (
    <span
      className={`mt-1 inline-block rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
        KIND_TONE[kind] ?? "bg-[var(--hover)] text-[var(--muted)]"
      } ${className}`}
    >
      {kind.toLowerCase()}
    </span>
  );
}

const statuses = ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED", "ARCHIVED"];
const tabs = [
  { id: "overview", label: "Overview", icon: FolderKanban },
  { id: "milestones", label: "Milestones", icon: Layers },
  { id: "tasks", label: "Tickets", icon: CheckCircle2 },
  { id: "billing", label: "Client Invoices", icon: Wallet },
  { id: "files", label: "Files", icon: FileText },
  { id: "discussion", label: "Discussion", icon: MessageCircle },
  { id: "closeout", label: "Delivery & Closeout", icon: ShieldCheck },
  { id: "activity", label: "Activity", icon: Clock3 },
  { id: "members", label: "Members", icon: Users },
];

/**
 * One line for however many owners a task has. A task can belong to several
 * people and to an agent, so "assignee.name" is no longer the whole story.
 */
function ownerLabel(task: any): string {
  const owners: Array<{ name: string; kind: string }> = task.assignees ?? [];
  if (owners.length === 0) return task.assignee?.name ?? "Unassigned";
  const names = owners.map((owner) =>
    owner.kind === "agent" ? `${owner.name} (AI)` : owner.name.split(" ")[0]
  );
  if (names.length <= 2) return names.join(" + ");
  return `${names.slice(0, 2).join(" + ")} +${names.length - 2}`;
}

export function ProjectsModule() {
  const router = useRouter();
  const toast = useToast();
  const [projects, setProjects] = useState<any[]>([]);
  const [team, setTeam] = useState<any[]>([]);
  const [user, setUser] = useState<any>();
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState("");
  const [tab, setTab] = useState("overview");
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = projects.find((project) => project.id === selectedId);

  const load = useCallback(async () => {
    setLoading(true);
    const [p, t, me, a] = await Promise.all([
      fetch("/api/projects").then((r) => r.json()),
      fetch("/api/team").then((r) => r.json()),
      fetch("/api/auth/me").then((r) => r.json()),
      // Agents are assignable teammates too, so the picker needs them.
      fetch("/api/ai/agents").then((r) => (r.ok ? r.json() : { agents: [] })).catch(() => ({ agents: [] })),
    ]);
    setProjects(p.projects ?? []);
    setTeam(t.members ?? []);
    setUser(me.user);
    setAgents((a.agents ?? []).filter((agent: any) => agent.status === "ACTIVE"));
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const params = new URLSearchParams(window.location.search);
    const id = params.get("project");
    const requestedTab = params.get("tab");
    if (id) setSelectedId(id);
    if (tabs.some((item) => item.id === requestedTab)) setTab(requestedTab!);
    if (params.get("create") === "1") {
      setCreateOpen(true);
      router.replace("/projects", { scroll: false });
    }
  }, [load, router]);

  const filtered = projects.filter((project) =>
    project.name.toLowerCase().includes(search.toLowerCase())
  );
  // Everyone can open a project; a Member always leads the one they open.
  const canCreate = Boolean(user?.id);
  const isAdminLike = user?.role === "OWNER" || user?.role === "ADMIN";
  const canPickLead = isAdminLike;
  // Editing, archiving and member changes follow the API: admins on any
  // project, a Member only on the project they lead.
  const canEditSelected = Boolean(selected && (isAdminLike || selected.ownerId === user?.id));

  const api = async (url: string, method: string, body?: any) => {
    const response = await fetch(url, {
      method,
      ...(body
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        : {}),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error ?? "Something went wrong");
    return result;
  };

  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const memberIds = form.getAll("members").map(String);
    try {
      const result = await api("/api/projects", "POST", {
        name: form.get("name"),
        description: form.get("description"),
        priority: form.get("priority"),
        status: form.get("status"),
        deadline: form.get("deadline")
          ? new Date(String(form.get("deadline"))).toISOString()
          : "",
        ownerId: form.get("ownerId"),
        memberIds,
      });
      setProjects((items) => [result.project, ...items]);
      setSelectedId(result.project.id);
      setTab("overview");
      setCreateOpen(false);
      toast("Project created");
    } catch (error: any) {
      toast(error.message, "error");
    }
  };

  const saveEdit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const memberIds = form.getAll("members").map(String);
    try {
      await api(`/api/projects/${selected.id}`, "PATCH", {
        name: form.get("name"),
        description: form.get("description"),
        priority: form.get("priority"),
        status: form.get("status"),
        deadline: form.get("deadline")
          ? new Date(String(form.get("deadline"))).toISOString()
          : null,
        ownerId: form.get("ownerId"),
        memberIds,
      });
      setEditOpen(false);
      await load();
      toast("Project updated");
    } catch (error: any) {
      toast(error.message, "error");
    }
  };

  const setStatus = async (status: string) => {
    try {
      await api(`/api/projects/${selected.id}`, "PATCH", { status });
      toast("Project status updated");
      await load();
    } catch (error: any) {
      toast(error.message, "error");
    }
  };

  const archive = async () => {
    if (!confirm(`Archive “${selected.name}”?`)) return;
    try {
      await api(`/api/projects/${selected.id}`, "PATCH", { archive: true });
      setSelectedId("");
      await load();
      toast("Project archived");
    } catch (error: any) {
      toast(error.message, "error");
    }
  };

  const remove = async () => {
    if (!confirm(`Delete “${selected.name}” and its tasks? This cannot be undone.`)) return;
    try {
      await api(`/api/projects/${selected.id}`, "DELETE");
      setSelectedId("");
      await load();
      toast("Project deleted");
    } catch (error: any) {
      toast(error.message, "error");
    }
  };

  if (loading)
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-10 w-52 rounded bg-[var(--hover)]" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-52 rounded-2xl bg-[var(--hover)]" />
          ))}
        </div>
      </div>
    );

  if (selected)
    return (
      <div>
        <button
          onClick={() => {
            setSelectedId("");
            router.push("/projects");
          }}
          className="mb-5 inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)]"
        >
          <ArrowLeft size={14} />
          All projects
        </button>
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-accent">
              Project workspace <span className="text-[var(--muted)]">/</span>
              {selected.status.toLowerCase().replaceAll("_", " ")}
            </div>
            <h1 className="font-display text-2xl font-extrabold tracking-[-.035em]">
              {selected.name}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
              {selected.description || "This project is ready for a clear brief and delivery milestones."}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {canEditSelected && (
              <Button variant="secondary" onClick={() => setEditOpen(true)}>
                Edit details
              </Button>
            )}
            {canEditSelected ? (
              <Select
                aria-label="Project status"
                className="w-[150px]"
                value={selected.status}
                onChange={(e) => void setStatus(e.target.value)}
              >
                {statuses
                  .filter((s) => s !== "ARCHIVED")
                  .map((s) => (
                    <option key={s} value={s}>
                      {s.replaceAll("_", " ")}
                    </option>
                  ))}
              </Select>
            ) : (
              <span className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold capitalize text-[var(--muted)]">
                {(selected.status ?? "").replaceAll("_", " ").toLowerCase()}
              </span>
            )}
            {canEditSelected && (
              <Button variant="secondary" onClick={archive}>
                <span className="hidden sm:inline">Archive</span>
                <Settings2 size={15} />
              </Button>
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="mb-5 flex items-center justify-between overflow-x-auto border-b border-[var(--border)]">
          <div className="flex min-w-max gap-1">
            {tabs.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`flex items-center gap-2 border-b-2 px-3 py-3 text-xs font-semibold transition ${
                  tab === id
                    ? "border-accent text-accent"
                    : "border-transparent text-[var(--muted)] hover:text-[var(--text)]"
                }`}
              >
                <Icon size={14} />
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={remove}
            className="mx-1 rounded-lg p-2 text-[var(--muted)] hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
            aria-label="Delete project"
          >
            <Trash2 size={15} />
          </button>
        </div>

        {/* Tab Content */}
        {tab === "overview" && (
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,.7fr)]">
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h2 className="font-display font-bold">Project overview</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--muted)]">
                  {selected.description || "No project description has been added yet."}
                </p>
                <div className="mt-5 grid gap-4 border-t border-[var(--border)] pt-4 sm:grid-cols-2">
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                      Deadline
                    </div>
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <CalendarDays size={14} className="text-accent" />
                      {formatDate(selected.deadline)}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]">
                      Priority
                    </div>
                    <div className="text-sm font-semibold capitalize">
                      {selected.priority?.toLowerCase()}
                    </div>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <h2 className="font-display font-bold">Project tasks</h2>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {selected.tasks.length} tasks · {selected.progress}% complete
                    </p>
                  </div>
                  <Button variant="secondary" onClick={() => setTaskOpen(true)}>
                    <Plus size={14} />
                    Add task
                  </Button>
                </div>
                <TaskRows
                  tasks={selected.tasks}
                  agents={agents}
                  members={(selected.members ?? []).map((m: any) => m.user).filter(Boolean)}
                  onChange={load}
                />
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <h2 className="mb-3 font-display font-bold">Project health</h2>
                <div className="mb-2 flex justify-between text-xs">
                  <span className="text-[var(--muted)]">Completion</span>
                  <b>{selected.progress}%</b>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-[var(--hover)]">
                  <div
                    className="h-full bg-accent"
                    style={{ width: `${selected.progress}%` }}
                  />
                </div>
                <div className="mt-4 flex justify-between text-xs">
                  <span className="text-[var(--muted)]">Open tasks</span>
                  <b>{selected.tasks.filter((task: any) => task.status !== "DONE").length}</b>
                </div>
                <div className="mt-2 flex justify-between text-xs">
                  <span className="text-[var(--muted)]">Completed</span>
                  <b>{selected.tasks.filter((task: any) => task.status === "DONE").length}</b>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="font-display font-bold">People</h2>
                  <button
                    className="text-xs font-semibold text-accent"
                    onClick={() => setTab("members")}
                  >
                    Manage
                  </button>
                </div>
                <div className="space-y-3">
                  {selected.members.map((member: any) => (
                    <div key={member.userId} className="flex items-center gap-2.5">
                      <Avatar
                        name={member.user.name}
                        size="sm"
                        src={member.user.avatarUrl}
                      />
                      <span className="flex-1 truncate text-xs font-semibold">
                        {member.user.name}
                      </span>
                      <span className="text-[10px] capitalize text-[var(--muted)]">
                        {member.userId === selected.ownerId ? "Lead" : "Collaborator"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Milestones Tab */}
        {tab === "milestones" && <ProjectMilestones project={selected} />}

        {/* Tasks Tab */}
        {tab === "tasks" && (
          <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-display font-bold">Project tickets</h2>
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Every task here is a ticket — triage the status and owner without leaving the project.
                </p>
              </div>
              <Button onClick={() => setTaskOpen(true)}>
                <Plus size={14} />
                New ticket
              </Button>
            </div>
            <TaskRows
                  tasks={selected.tasks}
                  agents={agents}
                  members={(selected.members ?? []).map((m: any) => m.user).filter(Boolean)}
                  onChange={load}
                />
          </div>
        )}

        {/* Client Invoices / Billing Tab */}
        {tab === "billing" && <ProjectBilling project={selected} />}

        {/* Files Tab */}
        {tab === "files" && <ProjectFiles project={selected} />}

        {/* Discussion Tab */}
        {tab === "discussion" && <ProjectDiscussion project={selected} />}

        {/* Delivery & Closeout Tab */}
        {tab === "closeout" && (
          <ProjectCloseout project={selected} onStatusChange={() => void load()} />
        )}

        {/* Activity Tab */}
        {tab === "activity" && <ProjectActivity project={selected} />}

        {/* Members Tab */}
        {tab === "members" && (
          <ProjectMembers
            project={selected}
            team={team}
            canEdit={canEditSelected}
            onSave={async (memberIds) => {
              try {
                await api(`/api/projects/${selected.id}`, "PATCH", { memberIds });
                await load();
                toast("Project members updated");
              } catch (error: any) {
                toast(error.message, "error");
              }
            }}
          />
        )}

        <TaskCreate
          open={taskOpen}
          onClose={() => setTaskOpen(false)}
          projectId={selected.id}
          members={team}
          agents={agents}
          onCreated={() => {
            setTaskOpen(false);
            void load();
          }}
        />

        <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit project">
          <form onSubmit={saveEdit} className="space-y-4">
            <Field label="Project name" name="name" required defaultValue={selected.name} maxLength={120} />
            <Textarea label="Description" name="description" rows={3} defaultValue={selected.description} maxLength={5000} />
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Status" name="status" defaultValue={selected.status}>
                {statuses
                  .filter((status) => status !== "ARCHIVED")
                  .map((status) => (
                    <option key={status} value={status}>
                      {status.replaceAll("_", " ")}
                    </option>
                  ))}
              </Select>
              <Select label="Priority" name="priority" defaultValue={selected.priority}>
                {["LOW", "MEDIUM", "HIGH", "URGENT"].map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Deadline"
                name="deadline"
                type="date"
                defaultValue={selected.deadline ? new Date(selected.deadline).toISOString().slice(0, 10) : ""}
              />
              {canPickLead ? (
                <Select label="Project owner" name="ownerId" defaultValue={selected.ownerId}>
                  {team.map((person: any) => (
                    <option value={person.id} key={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              ) : (
                <div className="text-xs">
                  <input type="hidden" name="ownerId" value={selected.ownerId ?? ""} />
                  <div className="font-semibold">Project owner</div>
                  <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--muted)]">
                    {selected.owner?.name ?? "You"} — only an owner or admin can reassign the lead.
                  </div>
                </div>
              )}
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Project members</div>
              <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-[var(--border)] p-2">
                {team.map((person: any) => (
                  <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--hover)]">
                    <input
                      name="members"
                      type="checkbox"
                      value={person.id}
                      defaultChecked={selected.members.some((member: any) => member.userId === person.id)}
                      className="accent-accent"
                    />
                    <span className="flex-1">{person.name}</span>
                    <span className="text-[10px] capitalize text-[var(--muted)]">{person.role.toLowerCase()}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button>Save changes</Button>
            </div>
          </form>
        </Modal>
      </div>
    );

  return (
    <div>
      <SectionTitle
        eyebrow="Work management"
        title="Projects & Delivery"
        subtitle="Manage client delivery projects, milestones, tasks, and client billing."
        action={
          canCreate ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus size={15} />
              New project
            </Button>
          ) : null
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Find a project..."
          className="h-9 w-full max-w-xs rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 text-xs outline-none focus:border-accent"
        />
        <div className="text-xs text-[var(--muted)]">{filtered.length} projects</div>
      </div>
      {filtered.length ? (
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {filtered.map((project: any) => (
            <button
              key={project.id}
              onClick={() => {
                setSelectedId(project.id);
                setTab("overview");
                router.push(`/projects?project=${project.id}`);
              }}
              className="group rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 text-left shadow-[0_2px_10px_rgba(20,22,34,.02)] transition hover:-translate-y-0.5 hover:border-[#d2cef1] hover:shadow-soft"
            >
              <div className="mb-4 flex items-start justify-between">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f0efff] text-accent dark:bg-[#302c4e]">
                  <FolderKanban size={18} />
                </span>
                <span
                  className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${
                    project.status === "ACTIVE"
                      ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                      : project.status === "ON_HOLD"
                      ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                      : project.status === "COMPLETED"
                      ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40"
                      : "bg-[var(--hover)] text-[var(--muted)]"
                  }`}
                >
                  {project.status.replaceAll("_", " ")}
                </span>
              </div>
              <h3 className="font-display text-[15px] font-bold group-hover:text-accent">
                {project.name}
              </h3>
              <p className="mt-1 line-clamp-2 min-h-10 text-xs leading-5 text-[var(--muted)]">
                {project.description || "Add a project brief to make goals and context clear."}
              </p>
              <div className="mt-5 flex items-center justify-between">
                <div className="flex -space-x-2">
                  {project.members.slice(0, 4).map((member: any) => (
                    <span key={member.userId} className="rounded-full border-2 border-[var(--surface)]">
                      <Avatar name={member.user.name} size="sm" src={member.user.avatarUrl} />
                    </span>
                  ))}
                  {project.members.length > 4 && (
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-[var(--surface)] bg-[var(--hover)] text-[9px] font-bold">
                      +{project.members.length - 4}
                    </span>
                  )}
                </div>
                <span className="text-[10px] text-[var(--muted)]">
                  {project.tasks.length} tasks
                </span>
              </div>
              <div className="mt-4 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--hover)]">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${project.progress}%` }} />
                </div>
                <span className="w-8 text-right text-[10px] font-semibold text-[var(--muted)]">
                  {project.progress}%
                </span>
              </div>
              <div className="mt-4 flex justify-between border-t border-[var(--border)] pt-3 text-[10px] text-[var(--muted)]">
                <span>{project.deadline ? `Due ${formatDate(project.deadline)}` : "No deadline"}</span>
                <span className="capitalize">{project.priority?.toLowerCase()} priority</span>
              </div>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FolderKanban size={21} />}
          title="No projects to show"
          description={
            canCreate
              ? "Create a project or convert a won deal to start delivering work."
              : "Projects shared with you will appear here."
          }
          action={
            canCreate ? (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus size={14} />
                Create project
              </Button>
            ) : undefined
          }
        />
      )}

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a project">
        <form onSubmit={create} className="space-y-4">
          <Field label="Project name" name="name" required autoFocus maxLength={120} placeholder="e.g. AWS Migration & Hardening" />
          <Textarea label="Description" name="description" rows={3} maxLength={5000} placeholder="What are the project deliverables and timeline?" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Status" name="status" defaultValue="PLANNING">
              {statuses.slice(0, 4).map((status) => (
                <option key={status} value={status}>
                  {status.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
            <Select label="Priority" name="priority" defaultValue="MEDIUM">
              {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </div>
          <Field label="Deadline" name="deadline" type="date" />
          <div className="grid gap-3 sm:grid-cols-2">
            {canPickLead ? (
              <Select name="ownerId" label="Project lead" defaultValue={user?.id ?? ""}>
                {team.map((person: any) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </Select>
            ) : (
              <div className="text-xs">
                <input name="ownerId" type="hidden" value={user?.id ?? ""} />
                <div className="font-semibold">Project lead</div>
                <div className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[var(--muted)]">
                  You lead this project. An owner or admin can reassign the lead later.
                </div>
              </div>
            )}
            <div className="text-[10px] text-[var(--muted)]">
              The project lead coordinates delivery and milestone sign-off.
            </div>
          </div>
          <div>
            <div className="mb-2 text-xs font-semibold text-[var(--muted)]">Add teammates</div>
            <div className="max-h-32 space-y-1 overflow-auto rounded-lg border border-[var(--border)] p-2">
              {team.map((person: any) => (
                <label key={person.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-[var(--hover)]">
                  <input
                    name="members"
                    type="checkbox"
                    value={person.id}
                    defaultChecked={person.id === user?.id}
                    className="accent-accent"
                  />
                  <span className="flex-1">{person.name}</span>
                  <span className="text-[10px] capitalize text-[var(--muted)]">{person.role.toLowerCase()}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button>Create project</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------------------------
// PROJECT MILESTONES COMPONENT
// ----------------------------------------------------------------------------
function ProjectMilestones({ project }: { project: any }) {
  const toast = useToast();
  const [milestones, setMilestones] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const loadMilestones = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${project.id}/milestones`);
      const data = await res.json();
      setMilestones(data.milestones || []);
    } catch {
      toast("Failed to load milestones", "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, toast]);

  useEffect(() => {
    void loadMilestones();
  }, [loadMilestones]);

  const updateStatus = async (id: string, newStatus: string) => {
    try {
      const res = await fetch(`/api/projects/${project.id}/milestones/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        toast(`Milestone set to ${newStatus}`);
        void loadMilestones();
      }
    } catch {
      toast("Failed to update milestone", "error");
    }
  };

  const handleCreate = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch(`/api/projects/${project.id}/milestones`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.get("title"),
          description: form.get("description"),
          billingAmount: Number(form.get("billingAmount")) || 0,
          dueDate: form.get("dueDate") ? new Date(String(form.get("dueDate"))).toISOString() : "",
          deliverables: form.get("deliverables") || "[]",
        }),
      });
      if (res.ok) {
        toast("Milestone added");
        setCreateOpen(false);
        void loadMilestones();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to create milestone", "error");
      }
    } catch {
      toast("Error creating milestone", "error");
    }
  };

  if (loading) return <div className="text-xs text-[var(--muted)]">Loading milestones…</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-display font-bold">Delivery Milestones</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">
            Phase deliverables, client acceptance gates, and release schedules.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> Add Milestone
        </Button>
      </div>

      {milestones.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-xs text-[var(--muted)]">
          No milestones defined yet. Break down the project into 2-4 key deliverables with deadlines.
        </div>
      ) : (
        <div className="space-y-3">
          {milestones.map((m) => (
            <div
              key={m.id}
              className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 transition hover:border-neutral-300 dark:hover:border-neutral-700"
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        m.status === "COMPLETED"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                          : m.status === "IN_PROGRESS"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                          : "bg-[var(--hover)] text-[var(--muted)]"
                      }`}
                    >
                      {m.status}
                    </span>
                    <h3 className="text-sm font-bold">{m.title}</h3>
                  </div>
                  {m.description && <p className="text-xs text-[var(--muted)] mt-1">{m.description}</p>}
                  <div className="flex flex-wrap gap-4 text-[11px] text-[var(--muted)] pt-2">
                    {m.billingAmount > 0 && (
                      <span>Fee: <b className="text-accent font-bold">₹{m.billingAmount.toLocaleString()}</b></span>
                    )}
                    {m.dueDate && <span>Due: <b>{formatDate(m.dueDate)}</b></span>}
                    {m.completedAt && (
                      <span className="text-emerald-600 dark:text-emerald-400">
                        Completed: {formatDate(m.completedAt)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <select
                    value={m.status}
                    onChange={(e) => void updateStatus(m.id, e.target.value)}
                    className="h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 text-xs font-semibold"
                  >
                    <option value="PENDING">Pending</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="BLOCKED">Blocked</option>
                  </select>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* MODAL: CREATE MILESTONE */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Add Project Milestone">
        <form onSubmit={handleCreate} className="space-y-4">
          <Field label="Milestone Title *" name="title" required placeholder="e.g. Phase 1: AWS VPC & Production RDS" />
          <Textarea label="Deliverable Description" name="description" rows={3} placeholder="Key deliverables included in this phase..." />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Milestone Fee (₹)" name="billingAmount" type="number" min="0" placeholder="25000" />
            <Field label="Target Due Date" name="dueDate" type="date" />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button>Save Milestone</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------------------------
// PROJECT BILLING / CLIENT INVOICES COMPONENT
// ----------------------------------------------------------------------------
function ProjectBilling({ project }: { project: any }) {
  const toast = useToast();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const loadBilling = useCallback(async () => {
    try {
      const res = await fetch(`/api/billing/invoices?projectId=${project.id}`);
      const data = await res.json();
      setInvoices(data.invoices || []);
      setSummary(data.summary || null);
    } catch {
      toast("Failed to load project invoices", "error");
    } finally {
      setLoading(false);
    }
  }, [project.id, toast]);

  useEffect(() => {
    void loadBilling();
  }, [loadBilling]);

  const markInvoicePaid = async (id: string, amount: number) => {
    try {
      const res = await fetch(`/api/billing/invoices/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "PAID", amountPaid: amount }),
      });
      if (res.ok) {
        toast("Invoice recorded as PAID");
        void loadBilling();
      }
    } catch {
      toast("Failed to update invoice payment", "error");
    }
  };

  const handleCreateInvoice = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/billing/invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: project.id,
          title: form.get("title"),
          amount: Number(form.get("amount")),
          currency: "INR",
          dueDate: form.get("dueDate") ? new Date(String(form.get("dueDate"))).toISOString() : "",
          notes: form.get("notes") || null,
        }),
      });
      if (res.ok) {
        toast("Client invoice created");
        setCreateOpen(false);
        void loadBilling();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to create invoice", "error");
      }
    } catch {
      toast("Error creating invoice", "error");
    }
  };

  if (loading) return <div className="text-xs text-[var(--muted)]">Loading billing data…</div>;

  return (
    <div className="space-y-5">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">Total Invoiced</div>
          <div className="text-2xl font-bold font-display mt-1 text-neutral-900 dark:text-neutral-100">
            ₹{(summary?.totalInvoiced || 0).toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Total Collected</div>
          <div className="text-2xl font-bold font-display mt-1 text-emerald-600 dark:text-emerald-400">
            ₹{(summary?.totalPaid || 0).toLocaleString()}
          </div>
        </div>
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400">Balance Outstanding</div>
          <div className="text-2xl font-bold font-display mt-1 text-amber-600 dark:text-amber-400">
            ₹{(summary?.outstandingBalance || 0).toLocaleString()}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-2">
        <div>
          <h2 className="text-base font-display font-bold">Client Invoices (Accounts Receivable)</h2>
          <p className="text-xs text-[var(--muted)]">
            Invoices issued to the client for milestones and deliverables.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus size={14} /> Issue Invoice
        </Button>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--border)] p-8 text-center text-xs text-[var(--muted)]">
          No invoices issued for this project yet. Issue an invoice to record milestone billing or advance deposits.
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted)]">
              <tr>
                <th className="px-4 py-3 font-semibold">Invoice #</th>
                <th className="px-4 py-3 font-semibold">Title</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Due Date</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-[var(--hover)] transition">
                  <td className="px-4 py-3 font-mono font-bold text-accent">{inv.invoiceNumber}</td>
                  <td className="px-4 py-3 font-semibold">{inv.title}</td>
                  <td className="px-4 py-3 font-bold">₹{inv.amount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-[var(--muted)]">{inv.dueDate ? formatDate(inv.dueDate) : "—"}</td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
                        inv.status === "PAID"
                          ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40"
                          : inv.status === "PARTIALLY_PAID"
                          ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40"
                          : "bg-[var(--hover)] text-[var(--muted)]"
                      }`}
                    >
                      {inv.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {inv.status !== "PAID" ? (
                      <Button
                        variant="secondary"
                        className="h-7 px-2.5 text-xs"
                        onClick={() => void markInvoicePaid(inv.id, inv.amount)}
                      >
                        Mark Paid
                      </Button>
                    ) : (
                      <span className="text-emerald-600 text-xs font-semibold">Paid in full</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* MODAL: ISSUE INVOICE */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Issue Client Invoice">
        <form onSubmit={handleCreateInvoice} className="space-y-4">
          <Field label="Invoice Title *" name="title" required placeholder="e.g. Milestone 1: VPC Setup & DB Migration" />
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Amount (₹) *" name="amount" type="number" min="1" required placeholder="25000" />
            <Field label="Payment Due Date" name="dueDate" type="date" />
          </div>
          <Textarea label="Payment Terms & Bank/UPI Details" name="notes" rows={3} placeholder="Bank account details, UPI ID, or payment terms..." />
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button>Issue Invoice</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// ----------------------------------------------------------------------------
// PROJECT DELIVERY & CLOSEOUT CHECKLIST
// ----------------------------------------------------------------------------
function ProjectCloseout({ project, onStatusChange }: { project: any; onStatusChange: () => void }) {
  const toast = useToast();
  const [closing, setClosing] = useState(false);
  const [checks, setChecks] = useState({
    codeDelivered: false,
    credentialsRotated: false,
    clientSignoff: false,
    invoiceSettled: false,
    warrantyActive: false,
  });

  const toggleCheck = (key: keyof typeof checks) => {
    setChecks((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const allChecked = Object.values(checks).every(Boolean);

  const completeProject = async () => {
    setClosing(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "COMPLETED" }),
      });
      if (res.ok) {
        toast("Project officially marked as COMPLETED! Great work!");
        onStatusChange();
      } else {
        const err = await res.json();
        toast(err.error || "Failed to update status", "error");
      }
    } catch {
      toast("Error closing project", "error");
    } finally {
      setClosing(false);
    }
  };

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 max-w-3xl space-y-6">
      <div>
        <h2 className="text-base font-display font-bold">Project Delivery Handover & Closeout</h2>
        <p className="text-xs text-[var(--muted)] mt-1">
          Complete these verification standards before marking the delivery project as completed.
        </p>
      </div>

      <div className="space-y-3">
        {[
          {
            key: "codeDelivered",
            title: "Production Infrastructure / Code Handover",
            desc: "Terraform scripts, Dockerfiles, and repo access delivered to client GitHub/AWS organization.",
          },
          {
            key: "credentialsRotated",
            title: "Security & Credential Rotation",
            desc: "Temporary setup passwords rotated, SSH access confirmed, and root credentials safely transferred.",
          },
          {
            key: "clientSignoff",
            title: "Client Acceptance & Review",
            desc: "Client has verified deliverables in production and provided written sign-off / Upwork review.",
          },
          {
            key: "invoiceSettled",
            title: "Final Payment Reconciliation",
            desc: "All client invoices for this project have been collected and marked as PAID.",
          },
          {
            key: "warrantyActive",
            title: "Post-Launch Monitoring & Support Window",
            desc: "30-day monitoring alerts configured and support contact channel established.",
          },
        ].map((item) => (
          <label
            key={item.key}
            className="flex items-start gap-3 p-3 rounded-xl border border-[var(--border)] hover:bg-[var(--hover)] cursor-pointer transition"
          >
            <input
              type="checkbox"
              checked={checks[item.key as keyof typeof checks]}
              onChange={() => toggleCheck(item.key as keyof typeof checks)}
              className="mt-0.5 accent-accent h-4 w-4 rounded"
            />
            <div className="flex-1 text-xs">
              <b className="block text-neutral-900 dark:text-neutral-100">{item.title}</b>
              <span className="text-[var(--muted)] leading-4 mt-0.5 block">{item.desc}</span>
            </div>
          </label>
        ))}
      </div>

      <div className="pt-2 border-t border-[var(--border)] flex items-center justify-between">
        <span className="text-xs text-[var(--muted)]">
          {Object.values(checks).filter(Boolean).length} of 5 handover gates verified
        </span>
        <Button
          disabled={!allChecked || closing || project.status === "COMPLETED"}
          onClick={completeProject}
          className="bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50"
        >
          {project.status === "COMPLETED" ? "Project Already Completed" : closing ? "Completing…" : "Sign Off & Complete Project"}
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// EXISTING SUBCOMPONENTS (RETAINED)
// ----------------------------------------------------------------------------
function TaskRows({
  tasks,
  members,
  agents,
  onChange,
}: {
  tasks: any[];
  members: any[];
  agents: any[];
  onChange: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState<any>(null);
  const cycle = ["BACKLOG", "TODO", "IN_PROGRESS", "IN_REVIEW", "DONE"];

  const saveOwners = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const r = await fetch(`/api/tasks/${editing.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assigneeIds: f.getAll("assigneeIds").map(String).filter(Boolean),
        agentSlugs: f.getAll("agentSlugs").map(String).filter(Boolean),
      }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return toast(data.error ?? "Could not change the owners", "error");
    toast("Owners updated");
    setEditing(null);
    onChange();
  };
  const update = async (task: any) => {
    const status = cycle[(cycle.indexOf(task.status) + 1) % cycle.length];
    const r = await fetch(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!r.ok) {
      const d = await r.json();
      toast(d.error, "error");
      return;
    }
    onChange();
  };
  const [savingRow, setSavingRow] = useState<string>("");

  /** Inline triage from the project tab: same desk endpoint, same rules. */
  const patch = async (task: any, body: Record<string, unknown>) => {
    setSavingRow(task.id);
    try {
      const response = await fetch(`/api/tickets/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not save");
      onChange();
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not save", "error");
    } finally {
      setSavingRow("");
    }
  };

  const statusLabel: Record<string, string> = {
    BACKLOG: "Backlog",
    TODO: "New",
    IN_PROGRESS: "In progress",
    IN_REVIEW: "In review",
    DONE: "Closed",
  };
  const priorityDot: Record<string, string> = {
    LOW: "bg-emerald-500",
    MEDIUM: "bg-sky-500",
    HIGH: "bg-amber-500",
    URGENT: "bg-rose-500",
  };

  return (
    <>
      {tasks.length ? (
        <div className="overflow-hidden rounded-xl border border-[var(--border)]">
          <div
            className="border-b border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-[10px] font-bold uppercase tracking-widest text-[var(--muted)]"
            style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px 100px 150px 110px", gap: 12, alignItems: "center" }}
          >
            <span>Subject</span>
            <span>Status</span>
            <span>Priority</span>
            <span>Assignee</span>
            <span>Created</span>
          </div>
          <div>
            {tasks.map((task: any) => {
              const owners = (task.assignees ?? []).filter((a: any) => a.kind === "user");
              return (
                <div
                  key={task.id}
                  className="border-b border-[var(--border)] px-3 py-2.5 last:border-0"
                  style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 130px 100px 150px 110px", gap: 12, alignItems: "center" }}
                >
                  <span className="min-w-0">
                    <span className={`block truncate text-meta font-semibold ${task.status === "DONE" ? "text-[var(--muted)] line-through" : ""}`}>
                      {task.title}
                    </span>
                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--muted)]">
                      {typeof task.number === "number" && <span className="font-mono">#SR-{task.number}</span>}
                      {task.type && <span>· {String(task.type).replaceAll("_", " ").toLowerCase()}</span>}
                      {task.kind && <TaskKindBadge kind={task.kind} className="!mt-0" />}
                    </span>
                  </span>

                  <span>
                    <select
                      value={task.status}
                      disabled={savingRow === task.id}
                      onChange={(event) => void patch(task, { status: event.target.value })}
                      aria-label={`Status for ${task.title}`}
                      className="h-7 w-full cursor-pointer rounded-md border border-transparent bg-transparent px-1 text-caption outline-none transition hover:border-[var(--border)] hover:bg-[var(--surface-2)] focus:border-accent"
                    >
                      {cycle.map((status) => (
                        <option key={status} value={status}>{statusLabel[status] ?? status}</option>
                      ))}
                    </select>
                  </span>

                  <span className="flex items-center gap-1.5 text-caption capitalize text-[var(--muted)]">
                    <span className={`h-2 w-2 rounded-sm ${priorityDot[task.priority] ?? "bg-emerald-500"}`} />
                    {String(task.priority ?? "").toLowerCase()}
                  </span>

                  <span className="flex items-center gap-1">
                    <select
                      value={owners[0]?.id ?? ""}
                      disabled={savingRow === task.id}
                      onChange={(event) => void patch(task, { assigneeIds: event.target.value ? [event.target.value] : [] })}
                      aria-label={`Assignee for ${task.title}`}
                      className="h-7 min-w-0 flex-1 cursor-pointer rounded-md border border-transparent bg-transparent px-1 text-caption outline-none transition hover:border-[var(--border)] hover:bg-[var(--surface-2)] focus:border-accent"
                    >
                      <option value="">Unassigned</option>
                      {members.map((m: any) => (
                        <option key={m.id} value={m.id}>{m.name}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setEditing(task)}
                      title="Add an AI teammate or several owners"
                      aria-label={`Change owners of ${task.title}`}
                      className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                    >
                      <Users size={12} />
                    </button>
                  </span>

                  <span className="flex items-center gap-1 text-[10px] text-[var(--muted)]">
                    <Clock3 size={9} /> {formatDate(task.createdAt)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-[var(--border)] py-10 text-center text-xs text-[var(--muted)]">
          No tickets in this project yet. Add the first one, or create it from the Tickets desk.
        </div>
      )}

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title="Who owns this task?">
        <form onSubmit={saveOwners} className="space-y-4">
          <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
            {members.map((m: any) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="assigneeIds"
                  value={m.id}
                  defaultChecked={(editing?.assignees ?? []).some((a: any) => a.kind === "user" && a.id === m.id)}
                />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
            {agents.map((agent: any) => (
              <label key={agent.slug} className="flex cursor-pointer items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  name="agentSlugs"
                  value={agent.slug}
                  defaultChecked={(editing?.assignees ?? []).some((a: any) => a.kind === "agent" && a.id === agent.slug)}
                />
                <span className="truncate">{agent.name}</span>
                <span className="rounded bg-[var(--accent-soft)] px-1 text-[10px] font-semibold text-[var(--accent)]">AI</span>
              </label>
            ))}
          </div>
          <p className="text-[10px] text-[var(--muted)]">
            Everyone ticked is notified. An agent added here starts working immediately for an owner or
            admin; a member&apos;s request waits for approval first.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button>Save owners</Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function TaskCreate({
  open,
  onClose,
  projectId,
  members,
  agents,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  members: any[];
  agents: any[];
  onCreated: () => void;
}) {
  const toast = useToast();
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    const response = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: f.get("title"),
        description: f.get("description"),
        projectId,
        // A task can have several owners, and an agent can be one of them.
        assigneeIds: f.getAll("assigneeIds").map(String).filter(Boolean),
        agentSlugs: f.getAll("agentSlugs").map(String).filter(Boolean),
        priority: f.get("priority"),
        kind: f.get("kind") || undefined,
        dueDate: f.get("dueDate")
          ? new Date(String(f.get("dueDate"))).toISOString()
          : "",
      }),
    });
    const data = await response.json();
    if (!response.ok) return toast(data.error, "error");
    const queued = (data.delegations ?? []).filter((d: any) => d.mode === "pending_approval").length;
    const ran = (data.delegations ?? []).filter((d: any) => d.mode === "dispatched").length;
    toast(
      queued > 0
        ? `Task created. ${queued} agent request${queued > 1 ? "s" : ""} sent to the owner for approval.`
        : ran > 0
          ? `Task created. ${ran === 1 ? "The agent is" : "The agents are"} working on it now.`
          : "Task created"
    );
    onCreated();
  };
  return (
    <Modal open={open} onClose={onClose} title="Add project task">
      <form onSubmit={submit} className="space-y-4">
        <Field name="title" label="Task name" required autoFocus maxLength={180} />
        <Textarea name="description" label="Description" rows={3} />
        {/* A task can have several owners, and an agent can be one of them. */}
        <div>
          <span className="mb-1 block text-xs font-semibold">Who owns this task?</span>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-[var(--line)] p-2">
            {members.length === 0 && agents.length === 0 && (
              <span className="text-[11px] text-[var(--muted)]">No teammates or agents available.</span>
            )}
            {members.map((m: any) => (
              <label key={m.id} className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" name="assigneeIds" value={m.id} />
                <span className="truncate">{m.name}</span>
              </label>
            ))}
            {agents.map((agent: any) => (
              <label key={agent.slug} className="flex cursor-pointer items-center gap-2 text-xs">
                <input type="checkbox" name="agentSlugs" value={agent.slug} />
                <span className="truncate">{agent.name}</span>
                <span className="rounded bg-[var(--accent-soft)] px-1 text-[10px] font-semibold text-[var(--accent)]">
                  AI
                </span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] text-[var(--muted)]">
            Everyone ticked is notified. An agent starts working right away if you are an owner or admin;
            otherwise the owner approves the request first.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select name="kind" label="Type" defaultValue="">
            <option value="">Unclassified</option>
            <option value="BUG">Bug — something broken</option>
            <option value="SERVICE">Service — agreed work</option>
            <option value="CATEGORY">Category — grouping item</option>
          </Select>
          <Select name="priority" label="Priority" defaultValue="MEDIUM">
            {["LOW", "MEDIUM", "HIGH", "URGENT"].map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </Select>
        </div>
        <Field name="dueDate" label="Due date" type="date" />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button>Add task</Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectFiles({ project }: { project: any }) {
  const [files, setFiles] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [viewing, setViewing] = useState<any>(null);
  const toast = useToast();
  const load = useCallback(
    () =>
      fetch(`/api/files?projectId=${project.id}`)
        .then((r) => r.json())
        .then((d) => setFiles(d.files ?? [])),
    [project.id]
  );
  useEffect(() => {
    void load();
  }, [load]);
  const upload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    const body = new FormData();
    body.set("file", file);
    body.set("projectId", project.id);
    const res = await fetch("/api/files/upload", { method: "POST", body });
    const data = await res.json();
    setBusy(false);
    e.target.value = "";
    if (!res.ok) return toast(data.error, "error");
    toast("File uploaded");
    void load();
  };
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold">Project files</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">Files attached to {project.name}</p>
        </div>
        <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-accent px-3 text-xs font-semibold text-white">
          {busy ? "Uploading..." : <><Plus size={14} />Upload</>}
          <input type="file" hidden onChange={upload} />
        </label>
      </div>
      {files.length ? (
        <div className="divide-y divide-[var(--border)]">
          {files.map((file: any) => (
            <div key={file.id} className="flex items-center gap-3 py-3">
              {/* Opens in place: viewing and editing happen here, not in a download. */}
              <button
                onClick={() => setViewing(file)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left hover:text-accent"
                title="Open"
              >
                <FileText size={16} />
                <span className="flex-1 truncate text-xs font-semibold">{file.name}</span>
              </button>
              <span className="text-[10px] text-[var(--muted)]">
                {(file.size / 1024).toFixed(0)} KB
              </span>
              <span className="text-[10px] text-[var(--muted)]">{formatDate(file.createdAt)}</span>
              <a
                href={`/api/files/${file.id}/download`}
                className="text-[10px] font-semibold text-[var(--muted)] hover:text-accent"
                title="Download a copy"
              >
                Download
              </a>
            </div>
          ))}
        </div>
      ) : (
        <div className="py-12 text-center text-xs text-[var(--muted)]">No project files yet.</div>
      )}

      <FileViewer file={viewing} onClose={() => setViewing(null)} onSaved={() => void load()} />
    </div>
  );
}

function ProjectDiscussion({ project }: { project: any }) {
  const [posts, setPosts] = useState<any[]>([]);
  const toast = useToast();
  const load = useCallback(
    () =>
      fetch(`/api/projects/${project.id}/discussion`)
        .then((r) => r.json())
        .then((d) => setPosts(d.posts ?? [])),
    [project.id]
  );
  useEffect(() => {
    void load();
  }, [load]);
  const send = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const body = String(f.get("body"));
    const r = await fetch(`/api/projects/${project.id}/discussion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body }),
    });
    const d = await r.json();
    if (!r.ok) return toast(d.error, "error");
    form.reset();
    setPosts((p) => [d.post, ...p]);
  };
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="font-display font-bold">Project discussion</h2>
      <p className="mb-5 mt-1 text-xs text-[var(--muted)]">
        Keep decisions and updates close to the project.
      </p>
      <form onSubmit={send} className="mb-5 flex gap-2">
        <input
          name="body"
          required
          maxLength={5000}
          placeholder="Share an update or ask a question..."
          className="h-10 flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 text-xs outline-none focus:border-accent"
        />
        <Button>
          <MessageCircle size={14} />
          Post
        </Button>
      </form>
      <div className="space-y-4">
        {posts.map((post: any) => (
          <article key={post.id} className="flex gap-3 border-t border-[var(--border)] pt-4">
            <Avatar name={post.author.name} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <b className="text-xs">{post.author.name}</b>
                <time className="text-[10px] text-[var(--muted)]">
                  {formatDate(post.createdAt, {
                    month: "short",
                    day: "numeric",
                    hour: "numeric",
                    minute: "2-digit",
                  })}
                </time>
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{post.body}</p>
            </div>
          </article>
        ))}
        {!posts.length && (
          <div className="py-8 text-center text-xs text-[var(--muted)]">
            Start the project conversation.
          </div>
        )}
      </div>
    </div>
  );
}

function ProjectActivity({ project }: { project: any }) {
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    fetch(`/api/activity?projectId=${project.id}`)
      .then((r) => r.json())
      .then((d) => setItems(d.activities ?? []));
  }, [project.id]);
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <h2 className="font-display font-bold">Project activity</h2>
      <div className="mt-4 divide-y divide-[var(--border)]">
        {items.map((item: any) => (
          <div key={item.id} className="flex items-start gap-3 py-3">
            <Avatar name={item.user.name} size="sm" />
            <div className="flex-1">
              <p className="text-xs">
                <b>{item.user.name}</b> {item.summary}
              </p>
              <p className="mt-1 text-[10px] text-[var(--muted)]">
                {formatDate(item.createdAt, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
          </div>
        ))}
        {!items.length && (
          <p className="py-8 text-center text-xs text-[var(--muted)]">
            Project changes will appear here.
          </p>
        )}
      </div>
    </div>
  );
}

function ProjectMembers({
  project,
  team,
  canEdit,
  onSave,
}: {
  project: any;
  team: any[];
  canEdit: boolean;
  onSave: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>(
    project.members.map((m: any) => m.userId)
  );
  useEffect(
    () => setSelected(project.members.map((m: any) => m.userId)),
    [project.id, project.members]
  );
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="font-display font-bold">Project members</h2>
          <p className="mt-1 text-xs text-[var(--muted)]">
            People who can see this project and its tasks.
          </p>
        </div>
        {canEdit && (
          <Button onClick={() => onSave(selected)}>
            <Check size={14} />
            Save members
          </Button>
        )}
      </div>
      <div className="divide-y divide-[var(--border)]">
        {team.map((person: any) => (
          <label
            key={person.id}
            className={`flex items-center gap-3 py-3 ${canEdit ? "cursor-pointer" : ""}`}
          >
            <input
              type="checkbox"
              disabled={!canEdit}
              checked={selected.includes(person.id)}
              onChange={() => toggle(person.id)}
              className="accent-accent"
            />
            <Avatar name={person.name} size="sm" src={person.avatarUrl} />
            <span className="flex-1">
              <b className="block text-xs">{person.name}</b>
              <span className="text-[10px] text-[var(--muted)]">Team profile</span>
            </span>
            <span className="text-[10px] capitalize text-[var(--muted)]">
              {person.role.toLowerCase()}
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
