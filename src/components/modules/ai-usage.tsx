"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, Coins, RefreshCw } from "lucide-react";

interface Totals {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  lastUsedAt: string | null;
}

interface BySource extends Totals {
  source: string;
}

interface ByUser extends Totals {
  userId: string;
  name: string;
  email: string;
  role: string;
  bySource: BySource[];
}

interface Report {
  rangeDays: number;
  self: Totals & { bySource: BySource[] };
  byUser?: ByUser[];
  team?: Totals;
  unattributedRequests: number;
}

const RANGES: Array<{ days: number; label: string }> = [
  { days: 1, label: "Today" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
  { days: 90, label: "90 days" },
];

const SOURCE_LABELS: Record<string, string> = {
  agent: "AI agents",
  voice: "Voice assistant",
  email: "Email assistant",
  presence: "Presence audit",
};

function formatCost(value: number): string {
  if (!value) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">{label}</p>
      <p className="mt-1 text-lg font-bold text-[var(--text)]">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] text-[var(--muted)]">{hint}</p>}
    </div>
  );
}

export function AiUsagePanel() {
  const [report, setReport] = useState<Report | null>(null);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (range: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/ai/usage?days=${range}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load usage");
      setReport(data);
    } catch (err: any) {
      setError(err?.message || "Failed to load usage");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(days);
  }, [days, load]);

  const teamTotal = report?.team;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-[var(--text)]">
            <Activity size={16} className="text-accent" />
            AI Usage &amp; Spend
          </h3>
          <p className="mt-1 text-xs text-[var(--muted)]">
            Estimated cost is calculated from provider token pricing. Figures are indicative, not an invoice.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 rounded-lg border border-[var(--border)] p-1">
            {RANGES.map((range) => (
              <button
                key={range.days}
                onClick={() => setDays(range.days)}
                className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                  days === range.days
                    ? "bg-accent text-white"
                    : "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--text)]"
                }`}
              >
                {range.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => void load(days)}
            className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      {loading && (
        <div className="animate-pulse space-y-3">
          <div className="h-20 rounded-xl bg-[var(--hover)]" />
          <div className="h-40 rounded-xl bg-[var(--hover)]" />
        </div>
      )}

      {error && !loading && (
        <div className="rounded-xl border border-rose-500/25 bg-rose-500/10 p-3 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </div>
      )}

      {report && !loading && (
        <>
          {/* Your own usage — visible to every role */}
          <section>
            <p className="mb-2 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">Your usage</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label="Requests" value={report.self.requests.toLocaleString()} hint={`last ${report.rangeDays === 1 ? "day" : `${report.rangeDays} days`}`} />
              <Stat label="Tokens" value={formatTokens(report.self.totalTokens)} hint={`${formatTokens(report.self.promptTokens)} in / ${formatTokens(report.self.completionTokens)} out`} />
              <Stat label="Estimated cost" value={formatCost(report.self.estimatedCostUsd)} hint="your share" />
              <Stat label="Last activity" value={formatWhen(report.self.lastUsedAt)} />
            </div>

            {report.self.bySource.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {report.self.bySource.map((source) => (
                  <span
                    key={source.source}
                    className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted)]"
                  >
                    {SOURCE_LABELS[source.source] || source.source}: {source.requests} req · {formatTokens(source.totalTokens)} tokens · {formatCost(source.estimatedCostUsd)}
                  </span>
                ))}
              </div>
            )}

            {report.self.requests === 0 && (
              <p className="mt-3 text-xs text-[var(--muted)]">
                No AI usage recorded for you in this period yet.
              </p>
            )}
          </section>

          {/* Per-person breakdown — Owners and Admins only */}
          {report.byUser && (
            <section>
              <div className="mb-2 flex items-baseline justify-between">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  Usage by person (owner view)
                </p>
                {teamTotal && (
                  <p className="text-[11px] font-semibold text-[var(--text)]">
                    <Coins size={11} className="mr-1 inline" />
                    Team total: {formatCost(teamTotal.estimatedCostUsd)} · {teamTotal.requests.toLocaleString()} requests
                  </p>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
                <table className="w-full text-left text-xs">
                  <thead className="bg-[var(--hover)] text-[10px] uppercase tracking-wide text-[var(--muted)]">
                    <tr>
                      <th className="px-3 py-2 font-bold">Person</th>
                      <th className="px-3 py-2 font-bold">Role</th>
                      <th className="px-3 py-2 text-right font-bold">Requests</th>
                      <th className="px-3 py-2 text-right font-bold">Tokens</th>
                      <th className="px-3 py-2 text-right font-bold">Est. cost</th>
                      <th className="px-3 py-2 text-right font-bold">Last used</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.byUser.map((row) => (
                      <tr key={row.userId} className="border-t border-[var(--border)]">
                        <td className="px-3 py-2">
                          <span className="font-semibold text-[var(--text)]">{row.name}</span>
                          {row.email && <span className="ml-1.5 text-[11px] text-[var(--muted)]">{row.email}</span>}
                        </td>
                        <td className="px-3 py-2 text-[var(--muted)]">{row.role || "—"}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text)]">{row.requests.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right font-mono text-[var(--text)]">{formatTokens(row.totalTokens)}</td>
                        <td className="px-3 py-2 text-right font-mono font-semibold text-[var(--text)]">{formatCost(row.estimatedCostUsd)}</td>
                        <td className="px-3 py-2 text-right text-[var(--muted)]">{formatWhen(row.lastUsedAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {report.unattributedRequests > 0 && (
                <p className="mt-2 text-[11px] text-[var(--muted)]">
                  {report.unattributedRequests} request(s) in this period predate per-person tracking and have no owner.
                </p>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
