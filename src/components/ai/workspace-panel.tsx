"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, GitBranch, Loader2, Play, RefreshCw, Terminal, X } from "lucide-react";

/**
 * The Workspace panel (right rail of the bot page): the conversation's
 * project-root file tree with an inline text preview, a read-only git line,
 * and a command box whose Run button sends the command through the SAME chat
 * send path the message box uses (the stream route classifies destructive
 * commands server-side and surfaces the same approval card tool approvals
 * use).
 *
 * Renders nothing until the conversation has a workspace root (the API is
 * owner-only; the conversation resolves under this user's assistant, so the
 * panel simply shows the result it is allowed to see).
 */

interface WorkspaceInfo {
  workspaceRoot: string | null;
  workspaceRootRealpath: string | null;
  exists: boolean;
  realpath: string | null;
}

interface WorkspaceEntry {
  name: string;
  path: string;
  kind: "dir" | "file";
  size: number;
}

interface GitInfo {
  branch: string;
  status: string;
  log: string;
  diffStat: string;
  available: boolean;
}

interface PreviewState {
  path: string;
  name: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

/** "main · 3 changed · 1 staged" — the short counts for the git line. */
function gitCountsOf(git: GitInfo): { changed: number; staged: number; untracked: number } {
  const lines = git.status.split("\n").filter((line) => line.trim() !== "");
  const staged = lines.filter((line) => line.length > 0 && line[0] !== " " && line[0] !== "?").length;
  const untracked = lines.filter((line) => line.startsWith("??")).length;
  return { changed: lines.length, staged, untracked };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function WorkspacePanel({
  conversationId,
  busy,
  onRunCommand,
}: {
  conversationId: string;
  /** The chat's own busy flag: commands wait for the in-flight turn. */
  busy: boolean;
  /** Sends the command through the chat's existing stream path (command intent). */
  onRunCommand: (command: string) => void;
}) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const loadInfo = useCallback(async () => {
    if (!conversationId) return;
    setError(null);
    try {
      const [infoRes, gitRes] = await Promise.all([
        fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace`, { cache: "no-store" }),
        fetch(`/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace/git-status`, { cache: "no-store" }),
      ]);
      const infoData = await infoRes.json().catch(() => ({}));
      const gitData = await gitRes.json().catch(() => null);
      if (!aliveRef.current) return;
      setInfo(infoData.workspace ?? null);
      setGit(gitData);
    } catch {
      if (aliveRef.current) setError("Could not load the workspace.");
    }
  }, [conversationId]);

  // Reset and reload whenever the conversation changes.
  useEffect(() => {
    setInfo(null);
    setGit(null);
    setTree({});
    setExpanded({});
    setLoadingDirs({});
    setPreview(null);
    setCommand("");
    setError(null);
    if (conversationId) void loadInfo();
  }, [conversationId, loadInfo]);

  const loadDir = useCallback(
    async (path: string) => {
      if (!conversationId) return;
      setLoadingDirs((current) => ({ ...current, [path]: true }));
      try {
        const url = `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace/files?path=${encodeURIComponent(path)}`;
        const data = await fetch(url, { cache: "no-store" }).then((res) => res.json());
        if (!aliveRef.current) return;
        if (Array.isArray(data.entries)) {
          setTree((current) => ({ ...current, [path]: data.entries }));
        } else {
          setError(data.error || "Could not list that folder.");
        }
      } catch {
        if (aliveRef.current) setError("Could not list that folder.");
      } finally {
        if (aliveRef.current) setLoadingDirs((current) => ({ ...current, [path]: false }));
      }
    },
    [conversationId]
  );

  // The root level loads as soon as the workspace exists.
  useEffect(() => {
    if (info?.workspaceRootRealpath && !(tree[""] || loadingDirs[""])) void loadDir("");
  }, [info?.workspaceRootRealpath, tree, loadingDirs, loadDir]);

  const toggleDir = (path: string) => {
    setExpanded((current) => ({ ...current, [path]: !current[path] }));
    if (!tree[path]) void loadDir(path);
  };

  const openFile = async (entry: WorkspaceEntry) => {
    setPreviewLoading(true);
    setPreview(null);
    try {
      const url = `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace/file?path=${encodeURIComponent(entry.path)}`;
      const data = await fetch(url, { cache: "no-store" }).then((res) => res.json());
      if (!aliveRef.current) return;
      if (data.binary === true) {
        setPreview({ path: entry.path, name: entry.name, content: "", truncated: false, binary: true });
      } else if (typeof data.content === "string") {
        setPreview({
          path: entry.path,
          name: entry.name,
          content: data.content,
          truncated: data.truncated === true,
          binary: false,
        });
      } else {
        setError(data.error || "Could not read that file.");
      }
    } catch {
      if (aliveRef.current) setError("Could not read that file.");
    } finally {
      if (aliveRef.current) setPreviewLoading(false);
    }
  };

  const run = () => {
    const value = command.trim();
    if (!value || busy) return;
    setCommand("");
    onRunCommand(value);
  };

  const refresh = async () => {
    setRefreshing(true);
    setTree({});
    setPreview(null);
    await loadInfo();
    await loadDir("");
    setRefreshing(false);
  };

  const hasRoot = Boolean(info?.workspaceRootRealpath || info?.workspaceRoot);

  // No workspace root set: the panel stays out of the rail entirely.
  if (!hasRoot) return null;

  const rootPath = info?.realpath || info?.workspaceRootRealpath || info?.workspaceRoot || "";
  const rootMissing = info?.exists === false;
  const counts = git ? gitCountsOf(git) : null;

  const renderEntries = (entries: WorkspaceEntry[], depth: number) =>
    entries.map((entry) => (
      <div key={entry.path}>
        {entry.kind === "dir" ? (
          <>
            <button
              onClick={() => toggleDir(entry.path)}
              aria-expanded={expanded[entry.path] === true}
              className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left text-meta text-[var(--text)] transition hover:bg-[var(--hover)]"
              style={{ paddingLeft: 4 + depth * 12 }}
            >
              <ChevronRight
                size={11}
                className={`shrink-0 text-[var(--muted)] transition-transform ${expanded[entry.path] ? "rotate-90" : ""}`}
              />
              {expanded[entry.path] ? (
                <FolderOpen size={12} className="shrink-0 text-amber-600/80 dark:text-amber-400/80" />
              ) : (
                <Folder size={12} className="shrink-0 text-amber-600/80 dark:text-amber-400/80" />
              )}
              <span className="min-w-0 truncate">{entry.name}</span>
            </button>
            {expanded[entry.path] && (
              <div>
                {loadingDirs[entry.path] && !tree[entry.path] ? (
                  <div className="flex items-center gap-1.5 py-0.5 text-[10px] text-[var(--muted)]" style={{ paddingLeft: 24 + depth * 12 }}>
                    <Loader2 size={10} className="animate-spin" /> Loading…
                  </div>
                ) : (
                  renderEntries(tree[entry.path] ?? [], depth + 1)
                )}
              </div>
            )}
          </>
        ) : (
          <button
            onClick={() => void openFile(entry)}
            className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-meta transition hover:bg-[var(--hover)] ${
              preview?.path === entry.path ? "bg-accent/10 text-[var(--text)]" : "text-[var(--text)]"
            }`}
            style={{ paddingLeft: 19 + depth * 12 }}
            title={`${entry.name} · ${formatSize(entry.size)}`}
          >
            <FileText size={12} className="shrink-0 text-[var(--muted)]" />
            <span className="min-w-0 flex-1 truncate">{entry.name}</span>
            <span className="shrink-0 font-mono text-[9px] text-[var(--faint)]">{formatSize(entry.size)}</span>
          </button>
        )}
      </div>
    ));

  return (
    <div id="rail-workspace" className="mt-2 shrink-0">
      <p className="mb-2 mt-4 flex items-center gap-1.5 text-caption font-bold uppercase tracking-widest text-[var(--muted)]">
        <Folder size={12} />
        <span className="flex-1">Workspace</span>
        <button
          onClick={() => void refresh()}
          disabled={refreshing}
          className="rounded p-0.5 text-[var(--muted)] transition hover:text-[var(--text)] disabled:opacity-40"
          aria-label="Refresh workspace"
        >
          <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
        </button>
      </p>

      <div className="rounded-lg border border-[var(--border)]">
        <div className="border-b border-[var(--border)] px-2 py-1.5">
          <p className="truncate font-mono text-[10px] text-[var(--muted)]" title={rootPath}>
            {rootMissing ? `${rootPath} (missing)` : rootPath}
          </p>
          <div className="mt-0.5 flex items-center gap-1 text-[10px] text-[var(--muted)]">
            {git === null ? (
              <span className="flex items-center gap-1">
                <Loader2 size={10} className="animate-spin" /> Reading git…
              </span>
            ) : !git.available ? (
              <span className="flex items-center gap-1">
                <GitBranch size={11} /> Not a git repository
              </span>
            ) : (
              <span className="flex min-w-0 items-center gap-1" title={git.status || "clean"}>
                <GitBranch size={11} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
                <span className="truncate font-semibold text-[var(--text)]">{git.branch || "(no branch)"}</span>
                <span className="text-[var(--faint)]">·</span>
                <span className="truncate">
                  {counts && counts.changed > 0
                    ? `${counts.changed} changed${counts.staged > 0 ? ` · ${counts.staged} staged` : ""}${counts.untracked > 0 ? ` · ${counts.untracked} untracked` : ""}`
                    : "clean"}
                </span>
              </span>
            )}
          </div>
        </div>

        <div className="max-h-44 overflow-y-auto px-1 py-1">
          {rootMissing ? (
            <p className="px-1 py-1 text-[10px] leading-snug text-[var(--muted)]">
              The workspace folder no longer exists. Set a new root for this chat from the workspace picker.
            </p>
          ) : loadingDirs[""] && !tree[""] ? (
            <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-[var(--muted)]">
              <Loader2 size={10} className="animate-spin" /> Listing files…
            </div>
          ) : (tree[""] ?? []).length === 0 ? (
            <p className="px-1 py-1 text-[10px] text-[var(--muted)]">The workspace is empty.</p>
          ) : (
            renderEntries(tree[""], 0)
          )}
        </div>

        {previewLoading && (
          <div className="flex items-center gap-1.5 border-t border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">
            <Loader2 size={10} className="animate-spin" /> Reading file…
          </div>
        )}
        {preview && !previewLoading && (
          <div className="border-t border-[var(--border)]">
            <div className="flex items-center gap-1 px-2 py-1">
              <span className="min-w-0 flex-1 truncate font-mono text-[10px] font-semibold text-[var(--text)]" title={preview.path}>
                {preview.name}
              </span>
              {preview.truncated && (
                <span className="shrink-0 rounded bg-[var(--surface-2)] px-1 text-[9px] text-amber-600 dark:text-amber-400">
                  truncated
                </span>
              )}
              <button
                onClick={() => setPreview(null)}
                className="shrink-0 rounded p-0.5 text-[var(--muted)] transition hover:text-[var(--text)]"
                aria-label="Close preview"
              >
                <X size={11} />
              </button>
            </div>
            {preview.binary ? (
              <p className="px-2 pb-2 text-[10px] text-[var(--muted)]">Binary file — preview unavailable.</p>
            ) : (
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-all px-2 pb-2 font-mono text-[10px] leading-relaxed text-[var(--text)]">
                {preview.content || "(empty file)"}
              </pre>
            )}
          </div>
        )}

        <div className="border-t border-[var(--border)] px-1.5 py-1.5">
          <div className="flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1">
            <Terminal size={11} className="shrink-0 text-[var(--muted)]" />
            <input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  run();
                }
              }}
              placeholder="Run a shell command…"
              disabled={busy}
              aria-label="Shell command"
              className="min-w-0 flex-1 bg-transparent font-mono text-meta text-[var(--text)] outline-none placeholder:text-[var(--faint)] disabled:opacity-50"
            />
            <button
              onClick={run}
              disabled={busy || !command.trim()}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[var(--surface)] text-[var(--text)] transition hover:text-accent disabled:opacity-40"
              aria-label="Run command"
              title={busy ? "Wait for the current turn" : "Run command"}
            >
              {busy ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            </button>
          </div>
          <p className="mt-1 px-0.5 text-[9px] leading-snug text-[var(--muted)]">
            Runs through the assistant as a chat turn — destructive commands ask for approval first.
          </p>
        </div>
      </div>

      {error && <p className="mt-1 text-[10px] leading-snug text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
