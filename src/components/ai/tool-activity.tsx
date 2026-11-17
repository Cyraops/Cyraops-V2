"use client";

import {
  BarChart3,
  Building2,
  Check,
  ChevronRight,
  FileText,
  Globe,
  ListChecks,
  Mail,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Wrench,
  X,
} from "lucide-react";

type Icon = typeof Search;

export interface ToolStep {
  /** Raw tool id, e.g. `search_leads`. */
  name: string;
  status: "running" | "done" | "failed";
  /** How many times this tool has run in the turn. */
  count: number;
  durationMs?: number;
}

/**
 * Tool ids phrased as things the assistant did, so the trail reads like work
 * performed rather than a list of function names.
 */
const TOOL_STYLES: Record<string, { label: string; Icon: Icon }> = {
  search_leads: { label: "Searched leads", Icon: Search },
  get_lead: { label: "Read lead", Icon: Search },
  search_deals: { label: "Checked deals", Icon: TrendingUp },
  get_deal: { label: "Read deal", Icon: TrendingUp },
  search_contacts: { label: "Looked up contacts", Icon: Users },
  search_companies: { label: "Looked up companies", Icon: Building2 },
  search_tasks: { label: "Checked tasks", Icon: ListChecks },
  create_task: { label: "Created task", Icon: ListChecks },
  update_lead: { label: "Updated lead", Icon: Users },
  create_lead: { label: "Created lead", Icon: Users },
  create_deal: { label: "Created deal", Icon: TrendingUp },
  update_deal: { label: "Updated deal", Icon: TrendingUp },
  get_sales_report: { label: "Ran sales report", Icon: BarChart3 },
  get_pipeline_report: { label: "Ran pipeline report", Icon: BarChart3 },
  generate_management_report: { label: "Built management report", Icon: BarChart3 },
  search_documents: { label: "Searched documents", Icon: FileText },
  read_authorized_document: { label: "Read document", Icon: FileText },
  summarize_thread: { label: "Read email thread", Icon: Mail },
  send_email: { label: "Sent email", Icon: Mail },
  create_page: { label: "Built a page", Icon: FileText },
  update_page: { label: "Updated a page", Icon: FileText },
  browser_navigate: { label: "Opened a site", Icon: Globe },
  browser_extract: { label: "Read a web page", Icon: Globe },
  browser_screenshot: { label: "Took a screenshot", Icon: Globe },
  browser_click: { label: "Clicked on a page", Icon: Globe },
  browser_type: { label: "Typed on a page", Icon: Globe },
};

function styleFor(name: string): { label: string; Icon: Icon } {
  if (TOOL_STYLES[name]) return TOOL_STYLES[name];
  if (/browser|computer|navigate|click|screenshot/i.test(name)) return { label: "Used the browser", Icon: Globe };
  if (/memory|remember/i.test(name)) return { label: "Checked memory", Icon: Sparkles };
  return { label: name.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()), Icon: Wrench };
}

/** Accepts both the old names-only payload and the newer step objects. */
export function parseToolSteps(raw: string | null | undefined): ToolStep[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(Boolean)
      .map((entry: any) =>
        typeof entry === "string"
          ? { name: entry, status: "done" as const, count: 1 }
          : {
              name: String(entry.name ?? ""),
              status: (entry.status === "running" ? "running" : entry.status === "failed" ? "failed" : "done") as ToolStep["status"],
              count: Number(entry.count ?? 1) || 1,
              durationMs: typeof entry.durationMs === "number" ? entry.durationMs : undefined,
            }
      )
      .filter((step) => step.name);
  } catch {
    return [];
  }
}

/** Live runs are windowed so a long turn never pushes the conversation away. */
const LIVE_STEP_WINDOW = 6;

export function ToolActivity({ steps, live, durationMs }: { steps: ToolStep[]; live: boolean; durationMs?: number }) {
  if (!steps.length) return null;

  const hidden = live && steps.length > LIVE_STEP_WINDOW ? steps.length - LIVE_STEP_WINDOW : 0;
  const shown = hidden > 0 ? steps.slice(hidden) : steps;
  const failed = steps.filter((step) => step.status === "failed").length;
  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : undefined;

  return (
    <details
      // Uncontrolled after the turn ends so a trail the user expanded is not
      // snapped shut; while live it stays open.
      open={live ? true : undefined}
      className="group mt-1.5 w-fit min-w-[190px] rounded-lg border border-[var(--border)] bg-[var(--surface-2)] text-meta text-[var(--muted)]"
    >
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1 font-medium transition hover:text-[var(--text)]">
        <ChevronRight size={12} className="shrink-0 transition-transform group-open:rotate-90" />
        {live ? (
          <span className="text-[var(--text)]">Working…</span>
        ) : failed ? (
          <span className="text-rose-600 dark:text-rose-400">{failed} failed</span>
        ) : (
          <span>Done</span>
        )}
        <span>
          · {steps.length} step{steps.length > 1 ? "s" : ""}
          {seconds ? ` · ${seconds}s` : ""}
        </span>
      </summary>
      <div className="space-y-0.5 border-t border-[var(--border)] px-2 py-1.5">
        {hidden > 0 && (
          <p className="text-caption">+{hidden} earlier step{hidden > 1 ? "s" : ""}</p>
        )}
        {shown.map((step, index) => {
          const { label, Icon: StepIcon } = styleFor(step.name);
          const running = step.status === "running";
          return (
            <div key={`${step.name}-${index}`} className="flex items-center gap-1.5 leading-5">
              {running ? (
                <StepIcon size={10} className="shrink-0 animate-pulse text-amber-600 dark:text-amber-400" />
              ) : step.status === "failed" ? (
                <X size={10} className="shrink-0 text-rose-600 dark:text-rose-400" />
              ) : (
                <StepIcon size={10} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
              <span className={`truncate ${running ? "text-[var(--text)]" : ""}`} title={label}>
                {label}
                {step.count > 1 ? ` ×${step.count}` : ""}
              </span>
              {step.durationMs !== undefined && !running && (
                <span className="ml-auto shrink-0 pl-2 text-caption tabular-nums">
                  {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
          );
        })}
        {!live && !failed && (
          <p className="flex items-center gap-1.5 pt-0.5 text-caption text-emerald-600 dark:text-emerald-400">
            <Check size={10} /> finished
          </p>
        )}
      </div>
    </details>
  );
}
