"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock, Play, RefreshCw, Trash2, X } from "lucide-react";

interface Routine {
  id: string;
  name: string;
  description: string;
  cronExpression: string;
  isEnabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  skill?: { name: string } | null;
  agent?: { name: string } | null;
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  const diff = date.getTime() - Date.now();
  if (Math.abs(diff) < 60_000) return "now";
  const minutes = Math.round(diff / 60_000);
  if (minutes > 0) {
    if (minutes < 60) return `in ${minutes}m`;
    if (minutes < 1440) return `in ${Math.round(minutes / 60)}h`;
    return date.toLocaleDateString();
  }
  const ago = Math.abs(minutes);
  if (ago < 60) return `${ago}m ago`;
  if (ago < 1440) return `${Math.round(ago / 60)}h ago`;
  return date.toLocaleDateString();
}

export function RoutinesModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cronDraft, setCronDraft] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/routines");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to load routines");
      setRoutines(Array.isArray(data.routines) ? data.routines : []);
    } catch (err: any) {
      setError(err?.message || "Failed to load routines");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const toggle = async (routine: Routine) => {
    setBusyId(routine.id);
    try {
      const response = await fetch(`/api/routines/${routine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isEnabled: !routine.isEnabled }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to update");
      }
      setRoutines((prev) => prev.map((r) => (r.id === routine.id ? { ...r, isEnabled: !r.isEnabled } : r)));
    } catch (err: any) {
      setError(err?.message || "Failed to update the routine");
    } finally {
      setBusyId(null);
    }
  };

  const saveCron = async (routine: Routine) => {
    const next = (cronDraft[routine.id] ?? routine.cronExpression).trim();
    if (!next || next === routine.cronExpression) return;
    setBusyId(routine.id);
    try {
      const response = await fetch(`/api/routines/${routine.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronExpression: next }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to update schedule");
      setRoutines((prev) =>
        prev.map((r) => (r.id === routine.id ? { ...r, cronExpression: next, nextRunAt: data.routine?.nextRunAt ?? r.nextRunAt } : r))
      );
      setCronDraft((prev) => ({ ...prev, [routine.id]: next }));
    } catch (err: any) {
      setError(err?.message || "Failed to update schedule");
    } finally {
      setBusyId(null);
    }
  };

  const runNow = async (routine: Routine) => {
    setBusyId(routine.id);
    setError(null);
    try {
      const response = await fetch("/api/ai/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ routineId: routine.id }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to run the routine");
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to run the routine");
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (routine: Routine) => {
    setBusyId(routine.id);
    try {
      const response = await fetch(`/api/routines/${routine.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Failed to delete");
      }
      setRoutines((prev) => prev.filter((r) => r.id !== routine.id));
    } catch (err: any) {
      setError(err?.message || "Failed to delete the routine");
    } finally {
      setBusyId(null);
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="presentation"
      onKeyDown={(event) => {
        if (event.key === "Escape") onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Routines"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-3.5">
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-accent" />
            <div>
              <h3 className="text-sm font-bold text-[var(--text)]">Routines</h3>
              <p className="text-[10px] text-[var(--muted)]">Scheduled work that runs for you</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="soft-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
          {error && (
            <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 p-2 text-[11px] text-rose-600 dark:text-rose-400">
              {error}
            </div>
          )}

          {loading ? (
            <p className="py-8 text-center text-xs text-[var(--muted)]">Loading…</p>
          ) : routines.length === 0 ? (
            <p className="py-8 text-center text-xs text-[var(--muted)]">No routines yet.</p>
          ) : (
            <div className="space-y-3">
              {routines.map((routine) => (
                <div key={routine.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-2)] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-bold text-[var(--text)]">{routine.name}</p>
                      <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                        {routine.skill?.name || "Skill"}
                        {routine.agent?.name ? ` · ${routine.agent.name}` : ""}
                        {routine.lastStatus ? ` · last: ${routine.lastStatus}` : ""}
                      </p>
                    </div>
                    <button
                      onClick={() => void toggle(routine)}
                      disabled={busyId === routine.id}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold transition ${
                        routine.isEnabled
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                          : "bg-[var(--hover)] text-[var(--muted)]"
                      }`}
                    >
                      {routine.isEnabled ? "Enabled" : "Paused"}
                    </button>
                  </div>

                  <div className="mt-2.5 flex flex-wrap items-center gap-2">
                    <input
                      value={cronDraft[routine.id] ?? routine.cronExpression}
                      onChange={(e) => setCronDraft((prev) => ({ ...prev, [routine.id]: e.target.value }))}
                      onBlur={() => void saveCron(routine)}
                      className="w-[130px] rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1 font-mono text-[11px] outline-none"
                      title="Cron expression (5 fields)"
                    />
                    <span className="text-[10px] text-[var(--muted)]">next {formatWhen(routine.nextRunAt)}</span>
                    <span className="ml-auto flex items-center gap-1">
                      <button
                        onClick={() => void runNow(routine)}
                        disabled={busyId === routine.id}
                        className="flex items-center gap-1 rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--text)] hover:bg-[var(--hover)] disabled:opacity-40"
                      >
                        {busyId === routine.id ? <RefreshCw size={11} className="animate-spin" /> : <Play size={11} />} Run now
                      </button>
                      <button
                        onClick={() => void remove(routine)}
                        disabled={busyId === routine.id}
                        className="rounded-lg p-1.5 text-[var(--muted)] hover:bg-rose-500/10 hover:text-rose-600 disabled:opacity-40"
                        title="Delete routine"
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] px-5 py-2.5">
          <p className="text-[10px] leading-relaxed text-[var(--muted)]">
            Cron uses 5 fields in the server timezone (Asia/Kolkata): <span className="font-mono">0 9 * * *</span> = 09:00 daily.
            The scheduler wakes every minute; paused routines are skipped.
          </p>
        </div>
      </div>
    </div>
  );
}
