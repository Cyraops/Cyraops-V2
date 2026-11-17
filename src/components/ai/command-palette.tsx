"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, MessageSquare, Sparkles, X } from "lucide-react";

export interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

export interface PaletteConversation {
  id: string;
  title: string;
}

export interface PalettePage {
  id: string;
  title: string;
}

/**
 * ⌘K over conversations, pages and quick actions. One search box beats hunting
 * a sidebar, and it is the fastest way to reach anything the assistant made.
 */
export function CommandPalette({
  open,
  onClose,
  conversations,
  pages,
  actions,
  onOpenConversation,
  onOpenPage,
}: {
  open: boolean;
  onClose: () => void;
  conversations: PaletteConversation[];
  pages: PalettePage[];
  actions: PaletteAction[];
  onOpenConversation: (id: string) => void;
  onOpenPage: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setCursor(0);
    // Focus after paint so the dialog is measured before the caret lands.
    const timer = setTimeout(() => inputRef.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const match = (text: string) => !needle || text.toLowerCase().includes(needle);

    return [
      ...actions.filter((action) => match(action.label)).map((action) => ({
        key: `action-${action.id}`,
        group: "Action",
        label: action.label,
        hint: action.hint,
        Icon: Sparkles,
        run: action.run,
      })),
      ...conversations.filter((conversation) => match(conversation.title)).map((conversation) => ({
        key: `chat-${conversation.id}`,
        group: "Chat",
        label: conversation.title,
        hint: undefined,
        Icon: MessageSquare,
        run: () => onOpenConversation(conversation.id),
      })),
      ...pages.filter((page) => match(page.title)).map((page) => ({
        key: `page-${page.id}`,
        group: "Page",
        label: page.title,
        hint: undefined,
        Icon: FileText,
        run: () => onOpenPage(page.id),
      })),
    ].slice(0, 12);
  }, [query, actions, conversations, pages, onOpenConversation, onOpenPage]);

  if (!open) return null;

  const choose = (index: number) => {
    const entry = results[index];
    if (!entry) return;
    onClose();
    entry.run();
  };

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-[12vh]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setCursor(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setCursor((index) => Math.min(index + 1, results.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setCursor((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                choose(cursor);
              } else if (event.key === "Escape") {
                event.preventDefault();
                onClose();
              }
            }}
            placeholder="Search chats, pages and actions…"
            aria-label="Search"
            className="flex-1 bg-transparent text-prose outline-none placeholder:text-[var(--muted)]"
          />
          <button onClick={onClose} className="text-[var(--muted)] hover:text-[var(--text)]" aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="soft-scrollbar max-h-[52vh] overflow-y-auto p-1.5">
          {results.length === 0 ? (
            <p className="px-3 py-6 text-center text-meta text-[var(--muted)]">Nothing matches “{query}”.</p>
          ) : (
            results.map((entry, index) => (
              <button
                key={entry.key}
                onClick={() => choose(index)}
                onMouseEnter={() => setCursor(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                  index === cursor ? "bg-accent/10" : "hover:bg-[var(--hover)]"
                }`}
              >
                <entry.Icon size={13} className="shrink-0 text-[var(--muted)]" />
                <span className="min-w-0 flex-1 truncate text-body text-[var(--text)]">{entry.label}</span>
                {entry.hint && <span className="shrink-0 text-caption text-[var(--muted)]">{entry.hint}</span>}
                <span className="shrink-0 text-caption uppercase tracking-wide text-[var(--muted)]">{entry.group}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
