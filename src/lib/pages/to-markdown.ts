/**
 * Page HTML -> Markdown.
 *
 * A page is worth keeping, so it has to be able to leave the CRM: paste into a
 * proposal, commit to a repo, send to a client who asked for "the document".
 * Pages are authored as HTML with the declarative kit tags, so this converts
 * both — the kit components become the Markdown constructs a reader expects
 * (a metric row becomes a bold list, a callout becomes a blockquote).
 *
 * Deliberately dependency-free and tolerant: a malformed page must still produce
 * readable text rather than throwing.
 */

const decode = (value: string) =>
  value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");

const stripTags = (value: string) => decode(value.replace(/<[^>]+>/g, "")).trim();

const inline = (value: string) =>
  decode(value)
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, (_m, _t, text) => `**${stripTags(text)}**`)
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, (_m, _t, text) => `_${stripTags(text)}_`)
    .replace(/<code>([\s\S]*?)<\/code>/gi, (_m, text) => `\`${stripTags(text)}\``)
    .replace(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, text) => `[${stripTags(text)}](${href})`)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/[ \t]+/g, " ")
    .trim();

/** Table rows -> a Markdown pipe table, with a header row derived from the first row. */
function tableToMarkdown(block: string) {
  const rows = [...block.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((m) =>
    [...m[1].matchAll(/<(th|td)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((c) => inline(c[2]).replace(/\n/g, " "))
  );
  const usable = rows.filter((r) => r.length > 0);
  if (usable.length === 0) return "";
  const width = Math.max(...usable.map((r) => r.length));
  const pad = (r: string[]) => [...r, ...Array(width - r.length).fill("")];
  const header = pad(usable[0]);
  const body = usable.slice(1).map(pad);
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function listToMarkdown(block: string, ordered: boolean) {
  const items = [...block.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map((m, index) => {
    const text = inline(m[1]).replace(/\n+/g, " ").trim();
    return ordered ? `${index + 1}. ${text}` : `- ${text}`;
  });
  return items.join("\n");
}

/** The kit tags, converted to the thing a reader of a document expects. */
function kitToMarkdown(html: string) {
  return html
    .replace(/<cy-metrics>([\s\S]*?)<\/cy-metrics>/gi, (_m, inner) => {
      const metrics = [...inner.matchAll(/<cy-metric\b([^>]*)\/?>/gi)].map((m) => {
        const attr = (name: string) => (new RegExp(`${name}="([^"]*)"`, "i").exec(m[1]) ?? [])[1] ?? "";
        const value = attr("value");
        const label = attr("label");
        const hint = attr("hint");
        return `- **${value}** ${label}${hint ? ` (${hint})` : ""}`;
      });
      return metrics.length ? `\n\n${metrics.join("\n")}\n\n` : "";
    })
    .replace(/<cy-callout\b([^>]*)>([\s\S]*?)<\/cy-callout>/gi, (_m, attrs, inner) => {
      const title = (/title="([^"]*)"/i.exec(attrs) ?? [])[1] ?? "";
      const body = inline(inner);
      return `\n\n> **${title ? stripTags(title) : "Note"}**\n> ${body}\n\n`;
    })
    .replace(/<cy-bars\b([^>]*)\/?>/gi, (_m, attrs) => {
      const values = ((/values="([^"]*)"/i.exec(attrs) ?? [])[1] ?? "").split(",");
      const labels = ((/labels="([^"]*)"/i.exec(attrs) ?? [])[1] ?? "").split(",");
      const rows = values.map((v, i) => `- ${(labels[i] ?? `Item ${i + 1}`).trim()}: ${v.trim()}`);
      return rows.length ? `\n\n${rows.join("\n")}\n\n` : "";
    })
    .replace(/<cy-line\b([^>]*)\/?>/gi, (_m, attrs) => {
      const values = ((/values="([^"]*)"/i.exec(attrs) ?? [])[1] ?? "").split(",");
      const labels = ((/labels="([^"]*)"/i.exec(attrs) ?? [])[1] ?? "").split(",");
      const rows = values.map((v, i) => `- ${(labels[i] ?? `Point ${i + 1}`).trim()}: ${v.trim()}`);
      return rows.length ? `\n\n${rows.join("\n")}\n\n` : "";
    })
    .replace(/<cy-pill\b([^>]*)>([\s\S]*?)<\/cy-pill>/gi, (_m, _a, inner) => `\`${stripTags(inner)}\``)
    .replace(/<cy-toc\b[^>]*\/?>/gi, "")
    .replace(/<\/?cy-[a-z]+\b[^>]*>/gi, "");
}

export function pageToMarkdown(title: string, content: string): string {
  let html = kitToMarkdown(String(content ?? ""));

  // Code blocks first: their contents must not be treated as prose.
  const codeBlocks: string[] = [];
  html = html.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_m, inner) => {
    codeBlocks.push(`\n\n\`\`\`\n${decode(inner.replace(/<[^>]+>/g, ""))}\n\`\`\`\n\n`);
    return `@@CODE${codeBlocks.length - 1}@@`;
  });

  html = html
    .replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (block) => `\n\n${tableToMarkdown(block)}\n\n`)
    .replace(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi, (_m, t) => `\n\n# ${inline(t)}\n\n`)
    .replace(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi, (_m, t) => `\n\n## ${inline(t)}\n\n`)
    .replace(/<h3\b[^>]*>([\s\S]*?)<\/h3>/gi, (_m, t) => `\n\n### ${inline(t)}\n\n`)
    .replace(/<h4\b[^>]*>([\s\S]*?)<\/h4>/gi, (_m, t) => `\n\n#### ${inline(t)}\n\n`)
    .replace(/<blockquote\b[^>]*>([\s\S]*?)<\/blockquote>/gi, (_m, t) => `\n\n> ${inline(t)}\n\n`)
    .replace(/<ul\b[^>]*>([\s\S]*?)<\/ul>/gi, (_m, t) => `\n\n${listToMarkdown(t, false)}\n\n`)
    .replace(/<ol\b[^>]*>([\s\S]*?)<\/ol>/gi, (_m, t) => `\n\n${listToMarkdown(t, true)}\n\n`)
    .replace(/<hr\s*\/?>/gi, "\n\n---\n\n")
    .replace(/<img\b[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, (_m, alt, src) => `\n\n![${alt}](${src})\n\n`)
    .replace(/<p\b[^>]*>([\s\S]*?)<\/p>/gi, (_m, t) => {
      const text = inline(t);
      return text ? `\n\n${text}\n\n` : "";
    })
    .replace(/<div\b[^>]*>|<\/div>|<section\b[^>]*>|<\/section>/gi, "\n")
    .replace(/@@CODE(\d+)@@/g, (_m, i) => codeBlocks[Number(i)] ?? "");

  const body = html
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const heading = title.trim() ? `# ${title.trim()}\n\n` : "";
  const footer = `\n\n---\n\n*Prepared in Cyraops CRM · ${new Date().toISOString().slice(0, 10)}*\n`;
  return `${heading}${body}${footer}`;
}
