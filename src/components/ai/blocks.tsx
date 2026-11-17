"use client";

import { Check, X } from "lucide-react";
import { Markdown } from "./markdown";
import { parseToolSteps, ToolActivity } from "./tool-activity";
import { stripToolMarkup } from "@/lib/ai/tool-markup";

/**
 * A message is a list of typed blocks, not a string.
 *
 * Before this, the chat model was `{ content: string, toolCalls?: string }` and
 * every new thing — steps, approvals, files — was wedged into those two fields
 * and re-parsed with try/catch. Modelling the blocks explicitly gives one place
 * per kind and one switch to render them, so adding a kind is additive.
 */
export type MessageBlock =
  | { kind: "text"; text: string }
  | { kind: "steps"; raw: string; live: boolean; durationMs?: number }
  | { kind: "files"; raw: string }
  | {
      kind: "ask";
      id: string;
      summary: string;
      toolName: string;
      answered?: "allow" | "deny";
      canAlwaysAllow?: boolean;
    };

export interface BlockSource {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: string | null;
  attachments?: string | null;
  streaming?: boolean;
  toolDurationMs?: number;
}

export interface PendingAsk {
  id: string;
  toolName: string;
  summary: string;
  answered?: "allow" | "deny";
  canAlwaysAllow?: boolean;
}

/** Normalises a stored message into blocks. Legacy rows still work. */
export function toBlocks(message: BlockSource, ask?: PendingAsk | null): MessageBlock[] {
  const blocks: MessageBlock[] = [];

  if (message.content) {
    // Models occasionally write tool calls as text; never show that to a reader.
    const text = stripToolMarkup(message.content);
    if (text) blocks.push({ kind: "text", text });
  }
  if (message.role === "assistant" && parseToolSteps(message.toolCalls).length) {
    blocks.push({
      kind: "steps",
      raw: message.toolCalls ?? "",
      live: Boolean(message.streaming),
      durationMs: message.toolDurationMs,
    });
  }
  if (message.attachments) blocks.push({ kind: "files", raw: message.attachments });
  if (ask) {
    blocks.push({
      kind: "ask",
      id: ask.id,
      summary: ask.summary,
      toolName: ask.toolName,
      answered: ask.answered,
      canAlwaysAllow: ask.canAlwaysAllow,
    });
  }
  return blocks;
}

export function StepBlock({ block }: { block: Extract<MessageBlock, { kind: "steps" }> }) {
  return <ToolActivity steps={parseToolSteps(block.raw)} live={block.live} durationMs={block.durationMs} />;
}

export function TextBlock({ block, assistant }: { block: Extract<MessageBlock, { kind: "text" }>; assistant: boolean }) {
  return assistant ? <Markdown content={block.text} /> : <>{block.text}</>;
}

export function FileBlock({ block }: { block: Extract<MessageBlock, { kind: "files" }> }) {
  let items: Array<{ id: string; name: string; mimeType?: string; url?: string }> = [];
  try {
    const parsed = JSON.parse(block.raw);
    if (Array.isArray(parsed)) items = parsed;
  } catch {
    return null;
  }
  if (!items.length) return null;

  return (
    <div className="mt-1 flex flex-wrap gap-1.5">
      {items.map((item) => {
        // The API returns ids, not URLs, so never rely on a stored url: build it.
        const href = item.url ?? `/api/chat/attachments/${item.id}`;
        return String(item.mimeType ?? "").startsWith("image/") ? (
          <a key={item.id} href={href} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border border-[var(--border)]">
            <img src={href} alt={item.name} className="h-16 w-16 object-cover" />
          </a>
        ) : (
          <a
            key={item.id}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2 py-0.5 text-caption text-[var(--muted)] hover:text-accent"
          >
            {item.name}
          </a>
        );
      })}
    </div>
  );
}

export function AskBlock({
  block,
  onDecide,
}: {
  block: Extract<MessageBlock, { kind: "ask" }>;
  onDecide: (approve: boolean, alwaysAllow?: boolean) => void;
}) {
  return (
    <div role="group" aria-label="Approval required" className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3">
      <p className="text-caption font-bold uppercase tracking-wide text-amber-700 dark:text-amber-400">
        {block.answered ? "Answered" : "Approval required"}
      </p>
      <p className="mt-1 break-words text-body leading-5 text-[var(--text)]">{block.summary}</p>
      {block.answered ? (
        <p className="mt-2.5 flex items-center gap-1.5 text-meta font-semibold text-[var(--muted)]">
          {block.answered === "allow" ? <><Check size={12} /> Allowed</> : <><X size={12} /> Denied</>}
        </p>
      ) : (
        <div className="mt-2.5 flex flex-wrap gap-2">
          <button
            onClick={() => onDecide(true)}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 text-meta font-semibold text-white transition hover:bg-emerald-700"
          >
            Approve &amp; run
          </button>
          {block.canAlwaysAllow && (
            <button
              onClick={() => onDecide(true, true)}
              className="rounded-lg border border-emerald-600/40 px-3 py-1.5 text-meta font-semibold text-emerald-700 transition hover:bg-emerald-500/10 dark:text-emerald-400"
            >
              Always allow
            </button>
          )}
          <button
            onClick={() => onDecide(false)}
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-meta font-semibold text-[var(--muted)] transition hover:bg-[var(--hover)]"
          >
            Reject
          </button>
        </div>
      )}
    </div>
  );
}