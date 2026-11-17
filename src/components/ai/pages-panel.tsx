"use client";

import { useEffect, useMemo, useState } from "react";
import { Download, Check, Copy, ExternalLink, FileText, Globe, History, Link2, Loader2, Lock, RefreshCw, X } from "lucide-react";
import { PAGE_KIT_CSS, renderDocument } from "@/lib/pages/kit";

export interface PageMeta {
  id: string;
  title: string;
  publicSlug: string;
  isPublic: boolean;
  updatedAt: string;
}

export interface OpenPage extends PageMeta {
  content: string;
  currentVersion?: number;
  shareExpiresAt?: string | null;
}

/**
 * Page HTML is assistant-authored, so it renders inside a fully sandboxed
 * iframe: no scripts, no same-origin access, no way to reach the CRM session.
 */
function documentFor(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  ${PAGE_KIT_CSS}
  *,*::before,*::after{box-sizing:border-box}
  body{margin:0;padding:18px;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    color:#16151f;background:#fff;line-height:1.55;font-size:13px}
  h1{font-size:19px;margin:0 0 6px}h2{font-size:15px;margin:18px 0 6px}h3{font-size:13px;margin:14px 0 4px}
  p{margin:0 0 10px}ul,ol{margin:0 0 10px;padding-left:20px}
  table{width:100%;border-collapse:collapse;margin:10px 0;font-size:12px}
  th,td{border-bottom:1px solid #eceaf4;padding:7px 9px;text-align:left}
  th{background:#f7f7fb;font-weight:600}
  img{max-width:100%;height:auto}code{background:#f2f1f8;padding:1px 4px;border-radius:4px;font-size:11px}
  a{color:#5b4bd6}
</style></head><body>${renderDocument(html)}</body></html>`;
}

export function PagesPanel({
  page,
  onClose,
  onShared,
}: {
  page: OpenPage;
  onClose: () => void;
  onShared: (id: string, isPublic: boolean) => void;
}) {
  const [isPublic, setIsPublic] = useState(page.isPublic);
  const [busy, setBusy] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [slug, setSlug] = useState(page.publicSlug);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ version: number; title: string; createdAt: string }>>([]);
  const [restored, setRestored] = useState<{ content: string; title: string; version: number } | null>(null);
  const [current, setCurrent] = useState(page.currentVersion ?? 1);
  const srcDoc = useMemo(
    () => documentFor(restored?.content ?? page.content),
    [page.content, restored?.content]
  );

  useEffect(() => {
    setIsPublic(page.isPublic);
  }, [page.id, page.isPublic]);

  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);
  const shareUrl = origin ? `${origin}/p/${slug}` : "";

  const loadVersions = async () => {
    try {
      const response = await fetch(`/api/pages/${page.id}/versions`);
      const data = await response.json();
      if (Array.isArray(data.versions)) setVersions(data.versions);
      if (typeof data.currentVersion === "number") setCurrent(data.currentVersion);
    } catch {
      /* history is optional */
    }
  };

  const toggleHistory = async () => {
    const next = !historyOpen;
    setHistoryOpen(next);
    if (next) await loadVersions();
  };

  const restore = async (version: number) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/pages/${page.id}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version }),
      });
      const data = await response.json();
      if (response.ok && data.page) {
        setCurrent(data.page.currentVersion);
        // Point the preview at the restored version, otherwise "Restore" looks
        // like it did nothing.
        setRestored({ content: data.page.content, title: data.page.title, version: data.page.currentVersion });
        await loadVersions();
      }
    } catch {
      /* keep the current version */
    } finally {
      setBusy(false);
    }
  };

  const share = async (payload: { enabled?: boolean; regenerate?: boolean }) => {
    setBusy(true);
    try {
      const response = await fetch(`/api/pages/${page.id}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not update sharing");
      const next = Boolean(data.page?.isPublic);
      setIsPublic(next);
      if (data.page?.publicSlug) setSlug(data.page.publicSlug);
      onShared(page.id, next);
    } catch {
      /* keep the previous state; the toggle is retryable */
    } finally {
      setBusy(false);
    }
  };

  const toggleShare = () => share({ enabled: !isPublic });
  const regenerateLink = () => share({ enabled: true, regenerate: true });

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-full max-w-[580px] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl">
      <header className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-[var(--border)] px-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[#f0efff] text-accent">
            <FileText size={13} />
          </span>
          <b className="truncate text-xs text-[var(--text)]">{page.title}</b>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => void toggleShare()}
            disabled={busy}
            className={`flex h-7 items-center gap-1 rounded-lg border px-2 text-caption font-semibold transition ${
              isPublic
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"
            }`}
            title={isPublic ? "Anyone with the link can view" : "Share a public link"}
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : isPublic ? <Globe size={11} /> : <Lock size={11} />}
            {isPublic ? "Shared" : "Share"}
          </button>
          {isPublic && (
            <>
              <a
                href={shareUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--border)] text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                title="Open the public link"
              >
                <ExternalLink size={12} />
              </a>
              <button
                onClick={() => void copyLink()}
                className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
                title="Copy the public link"
              >
                {copied ? <Check size={11} /> : <Link2 size={11} />}
                {copied ? "Copied" : "Copy link"}
              </button>
            </>
          )}
          <button
            onClick={() => void regenerateLink()}
            disabled={busy}
            className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)]"
            title="Make a new link, revoking the old one"
          >
            <RefreshCw size={11} /> New link
          </button>
          <span className="relative">
            <button
              onClick={() => setExportOpen((open) => !open)}
              className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
              title="Download this page"
              aria-haspopup="menu"
              aria-expanded={exportOpen}
            >
              <Download size={11} /> Export
            </button>
            {exportOpen && (
              <span
                role="menu"
                className="absolute right-0 top-8 z-40 flex w-52 flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--surface)] py-1 shadow-xl"
              >
                <a
                  role="menuitem"
                  href={`/api/pages/${page.id}/export?format=print`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => setExportOpen(false)}
                  className="px-3 py-1.5 text-left text-caption hover:bg-[var(--hover)]"
                >
                  PDF <span className="text-[var(--muted)]">— print dialog, Save as PDF</span>
                </a>
                <a
                  role="menuitem"
                  href={`/api/pages/${page.id}/export?format=md`}
                  onClick={() => setExportOpen(false)}
                  className="px-3 py-1.5 text-left text-caption hover:bg-[var(--hover)]"
                >
                  Markdown <span className="text-[var(--muted)]">— for docs or a repo</span>
                </a>
                <a
                  role="menuitem"
                  href={`/api/pages/${page.id}/export?format=html`}
                  onClick={() => setExportOpen(false)}
                  className="px-3 py-1.5 text-left text-caption hover:bg-[var(--hover)]"
                >
                  HTML <span className="text-[var(--muted)]">— self-contained file</span>
                </a>
              </span>
            )}
          </span>

          <button
            onClick={() => void toggleHistory()}
            className="flex h-7 items-center gap-1 rounded-lg border border-[var(--border)] px-2 text-caption font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)]"
            title="Version history"
          >
            <History size={11} /> v{current}
          </button>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
            aria-label="Close page"
          >
            <X size={14} />
          </button>
        </span>
      </header>
      {historyOpen && (
        <div className="max-h-56 shrink-0 overflow-auto border-b border-[var(--border)] bg-[var(--surface-2)] p-2">
          {versions.length === 0 ? (
            <p className="px-2 py-3 text-meta text-[var(--muted)]">No saved versions yet.</p>
          ) : (
            versions.map((entry) => (
              <div key={entry.version} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-[var(--hover)]">
                <span className="w-8 shrink-0 text-caption font-bold tabular-nums text-[var(--muted)]">
                  v{entry.version}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-meta text-[var(--text)]">{entry.title}</span>
                  <span className="block text-caption text-[var(--muted)]">
                    {new Date(entry.createdAt).toLocaleString()}
                  </span>
                </span>
                {entry.version === current ? (
                  <span className="shrink-0 text-caption font-semibold text-emerald-600 dark:text-emerald-400">current</span>
                ) : (
                  <button
                    onClick={() => void restore(entry.version)}
                    disabled={busy}
                    className="shrink-0 rounded-md border border-[var(--border)] px-1.5 py-0.5 text-caption font-semibold text-[var(--muted)] transition hover:text-[var(--text)]"
                  >
                    Restore
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}
      <iframe
        title={page.title}
        sandbox=""
        srcDoc={srcDoc}
        referrerPolicy="no-referrer"
        className="min-h-0 flex-1 bg-white"
      />
    </aside>
  );
}

export function PagesBrowser({
  pages,
  onOpen,
  onClose,
}: {
  pages: PageMeta[];
  onOpen: (id: string) => void;
  onClose: () => void;
}) {
  const [copiedId, setCopiedId] = useState("");

  return (
    <div className="absolute inset-0 z-40 flex items-start justify-center bg-black/30 p-4 pt-[10vh]" onClick={onClose}>
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <span className="text-xs font-bold text-[var(--text)]">Pages</span>
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]" aria-label="Close">
            <X size={14} />
          </button>
        </header>
        <div className="soft-scrollbar max-h-[60vh] overflow-y-auto p-2">
          {pages.length === 0 ? (
            <p className="px-2 py-6 text-center text-meta text-[var(--muted)]">
              No pages yet. Ask your assistant for a dashboard or report and it will build one here.
            </p>
          ) : (
            pages.map((page) => (
              <div key={page.id} className="flex items-center gap-2 rounded-lg px-2 py-2 hover:bg-[var(--hover)]">
                <button onClick={() => onOpen(page.id)} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <FileText size={13} className="shrink-0 text-accent" />
                  <span className="min-w-0">
                    <span className="block truncate text-meta font-medium text-[var(--text)]">{page.title}</span>
                    <span className="block text-caption text-[var(--muted)]">
                      {new Date(page.updatedAt).toLocaleDateString()}
                      {page.isPublic ? " · shared" : ""}
                    </span>
                  </span>
                </button>
                {page.isPublic && (
                  <button
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(`${window.location.origin}/p/${page.publicSlug}`);
                        setCopiedId(page.id);
                        setTimeout(() => setCopiedId(""), 1600);
                      } catch {
                        /* clipboard unavailable */
                      }
                    }}
                    className="flex h-6 items-center gap-1 rounded-md border border-[var(--border)] px-1.5 text-caption text-[var(--muted)] hover:text-[var(--text)]"
                    title="Copy public link"
                  >
                    {copiedId === page.id ? <Check size={10} /> : <Copy size={10} />}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
