"use client";

import React, { memo, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, Download, Image as ImageIcon } from "lucide-react";

function CodeBlock({ code, language }: { code: string; language: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — nothing to recover */
    }
  };
  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface-2)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5">
        <span className="text-caption font-semibold uppercase tracking-wide text-[var(--muted)]">{language || "code"}</span>
        <button onClick={() => void copy()} className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]">
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="soft-scrollbar overflow-x-auto px-3 py-2.5">
        <code className="font-mono text-body leading-5 text-[var(--text)]">{code}</code>
      </pre>
    </div>
  );
}

/**
 * Streaming appends one token at a time. Parsing the whole reply on every token
 * is wasted work that gets worse as the answer grows, so the source is split
 * into top-level blocks and each block is memoised on its own text — a token
 * only ever re-parses the block it lands in.
 */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  for (const line of text.split("\n")) {
    const open = /^\s*(```|~~~)/.exec(line);
    if (open) fence = fence ? null : open[1];
    // A blank line ends a block, but never inside a fenced code block.
    if (!fence && line.trim() === "") {
      if (current.length) {
        blocks.push(current.join("\n"));
        current = [];
      }
      continue;
    }
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}

/** An odd number of fences means the stream is mid-code-block. */
function closeOpenFence(text: string): string {
  const fences = text.match(/^\s*(```|~~~)/gm)?.length ?? 0;
  return fences % 2 === 1 ? `${text}\n\`\`\`` : text;
}

/**
 * Tables in assistant replies are usually the answer. Give them a header that
 * stays put while scrolling, a way to expand, and a CSV export so the data can
 * leave the chat without re-typing it.
 */
function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  const props = (node as any)?.props;
  return props ? textOf(props.children) : "";
}

function firstElement(node: React.ReactNode): React.ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstElement(child);
      if (found) return found;
    }
    return null;
  }
  return node && typeof node === "object" && "props" in (node as any) ? (node as React.ReactElement) : null;
}

/**
 * Tables in assistant replies are usually the answer itself. Sorting keeps the
 * original cell elements (so links and code inside cells survive), adds row
 * limits for long tables, and exports CSV without retyping anything.
 */
function TableCard({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [exported, setExported] = useState(false);
  const [sortIndex, setSortIndex] = useState<number | null>(null);
  const [sortAsc, setSortAsc] = useState(true);
  const [page, setPage] = useState(0);

  // Split the rendered children into header + body rows, keeping cell nodes.
  const table = firstElement(children);
  const sections = React.Children.toArray((table?.props as any)?.children ?? []);
  // Identify by component name: these sections are React components we override,
  // so their `type` is a function, never the string "thead".
  const head = sections.find((section: any) => section?.type?.name === "MdThead") as React.ReactElement | undefined;
  const body = sections.find((section: any) => section?.type?.name === "MdTbody" || section?.type?.name === "tbody") as React.ReactElement | undefined;
  const fallbackBody = body ?? sections.find((section: any) => section !== head) as React.ReactElement | undefined;
  const headRow = firstElement((head?.props as any)?.children);
  const headCells = React.Children.toArray((headRow?.props as any)?.children ?? []).filter((cell: any) => cell?.props);

  const rows = React.Children.toArray(((body ?? fallbackBody)?.props as any)?.children ?? [])
    .filter((row: any) => row?.props)
    .map((row: any) => ({
      node: row,
      text: React.Children.toArray(row.props.children).map((cell) => textOf(cell)),
    }));

  const sorted = sortIndex === null ? rows : [...rows].sort((a, b) => {
    const left = a.text[sortIndex] ?? "";
    const right = b.text[sortIndex] ?? "";
    const leftNum = Number(left.replace(/[^0-9.-]/g, ""));
    const rightNum = Number(right.replace(/[^0-9.-]/g, ""));
    const numeric = left !== "" && right !== "" && Number.isFinite(leftNum) && Number.isFinite(rightNum);
    const result = numeric ? leftNum - rightNum : left.localeCompare(right);
    return sortAsc ? result : -result;
  });

  const PAGE_SIZE = 12;
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = expanded ? sorted : sorted.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const toCsv = (): string => {
    const header = headCells.map((cell: any) => `"${textOf(cell).replace(/"/g, '""')}"`).join(",");
    const lines = sorted.map((row) => row.text.map((value) => `"${value.replace(/"/g, '""')}"`).join(","));
    return [header, ...lines].filter(Boolean).join("\n");
  };

  const downloadCsv = () => {
    try {
      const blob = new Blob([toCsv()], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "table.csv";
      link.click();
      URL.revokeObjectURL(url);
      setExported(true);
      setTimeout(() => setExported(false), 1500);
    } catch {
      /* export is a convenience; the table stays readable */
    }
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-[var(--border)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-2)] px-2 py-1">
        <span className="text-caption font-semibold uppercase tracking-wide text-[var(--muted)]">
          {sorted.length} row{sorted.length === 1 ? "" : "s"}
        </span>
        <span className="flex items-center gap-1">
          <button
            onClick={downloadCsv}
            className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-caption text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            {exported ? <Check size={10} /> : <Download size={10} />} CSV
          </button>
          <button
            onClick={() => setExpanded((value) => !value)}
            aria-expanded={expanded}
            className="rounded-md px-1.5 py-0.5 text-caption text-[var(--muted)] transition hover:bg-[var(--hover)] hover:text-[var(--text)]"
          >
            {expanded ? "Paginate" : "Show all"}
          </button>
        </span>
      </div>

      <div ref={ref} className="soft-scrollbar overflow-auto" tabIndex={0} role="region" aria-label="Table, scrollable">
        <table className="w-full border-collapse text-body">
          {head && (
            <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">
              <tr>
                {headCells.map((cell: any, index: number) => (
                  <th
                    key={index}
                    aria-sort={sortIndex === index ? (sortAsc ? "ascending" : "descending") : "none"}
                    className="border-b border-[var(--border)] px-2.5 py-1.5 text-left font-semibold"
                  >
                    <button
                      onClick={() => {
                        setSortAsc(sortIndex === index ? !sortAsc : true);
                        setSortIndex(index);
                        setPage(0);
                      }}
                      className="flex items-center gap-1 text-left hover:text-accent"
                      title="Sort by this column"
                    >
                      {textOf(cell)}
                      <span aria-hidden className="text-[9px] text-[var(--muted)]">
                        {sortIndex === index ? (sortAsc ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
          )}
          <tbody>
            {(head ? visible.map((row) => row.node) : React.Children.toArray(((body ?? fallbackBody)?.props as any)?.children ?? []))}
          </tbody>
        </table>
      </div>

      {!expanded && pageCount > 1 && (
        <div className="flex items-center justify-between border-t border-[var(--border)] px-2 py-1 text-caption text-[var(--muted)]">
          <span>
            {safePage * PAGE_SIZE + 1}–{Math.min(sorted.length, (safePage + 1) * PAGE_SIZE)} of {sorted.length}
          </span>
          <span className="flex items-center gap-1">
            <button
              onClick={() => setPage(Math.max(0, safePage - 1))}
              disabled={safePage === 0}
              className="rounded px-1.5 py-0.5 transition hover:bg-[var(--hover)] disabled:opacity-40"
            >
              Previous
            </button>
            <button
              onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
              disabled={safePage >= pageCount - 1}
              className="rounded px-1.5 py-0.5 transition hover:bg-[var(--hover)] disabled:opacity-40"
            >
              Next
            </button>
          </span>
        </div>
      )}
    </div>
  );
}

const MarkdownBlock = memo(function MarkdownBlock({ source }: { source: string }) {
  return (
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap break-words">{children}</p>,
          a: ({ href, children }) => {
            // A link the model wrote may point anywhere, and clicking it is the
            // one way a poisoned reply escapes the chat. Show where it goes.
            let host = "";
            try {
              host = new URL(String(href ?? "")).hostname.replace(/^www\./, "");
            } catch {
              host = "";
            }
            if (!host) {
              return <span className="font-medium text-accent">{children}</span>;
            }
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                title={`Opens ${host} in a new tab`}
                className="font-medium text-accent underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
              >
                {children}
                <span className="ml-1 align-baseline text-caption font-normal text-[var(--muted)] no-underline">{host}</span>
              </a>
            );
          },
          strong: ({ children }) => <strong className="font-semibold text-[var(--text)]">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          ul: ({ children }) => <ul className="ml-4 list-disc space-y-1 marker:text-[var(--muted)]">{children}</ul>,
          ol: ({ children }) => <ol className="ml-4 list-decimal space-y-1 marker:text-[var(--muted)]">{children}</ol>,
          li: ({ children }) => <li className="break-words pl-0.5">{children}</li>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-accent/40 pl-3 text-[var(--muted)]">{children}</blockquote>
          ),
          h1: ({ children }) => <h3 className="mt-3 mb-1 font-display text-[15px] font-bold">{children}</h3>,
          h2: ({ children }) => <h4 className="mt-3 mb-1 font-display text-[14px] font-bold">{children}</h4>,
          h3: ({ children }) => <h5 className="mt-3 mb-1 text-prose font-bold">{children}</h5>,
          hr: () => <hr className="my-3 border-[var(--border)]" />,
          // `pre` is unwrapped so the code renderer owns the whole block chrome.
          pre: ({ children }) => <>{children}</>,
          code: ({ className, children }) => {
            const text = String(children ?? "").replace(/\n$/, "");
            const language = /language-([\w+-]+)/.exec(className ?? "")?.[1] ?? "";
            const isBlock = Boolean(className?.includes("language-")) || text.includes("\n");
            if (!isBlock) {
              return (
                <code className="rounded bg-[var(--surface-2)] px-1 py-0.5 font-mono text-body text-[var(--text)]">{text}</code>
              );
            }
            return <CodeBlock code={text} language={language} />;
          },
          img: ({ src, alt }) => {
            // Loading a remote image is an outbound request that can leak that
            // the message was read, so it takes an explicit click.
            let host = "";
            try {
              host = new URL(String(src ?? "")).hostname.replace(/^www\./, "");
            } catch {
              host = "";
            }
            return (
              <a
                href={typeof src === "string" ? src : undefined}
                target="_blank"
                rel="noopener noreferrer"
                referrerPolicy="no-referrer"
                className="my-1 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-meta text-[var(--muted)] transition hover:text-[var(--text)]"
              >
                <ImageIcon size={11} /> {alt || "Image"} {host ? <span className="text-caption">· {host}</span> : null}
              </a>
            );
          },
          table: ({ children }) => <TableCard>{children}</TableCard>,
          thead: function MdThead({ children }: { children?: React.ReactNode }) {
            return <thead className="sticky top-0 z-10 bg-[var(--surface-2)]">{children}</thead>;
          },
          th: ({ children }) => (
            <th className="border-b border-[var(--border)] px-2.5 py-1.5 text-left font-semibold text-[var(--text)]">{children}</th>
          ),
          td: ({ children }) => <td className="border-b border-[var(--border)]/60 px-2.5 py-1.5 align-top">{children}</td>,
        }}
      >
        {source}
      </ReactMarkdown>
  );
});

export const Markdown = memo(function Markdown({ content }: { content: string }) {
  const blocks = useMemo(() => splitBlocks(closeOpenFence(content ?? "")), [content]);
  return (
    <div className="markdown-body space-y-2 text-prose leading-[1.6]">
      {blocks.map((block, index) => (
        <MarkdownBlock key={index} source={block} />
      ))}
    </div>
  );
});
