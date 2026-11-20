"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, FolderOpen, GitBranch, Loader2, Play, RefreshCw, Terminal, X } from "lucide-react";

/**
 * The Workspace panel (right rail of the bot page): the conversation's
 * project-root file tree with a git branch row, a two-column Files | Diff
 * viewer, and a command box whose Run button sends the command through the
 * SAME chat send path the message box uses (the stream route classifies
 * destructive commands server-side and surfaces the same approval card tool
 * approvals use).
 *
 * Git mutations (New branch / Switch… / Commit / Discard) call the JSON git
 * routes under /workspace/git/*. Discard and switch-with-uncommitted-changes
 * are approval-gated: the route returns { needsApproval, approvalId, summary }
 * and this panel renders an inline approval card (same amber style as the
 * chat's AskBlock), answers /api/harness/approve, then retries the route with
 * { approvalId }.
 *
 * While the conversation has NO root, owners see an inline setter; with a root
 * set, the realpath shows with a small ✕ that clears it. Both controls are
 * owner-only and simply don't render for anyone else.
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
  reason?: string;
}

interface BranchInfo {
  current: string;
  branches: string[];
}

interface PreviewState {
  path: string;
  name: string;
  content: string;
  truncated: boolean;
  binary: boolean;
}

interface DiffState {
  path: string;
  name: string;
  rawText: string;
  stat: string;
}

type PendingGitApproval = {
  approvalId: string;
  summary: string;
  op: { kind: "discard"; path: string } | { kind: "switch"; name: string };
};

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

/** Unquote a porcelain path that git C-quoted (contains spaces/unusual chars). */
function unquoteGitPath(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    const inner = trimmed.slice(1, -1);
    return inner.replace(/\\(["\\])/g, "$1");
  }
  return trimmed;
}

/** The set of workspace-relative paths with any change, from `git status --porcelain`. */
function changedPathsFromStatus(status: string): Set<string> {
  const paths = new Set<string>();
  for (const line of status.split("\n")) {
    if (!line) continue;
    // Porcelain v1: "XY PATH", two status chars then a space then the path
    // (renames are "XY old -> new").
    const rest = line.slice(3);
    const arrow = rest.indexOf(" -> ");
    const path = arrow > 0 ? rest.slice(arrow + 4) : rest;
    const cleaned = unquoteGitPath(path);
    if (cleaned) paths.add(cleaned);
  }
  return paths;
}

/** Classify one diff line for colouring. */
type DiffLineKind = "add" | "del" | "hunk" | "meta" | "ctx";
function diffLineKind(line: string): DiffLineKind {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  if (line.startsWith("@@")) return "hunk";
  if (/^(diff --git|index |new file mode|deleted file mode|similarity index|rename from|rename to|--- |\+\+\+ )/.test(line)) {
    return "meta";
  }
  return "ctx";
}

export function WorkspacePanel({
  conversationId,
  busy,
  canManage,
  onRunCommand,
}: {
  conversationId: string;
  /** The chat's own busy flag: commands wait for the in-flight turn. */
  busy: boolean;
  /** Owner-only controls (set / clear the root, git mutations) render only when true. */
  canManage: boolean;
  /** Sends the command through the chat's existing stream path (command intent). */
  onRunCommand: (command: string) => void;
}) {
  const [info, setInfo] = useState<WorkspaceInfo | null>(null);
  const [git, setGit] = useState<GitInfo | null>(null);
  const [branches, setBranches] = useState<BranchInfo | null>(null);
  const [tree, setTree] = useState<Record<string, WorkspaceEntry[]>>({});
  const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [command, setCommand] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [gitError, setGitError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  /** The path the owner is typing into the root setter input. */
  const [pathDraft, setPathDraft] = useState("");
  /** A set/clear root request is in flight. */
  const [saving, setSaving] = useState(false);
  /** Which inline git control is open (new branch / switch). */
  const [branchAction, setBranchAction] = useState<"new" | "switch" | null>(null);
  const [newBranchName, setNewBranchName] = useState("");
  const [commitMessage, setCommitMessage] = useState("");
  /** A git mutation is in flight (commit/discard/create/switch/approve). */
  const [gitBusy, setGitBusy] = useState(false);
  /** An inline approval card for a gated git op. */
  const [pendingApproval, setPendingApproval] = useState<PendingGitApproval | null>(null);
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  /** Once git is known unavailable (non-repo), stop polling it until an explicit refresh. */
  const gitUnavailableRef = useRef(false);

  const changedPaths = useMemo(() => changedPathsFromStatus(git?.status ?? ""), [git?.status]);

  const loadInfo = useCallback(
    async (force = false) => {
      if (!conversationId) return;
      setError(null);
      try {
        const base = `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace`;
        // A non-git root is a stable answer: once seen, skip the git round-trips
        // until the owner forces a refresh, so git is never polled while the
        // directory is not a repository.
        const skipGit = !force && gitUnavailableRef.current;
        const [infoData, gitData, branchesData] = await Promise.all([
          fetch(base, { cache: "no-store" }).then((res) => res.json().catch(() => ({}))),
          skipGit
            ? Promise.resolve(undefined)
            : fetch(`${base}/git-status`, { cache: "no-store" }).then((res) => res.json().catch(() => null)),
          skipGit
            ? Promise.resolve(undefined)
            : fetch(`${base}/git/branches`, { cache: "no-store" }).then((res) => res.json().catch(() => null)),
        ]);
        if (!aliveRef.current) return;
        setInfo(infoData.workspace ?? null);
        if (gitData !== undefined) {
          setGit(gitData);
          setBranches(
            branchesData && typeof branchesData.current === "string" && branchesData.available !== false
              ? branchesData
              : null
          );
          gitUnavailableRef.current = gitData?.available === false;
        }
      } catch {
        if (aliveRef.current) setError("Could not load the workspace.");
      }
    },
    [conversationId]
  );

  // Reset and reload whenever the conversation changes.
  useEffect(() => {
    setInfo(null);
    setGit(null);
    setBranches(null);
    setTree({});
    setExpanded({});
    setLoadingDirs({});
    setPreview(null);
    setDiff(null);
    setCommand("");
    setError(null);
    setGitError(null);
    setBranchAction(null);
    setNewBranchName("");
    setCommitMessage("");
    setPendingApproval(null);
    gitUnavailableRef.current = false;
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

  const loadDiff = async (entry: WorkspaceEntry) => {
    setDiffLoading(true);
    setDiff(null);
    setPreview(null);
    setGitError(null);
    try {
      const url = `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace/git/diff?path=${encodeURIComponent(entry.path)}`;
      const data = await fetch(url, { cache: "no-store" }).then((res) => res.json());
      if (!aliveRef.current) return;
      if (typeof data.rawText === "string") {
        setDiff({ path: entry.path, name: entry.name, rawText: data.rawText, stat: data.stat ?? "" });
      } else {
        setGitError(data.error || "Could not load the diff.");
      }
    } catch {
      if (aliveRef.current) setGitError("Could not load the diff.");
    } finally {
      if (aliveRef.current) setDiffLoading(false);
    }
  };

  const openFile = async (entry: WorkspaceEntry) => {
    // Changed files open the diff pane; unchanged files keep the text preview.
    if (changedPaths.has(entry.path)) {
      await loadDiff(entry);
      return;
    }
    setPreviewLoading(true);
    setPreview(null);
    setDiff(null);
    setGitError(null);
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
    setDiff(null);
    setGitError(null);
    // Force a fresh git check: the owner may have turned the folder into a repo.
    await loadInfo(true);
    await loadDir("");
    setRefreshing(false);
  };

  /**
   * POST a JSON git route. Resolves to { ok, data } on success, { ok:false,
   * error } on a plain failure, or { needsApproval } when the route gated the
   * operation (the panel then shows the inline card and retries with the id).
   */
  const postGit = async (
    url: string,
    body: Record<string, unknown>
  ): Promise<{ ok: boolean; needsApproval?: { approvalId: string; summary: string }; data?: unknown; error?: string }> => {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (data.needsApproval === true && typeof data.approvalId === "string") {
        return {
          ok: false,
          needsApproval: { approvalId: data.approvalId, summary: typeof data.summary === "string" ? data.summary : "" },
        };
      }
      if (!response.ok) return { ok: false, error: data.error || "The git operation failed." };
      return { ok: true, data };
    } catch {
      return { ok: false, error: "Could not reach the git API." };
    }
  };

  const gitBase = `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace/git`;

  const createNewBranch = async () => {
    const name = newBranchName.trim();
    if (!name || gitBusy || !canManage) return;
    setGitBusy(true);
    setGitError(null);
    const result = await postGit(`${gitBase}/branch`, { name });
    setGitBusy(false);
    if (!result.ok) {
      setGitError(result.error || "Could not create the branch.");
      return;
    }
    setNewBranchName("");
    setBranchAction(null);
    await refresh();
  };

  const switchTo = async (name: string) => {
    if (!name || gitBusy || !canManage) return;
    setGitBusy(true);
    setGitError(null);
    const result = await postGit(`${gitBase}/branch`, { switch: name });
    setGitBusy(false);
    if (result.needsApproval) {
      setPendingApproval({ approvalId: result.needsApproval.approvalId, summary: result.needsApproval.summary, op: { kind: "switch", name } });
      return;
    }
    if (!result.ok) {
      setGitError(result.error || "Could not switch branch.");
      return;
    }
    setBranchAction(null);
    await refresh();
  };

  const commit = async () => {
    const message = commitMessage.trim();
    if (!message || gitBusy || !canManage) return;
    setGitBusy(true);
    setGitError(null);
    const result = await postGit(`${gitBase}/commit`, { message });
    setGitBusy(false);
    if (!result.ok) {
      setGitError(result.error || "Could not commit.");
      return;
    }
    setCommitMessage("");
    await refresh();
  };

  const discard = async (path: string) => {
    if (!path || gitBusy || !canManage) return;
    setGitBusy(true);
    setGitError(null);
    const result = await postGit(`${gitBase}/discard`, { path });
    setGitBusy(false);
    if (result.needsApproval) {
      setPendingApproval({ approvalId: result.needsApproval.approvalId, summary: result.needsApproval.summary, op: { kind: "discard", path } });
      return;
    }
    if (!result.ok) {
      setGitError(result.error || "Could not discard changes.");
      return;
    }
    await refresh();
  };

  /** Answer the inline approval card (via /api/harness/approve) and retry the gated op on allow. */
  const approveGit = async (approve: boolean) => {
    if (!pendingApproval || gitBusy) return;
    const { approvalId, op } = pendingApproval;
    setGitBusy(true);
    try {
      const response = await fetch("/api/harness/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approvalId, approve }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) {
        setGitError(data.error || "That approval could not be processed.");
        setPendingApproval(null);
        return;
      }
      if (!approve) {
        setPendingApproval(null);
        return;
      }
      const url = op.kind === "discard" ? `${gitBase}/discard` : `${gitBase}/branch`;
      const body = op.kind === "discard" ? { path: op.path, approvalId } : { switch: op.name, approvalId };
      const result = await postGit(url, body);
      setPendingApproval(null);
      if (!result.ok) {
        setGitError(result.error || "The git operation failed.");
        return;
      }
      setBranchAction(null);
      await refresh();
    } finally {
      setGitBusy(false);
    }
  };

  /**
   * Owner-only root setter: POST the absolute path. The server validates it
   * (missing / not-a-directory → 400 with a readable error) and records both
   * spellings. On success the listing reloads and the tree re-roots itself.
   */
  const setRoot = async () => {
    const value = pathDraft.trim();
    if (!value || saving || !conversationId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace-root`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: value }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!aliveRef.current) return;
      if (!response.ok) {
        setError(data.error || "Could not set the workspace root.");
        return;
      }
      setPathDraft("");
      setTree({});
      setExpanded({});
      setPreview(null);
      setDiff(null);
      // A new root may be a git repository: re-check git rather than carrying
      // the previous root's "not a git repository" verdict forward.
      gitUnavailableRef.current = false;
      await loadInfo();
    } catch {
      if (aliveRef.current) setError("Could not set the workspace root.");
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  /** Clear the root ({ path: null }) — the conversation returns to CRM mode. */
  const clearRoot = async () => {
    if (saving || !conversationId) return;
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/assistant/conversations/${encodeURIComponent(conversationId)}/workspace-root`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: null }),
        }
      );
      const data = await response.json().catch(() => ({}));
      if (!aliveRef.current) return;
      if (!response.ok) {
        setError(data.error || "Could not clear the workspace root.");
        return;
      }
      setPathDraft("");
      setTree({});
      setExpanded({});
      setPreview(null);
      setDiff(null);
      gitUnavailableRef.current = false;
      await loadInfo();
    } catch {
      if (aliveRef.current) setError("Could not clear the workspace root.");
    } finally {
      if (aliveRef.current) setSaving(false);
    }
  };

  const hasRoot = Boolean(info?.workspaceRootRealpath || info?.workspaceRoot);

  // Still loading (or no conversation yet): the panel stays out of the rail.
  if (!info) return null;

  // No workspace root set: owners get the inline setter; everyone else sees
  // nothing (the API is owner-only, so the controls would just 403 for them).
  if (!hasRoot) {
    if (!canManage) return null;
    return (
      <div id="rail-workspace" className="mt-2 shrink-0">
        <p className="mb-2 mt-4 flex items-center gap-1.5 text-caption font-bold uppercase tracking-widest text-[var(--muted)]">
          <Folder size={12} />
          <span className="flex-1">Workspace</span>
        </p>
        <div className="rounded-lg border border-[var(--border)]">
          <div className="px-2 py-1.5">
            <p className="text-[10px] leading-snug text-[var(--muted)]">
              No project root yet. Set an absolute folder path and this chat's harness turns run inside it.
            </p>
            <form
              className="mt-1.5 flex items-center gap-1"
              onSubmit={(event) => {
                event.preventDefault();
                void setRoot();
              }}
            >
              <input
                value={pathDraft}
                onChange={(event) => setPathDraft(event.target.value)}
                placeholder="/absolute/path/to/project"
                disabled={saving}
                aria-label="Workspace root path"
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 font-mono text-[10px] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={saving || !pathDraft.trim()}
                className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-[10px] font-semibold text-[var(--text)] transition hover:text-accent disabled:opacity-40"
                aria-label="Set workspace root"
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : null}
                Set
              </button>
            </form>
          </div>
          {error && (
            <p className="border-t border-[var(--border)] px-2 py-1.5 text-[10px] leading-snug text-rose-600 dark:text-rose-400">
              {error}
            </p>
          )}
        </div>
      </div>
    );
  }

  const rootPath = info?.realpath || info?.workspaceRootRealpath || info?.workspaceRoot || "";
  const rootMissing = info?.exists === false;
  const counts = git ? gitCountsOf(git) : null;
  const currentBranch = branches?.current || git?.branch || "";
  const localBranches = (branches?.branches ?? []).filter((name) => !name.startsWith("remotes/"));
  const selectedChangedPath = diff?.path ?? null;

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
              diff?.path === entry.path ? "bg-accent/10 text-[var(--text)]" : "text-[var(--text)]"
            }`}
            style={{ paddingLeft: 19 + depth * 12 }}
            title={`${entry.name} · ${formatSize(entry.size)}`}
          >
            <FileText size={12} className={`shrink-0 ${changedPaths.has(entry.path) ? "text-accent" : "text-[var(--muted)]"}`} />
            <span className={`min-w-0 flex-1 truncate ${changedPaths.has(entry.path) ? "font-semibold text-accent" : ""}`}>
              {entry.name}
            </span>
            {changedPaths.has(entry.path) && (
              <span className="shrink-0 text-[9px] font-bold text-accent" aria-label="changed">●</span>
            )}
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
      </p>

      <div className="rounded-lg border border-[var(--border)]">
        <div className="border-b border-[var(--border)] px-2 py-1.5">
          <div className="flex items-center gap-1">
            <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-[var(--muted)]" title={rootPath}>
              {rootMissing ? `${rootPath} (missing)` : rootPath}
            </p>
            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="shrink-0 rounded p-0.5 text-[var(--muted)] transition hover:text-[var(--text)] disabled:opacity-40"
              title="Refresh workspace"
              aria-label="Refresh workspace"
            >
              <RefreshCw size={11} className={refreshing ? "animate-spin" : ""} />
            </button>
            {canManage && (
              <button
                onClick={() => void clearRoot()}
                disabled={saving}
                className="shrink-0 rounded p-0.5 text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-rose-600 disabled:opacity-40"
                title="Clear workspace root"
                aria-label="Clear workspace root"
              >
                {saving ? <Loader2 size={10} className="animate-spin" /> : <X size={11} />}
              </button>
            )}
          </div>
        </div>

        {/* Git / branch row */}
        {git !== null && git.available && (
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5">
            <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--text)]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span className="truncate">{currentBranch || "(no branch)"}</span>
            </span>
            {canManage && (
              <>
                <button
                  onClick={() => {
                    setBranchAction((current) => (current === "new" ? null : "new"));
                    setNewBranchName("");
                  }}
                  disabled={gitBusy}
                  className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text)] transition hover:text-accent disabled:opacity-40"
                  aria-label="New branch"
                >
                  New branch
                </button>
                <button
                  onClick={() => setBranchAction((current) => (current === "switch" ? null : "switch"))}
                  disabled={gitBusy || localBranches.length <= 1}
                  className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10px] text-[var(--text)] transition hover:text-accent disabled:opacity-40"
                  aria-label="Switch branch"
                >
                  Switch…
                </button>
              </>
            )}
            <span className="ml-auto shrink-0 text-[10px] text-[var(--muted)]">
              {counts && counts.changed > 0 ? `${counts.changed} ${counts.changed === 1 ? "change" : "changes"}` : "clean"}
            </span>
          </div>
        )}
        {git === null && (
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">
            <Loader2 size={10} className="animate-spin" /> Reading git…
          </div>
        )}
        {git !== null && !git.available && (
          <div className="flex items-center gap-1 border-b border-[var(--border)] px-2 py-1.5 text-[10px] text-[var(--muted)]">
            <GitBranch size={11} /> {git.reason || "not a git repository"}
          </div>
        )}

        {/* Inline new-branch / switch controls */}
        {canManage && branchAction === "new" && git?.available && (
          <div className="border-b border-[var(--border)] px-2 py-1.5">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void createNewBranch();
              }}
              className="flex items-center gap-1"
            >
              <input
                value={newBranchName}
                onChange={(event) => setNewBranchName(event.target.value)}
                placeholder="branch-name"
                disabled={gitBusy}
                autoFocus
                aria-label="New branch name"
                className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-accent disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={gitBusy || !newBranchName.trim()}
                className="shrink-0 rounded-md bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                aria-label="Create branch"
              >
                Create
              </button>
            </form>
          </div>
        )}
        {canManage && branchAction === "switch" && git?.available && (
          <div className="border-b border-[var(--border)] px-2 py-1.5">
            <select
              defaultValue=""
              onChange={(event) => {
                const value = event.target.value;
                if (value) void switchTo(value);
              }}
              disabled={gitBusy}
              aria-label="Switch branch"
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)] outline-none focus:border-accent disabled:opacity-50"
            >
              <option value="" disabled>
                Switch to…
              </option>
              {localBranches.map((name) => (
                <option key={name} value={name} disabled={name === currentBranch}>
                  {name}
                  {name === currentBranch ? " (current)" : ""}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Two-column Files | Diff */}
        <div className="grid grid-cols-2">
          {/* FILES */}
          <div className="min-w-0 border-r border-[var(--border)]">
            <p className="px-2 pt-1.5 text-[9px] font-bold uppercase tracking-widest text-[var(--muted)]">Files</p>
            <div className="max-h-56 overflow-y-auto px-1 py-1">
              {rootMissing ? (
                <p className="px-1 py-1 text-[10px] leading-snug text-[var(--muted)]">
                  The workspace folder no longer exists. Clear the root with ✕ above, then set a new one.
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
          </div>

          {/* DIFF / preview */}
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1 px-2 pt-1.5 text-[9px] font-bold tracking-widest text-[var(--muted)]">
              <span className="uppercase">{diff ? "Diff" : preview ? "File" : "Diff"}</span>
              {diff || preview ? (
                <span className="truncate font-mono font-normal normal-case tracking-normal">· {(diff ?? preview)?.name}</span>
              ) : null}
            </p>
            <div className="max-h-56 overflow-auto px-1 py-1">
              {diffLoading ? (
                <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-[var(--muted)]">
                  <Loader2 size={10} className="animate-spin" /> Reading diff…
                </div>
              ) : diff ? (
                diff.rawText ? (
                  <div className="font-mono text-[10px] leading-relaxed">
                    {diff.rawText.split("\n").map((line, index) => {
                      const kind = diffLineKind(line);
                      const bg =
                        kind === "add"
                          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                          : kind === "del"
                            ? "bg-rose-500/10 text-rose-700 dark:text-rose-400"
                            : kind === "hunk"
                              ? "bg-[var(--surface-2)] text-[var(--muted)]"
                              : kind === "meta"
                                ? "text-[var(--faint)]"
                                : "text-[var(--text)]";
                      return (
                        <div key={index} className={`whitespace-pre-wrap break-all px-1 ${bg}`}>
                          {line || " "}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-1 py-1 text-[10px] text-[var(--muted)]">No unstaged changes for this file.</p>
                )
              ) : previewLoading ? (
                <div className="flex items-center gap-1.5 px-1 py-1 text-[10px] text-[var(--muted)]">
                  <Loader2 size={10} className="animate-spin" /> Reading file…
                </div>
              ) : preview ? (
                preview.binary ? (
                  <p className="px-1 py-1 text-[10px] text-[var(--muted)]">Binary file — preview unavailable.</p>
                ) : (
                  <pre className="whitespace-pre-wrap break-all px-1 font-mono text-[10px] leading-relaxed text-[var(--text)]">
                    {preview.content || "(empty file)"}
                  </pre>
                )
              ) : (
                <p className="px-1 py-1 text-[10px] leading-snug text-[var(--muted)]">
                  Select a file to preview it, or a changed file to see its diff.
                </p>
              )}
            </div>

            {/* Commit / Discard */}
            {canManage && git?.available && (
              <div className="border-t border-[var(--border)] px-1.5 py-1.5">
                <div className="flex items-center gap-1">
                  <input
                    value={commitMessage}
                    onChange={(event) => setCommitMessage(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commit();
                      }
                    }}
                    placeholder="Commit message…"
                    disabled={gitBusy || !counts || counts.changed === 0}
                    aria-label="Commit message"
                    className="min-w-0 flex-1 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text)] outline-none placeholder:text-[var(--faint)] focus:border-accent disabled:opacity-50"
                  />
                  <button
                    onClick={() => void commit()}
                    disabled={gitBusy || !commitMessage.trim() || !counts || counts.changed === 0}
                    className="shrink-0 rounded-md bg-accent px-2 py-1 text-[10px] font-semibold text-white transition hover:opacity-90 disabled:opacity-40"
                    aria-label="Commit changes"
                  >
                    {gitBusy ? <Loader2 size={10} className="animate-spin" /> : "Commit"}
                  </button>
                  <button
                    onClick={() => selectedChangedPath && void discard(selectedChangedPath)}
                    disabled={gitBusy || !selectedChangedPath}
                    className="shrink-0 rounded-md border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[10px] text-[var(--text)] transition hover:text-rose-600 disabled:opacity-40"
                    aria-label="Discard selected file"
                  >
                    Discard
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Inline approval card for gated git ops (same amber style as AskBlock). */}
        {pendingApproval && (
          <div role="group" aria-label="Approval required" className="border-t border-[var(--border)] bg-amber-500/5 p-2">
            <p className="text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">Approval required</p>
            <p className="mt-0.5 break-words text-[10px] leading-snug text-[var(--text)]">{pendingApproval.summary}</p>
            <div className="mt-1.5 flex gap-1.5">
              <button
                onClick={() => void approveGit(true)}
                disabled={gitBusy}
                className="rounded-md bg-emerald-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
              >
                {gitBusy ? <Loader2 size={10} className="animate-spin" /> : "Approve"}
              </button>
              <button
                onClick={() => void approveGit(false)}
                disabled={gitBusy}
                className="rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)] disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Command box */}
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

      {gitError && <p className="mt-1 text-[10px] leading-snug text-rose-600 dark:text-rose-400">{gitError}</p>}
      {error && <p className="mt-1 text-[10px] leading-snug text-rose-600 dark:text-rose-400">{error}</p>}
    </div>
  );
}
