"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Bot, Check, CircleDot, Pause, Play, Plus, RefreshCw, Send, Square, Users, X } from "lucide-react";
import { useToast } from "@/components/ui";

interface Goal {
  id: string;
  title: string;
  objective: string;
  successCriteria: string;
  status: string;
  round: number;
  maxRounds: number;
  achievedAt: string | null;
  updatedAt: string;
  _count?: { tasks: number; messages: number };
}

interface Message {
  id: string;
  kind: string;
  fromAgentSlug: string | null;
  toAgentSlug: string | null;
  body: string;
  createdAt: string;
}

interface Task {
  id: string;
  objective: string;
  status: string;
  error: string | null;
  createdAt: string;
  assignedAgent: { slug: string; name: string } | null;
}

const STATUS_STYLE: Record<string, string> = {
  ACTIVE: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  ACHIEVED: "bg-accent/15 text-accent",
  PAUSED: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  CANCELLED: "bg-[var(--surface-2)] text-[var(--muted)]",
  FAILED: "bg-rose-500/15 text-rose-700 dark:text-rose-400",
};

/**
 * The AI team's goal board.
 *
 * You give an objective and the criteria for "done"; the team plans, delegates
 * to each other in a shared thread, and keeps going round by round until the
 * criteria are met or it needs a human. Everything they say to each other is
 * visible here.
 */
export function TeamGoals() {
  const toast = useToast();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<{ goal: Goal; messages: Message[]; tasks: Task[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: "", objective: "", successCriteria: "" });

  const loadGoals = useCallback(async () => {
    try {
      const response = await fetch("/api/ai/goals");
      if (!response.ok) return;
      const data = await response.json();
      setGoals(data.goals ?? []);
      setSelectedId((current) => current || data.goals?.[0]?.id || "");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    if (!id) return;
    try {
      const response = await fetch(`/api/ai/goals/${id}`);
      if (!response.ok) return;
      setDetail(await response.json());
    } catch {
      /* keep the previous view */
    }
  }, []);

  useEffect(() => {
    void loadGoals();
  }, [loadGoals]);

  useEffect(() => {
    void loadDetail(selectedId);
    if (!selectedId) return;
    const timer = setInterval(() => void loadDetail(selectedId), 8000);
    return () => clearInterval(timer);
  }, [selectedId, loadDetail]);

  const act = async (action: string) => {
    if (!selectedId) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/ai/goals/${selectedId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "That did not work");
      if (action === "advance" || action === "nudge" || action === "resume") {
        toast((data.result?.created ?? 0) > 0 ? "The team has its next assignments" : "Round evaluated");
      }
      await Promise.all([loadGoals(), loadDetail(selectedId)]);
    } catch (error: any) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  const create = async () => {
    if (!form.title.trim() || form.objective.trim().length < 10 || !form.successCriteria.trim()) {
      toast("Title, objective and success criteria are all required", "error");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/ai/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not create the goal");
      setCreating(false);
      setForm({ title: "", objective: "", successCriteria: "" });
      await loadGoals();
      setSelectedId(data.goal.id);
      toast("Goal set — the team is starting");
    } catch (error: any) {
      toast(error.message, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-0 gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      {/* Goal list */}
      <aside className="min-h-0 space-y-2 overflow-y-auto">
        <div className="flex items-center justify-between">
          <p className="text-caption font-bold uppercase tracking-widest text-[var(--muted)]">Goals</p>
          <button
            onClick={() => setCreating((value) => !value)}
            className="flex h-6 w-6 items-center justify-center rounded-md border border-[var(--border)] text-[var(--muted)] transition hover:text-[var(--text)]"
            aria-label="New goal"
          >
            <Plus size={13} />
          </button>
        </div>

        {creating && (
          <div className="space-y-2 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5">
            <input
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              placeholder="Goal name (e.g. Find 20 AWS leads)"
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-meta outline-none"
            />
            <textarea
              value={form.objective}
              onChange={(event) => setForm({ ...form, objective: event.target.value })}
              placeholder="What should the team actually achieve?"
              rows={3}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-meta outline-none"
            />
            <textarea
              value={form.successCriteria}
              onChange={(event) => setForm({ ...form, successCriteria: event.target.value })}
              placeholder="How will we know it is done? (e.g. 20 qualified leads added with source + contact)"
              rows={2}
              className="w-full resize-y rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-meta outline-none"
            />
            <div className="flex gap-1.5">
              <button
                onClick={() => void create()}
                disabled={busy}
                className="flex-1 rounded-lg px-2 py-1.5 text-meta font-bold text-white disabled:opacity-50"
                style={{ background: "linear-gradient(135deg, var(--accent), var(--accent-2))" }}
              >
                Set the goal
              </button>
              <button
                onClick={() => setCreating(false)}
                className="rounded-lg border border-[var(--border)] px-2 py-1.5 text-meta text-[var(--muted)]"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {loading ? (
          <p className="text-meta text-[var(--muted)]">Loading…</p>
        ) : goals.length === 0 ? (
          <p className="text-meta leading-relaxed text-[var(--muted)]">
            No goals yet. Set one and the AI team will keep working toward it — planning, delegating and
            reporting to each other until it is done.
          </p>
        ) : (
          goals.map((goal) => (
            <button
              key={goal.id}
              onClick={() => setSelectedId(goal.id)}
              className={`w-full rounded-lg border px-2.5 py-2 text-left transition ${
                goal.id === selectedId
                  ? "border-accent bg-accent/5"
                  : "border-[var(--border)] hover:bg-[var(--hover)]"
              }`}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="truncate text-meta font-semibold text-[var(--text)]">{goal.title}</span>
                <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-bold ${STATUS_STYLE[goal.status] ?? STATUS_STYLE.CANCELLED}`}>
                  {goal.status.toLowerCase()}
                </span>
              </span>
              <span className="mt-0.5 block text-caption text-[var(--muted)]">
                round {goal.round}/{goal.maxRounds} · {goal._count?.tasks ?? 0} tasks
              </span>
            </button>
          ))
        )}
      </aside>

      {/* Goal detail */}
      <section className="min-h-0 overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {!detail ? (
          <div className="flex h-full min-h-[320px] flex-col items-center justify-center gap-2 text-center">
            <Users size={20} className="text-[var(--muted)]" />
            <p className="text-meta text-[var(--muted)]">Pick a goal, or set a new one.</p>
          </div>
        ) : (
          <div className="flex min-h-full flex-col">
            <header className="border-b border-[var(--border)] p-3.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-display text-prose font-extrabold tracking-tight text-[var(--text)]">
                    {detail.goal.title}
                  </h2>
                  <p className="mt-0.5 text-caption text-[var(--muted)]">
                    Round {detail.goal.round} of {detail.goal.maxRounds} · done when: {detail.goal.successCriteria}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-caption font-bold ${STATUS_STYLE[detail.goal.status] ?? ""}`}>
                  {detail.goal.status.toLowerCase()}
                </span>
              </div>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <button
                  onClick={() => void act("advance")}
                  disabled={busy}
                  className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-caption font-semibold text-[var(--text)] transition hover:border-accent disabled:opacity-50"
                >
                  <RefreshCw size={11} /> Run a round now
                </button>
                {detail.goal.status === "ACTIVE" ? (
                  <button onClick={() => void act("pause")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-caption font-semibold text-[var(--muted)] transition hover:text-[var(--text)] disabled:opacity-50">
                    <Pause size={11} /> Pause
                  </button>
                ) : (
                  <button onClick={() => void act("resume")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-caption font-semibold text-[var(--text)] transition hover:border-accent disabled:opacity-50">
                    <Play size={11} /> Resume
                  </button>
                )}
                <button onClick={() => void act("cancel")} disabled={busy} className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-caption font-semibold text-[var(--muted)] transition hover:text-rose-600 disabled:opacity-50">
                  <Square size={11} /> Stop
                </button>
              </div>
            </header>

            <div className="flex-1 space-y-2.5 p-3.5">
              {detail.messages.length === 0 ? (
                <p className="text-meta text-[var(--muted)]">No messages yet.</p>
              ) : (
                detail.messages.map((message) => {
                  const isSystem = message.kind === "SYSTEM";
                  const isUser = message.kind === "USER";
                  return (
                    <div key={message.id} className="flex gap-2">
                      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ${isUser ? "bg-accent text-white" : isSystem ? "bg-[var(--surface-2)] text-[var(--muted)]" : "bg-[#e9f5ff] text-sky-700"}`}>
                        {isUser ? "you" : isSystem ? <CircleDot size={9} /> : <Bot size={9} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-caption text-[var(--muted)]">
                          {isUser ? "You" : isSystem ? "Orchestrator" : message.fromAgentSlug}
                          {message.toAgentSlug ? (
                            <span className="inline-flex items-center gap-0.5">
                              {" "}
                              <ArrowRight size={8} /> {message.toAgentSlug}
                            </span>
                          ) : null}
                          <span className="ml-1.5 opacity-70">
                            {new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
                          </span>
                        </p>
                        <p className="mt-0.5 whitespace-pre-wrap break-words text-meta leading-relaxed text-[var(--text)]">
                          {message.body}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {detail.tasks.length > 0 && (
              <div className="border-t border-[var(--border)] p-3.5">
                <p className="mb-1.5 text-caption font-bold uppercase tracking-widest text-[var(--muted)]">
                  Work assigned
                </p>
                <div className="space-y-1">
                  {detail.tasks.map((task) => (
                    <div key={task.id} className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-2 py-1.5">
                      <span className="shrink-0 rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--muted)]">
                        {task.assignedAgent?.slug ?? "agent"}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-caption text-[var(--text)]">{task.objective}</span>
                      <span className={`shrink-0 text-[9px] font-bold uppercase ${task.status === "COMPLETED" ? "text-emerald-600" : task.status === "FAILED" ? "text-rose-600" : "text-[var(--muted)]"}`}>
                        {task.status.toLowerCase()}
                      </span>
                      {task.status === "COMPLETED" && <Check size={10} className="shrink-0 text-emerald-600" />}
                      {task.status === "FAILED" && <X size={10} className="shrink-0 text-rose-600" />}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}
