/**
 * A small, server-rendered design kit for bot-authored pages.
 *
 * Rakazo lets a model write JSX against a 74-component React kit; that is far
 * more capable, but it requires executing model code in a browser. We take the
 * useful 20% instead: a handful of declarative tags the model can write, which
 * we expand into styled HTML and inline SVG *on the server*. A page therefore
 * still needs no scripts at all, and it looks designed rather than hand-styled.
 *
 * Tags (self-closing, attributes only):
 *   <cy-metric value="4.2L" label="Pipeline" hint="+12% WoW"/>
 *   <cy-metrics>…one or more cy-metric…</cy-metrics>
 *   <cy-bars values="12,8,5" labels="New,Qualified,Won"/>
 *   <cy-line values="3,6,4,9" labels="Mon,Tue,Wed,Thu"/>
 *   <cy-callout tone="warn|info|good" title="Careful">Body text</cy-callout>
 *   <cy-pill tone="good|warn|bad">Paid</cy-pill>
 */

const ALLOWED_TONES = new Set(["good", "warn", "bad", "info"]);

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i").exec(tag);
  return match ? match[1] : "";
}

function numbers(raw: string): number[] {
  return String(raw ?? "")
    .split(/[,\s]+/)
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value));
}

function labels(raw: string): string[] {
  return String(raw ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function metricCard(value: string, label: string, hint: string): string {
  return `<div class="cy-metric"><div class="cy-metric-value">${escapeHtml(value)}</div><div class="cy-metric-label">${escapeHtml(
    label
  )}</div>${hint ? `<div class="cy-metric-hint">${escapeHtml(hint)}</div>` : ""}</div>`;
}

/** Horizontal bars: the honest choice when labels are words rather than dates. */
function barsSvg(values: number[], names: string[]): string {
  if (!values.length) return "";
  const max = Math.max(...values, 1);
  const rows = values
    .map((value, index) => {
      const width = Math.max(2, Math.round((value / max) * 100));
      const name = names[index] ?? `#${index + 1}`;
      return `<div class="cy-bar-row"><span class="cy-bar-name">${escapeHtml(name)}</span><span class="cy-bar-track"><span class="cy-bar-fill" style="width:${width}%"></span></span><span class="cy-bar-value">${value}</span></div>`;
    })
    .join("");
  return `<div class="cy-bars">${rows}</div>`;
}

/** A line chart as inline SVG: no library, no script, scales to the container. */
function lineSvg(values: number[], names: string[]): string {
  if (values.length < 2) return "";
  const width = 640;
  const height = 160;
  const padding = 8;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const span = max - min || 1;

  const points = values.map((value, index) => {
    const x = padding + (index / (values.length - 1)) * (width - padding * 2);
    const y = height - padding - ((value - min) / span) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const area = `${padding},${height - padding} ${points.join(" ")} ${width - padding},${height - padding}`;
  const labelRow = names.length
    ? `<div class="cy-line-labels">${names.map((name) => `<span>${escapeHtml(name)}</span>`).join("")}</div>`
    : "";

  return `<div class="cy-line"><svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Trend"><polygon points="${area}" fill="rgba(91,75,214,.12)"/><polyline points="${points.join(
    " "
  )}" fill="none" stroke="#5b4bd6" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/></svg>${labelRow}</div>`;
}

export function renderKit(html: string): string {
  let output = String(html ?? "");

  // Metrics: expand a container of metric tags, then any stragglers.
  output = output.replace(/<cy-metrics>([\s\S]*?)<\/cy-metrics>/gi, (_match, inner: string) => {
    const cards = [...inner.matchAll(/<cy-metric\b([^>]*)\/?>/gi)].map((entry) =>
      metricCard(attr(entry[1], "value"), attr(entry[1], "label"), attr(entry[1], "hint"))
    );
    return `<div class="cy-metrics">${cards.join("")}</div>`;
  });
  output = output.replace(/<cy-metric\b([^>]*)\/?>/gi, (_match, raw: string) =>
    metricCard(attr(raw, "value"), attr(raw, "label"), attr(raw, "hint"))
  );

  output = output.replace(/<cy-bars\b([^>]*)\/?>/gi, (_match, raw: string) =>
    barsSvg(numbers(attr(raw, "values")), labels(attr(raw, "labels")))
  );
  output = output.replace(/<cy-line\b([^>]*)\/?>/gi, (_match, raw: string) =>
    lineSvg(numbers(attr(raw, "values")), labels(attr(raw, "labels")))
  );

  output = output.replace(
    /<cy-callout\b([^>]*)>([\s\S]*?)<\/cy-callout>/gi,
    (_match, raw: string, body: string) => {
      const tone = ALLOWED_TONES.has(attr(raw, "tone")) ? attr(raw, "tone") : "info";
      const title = attr(raw, "title");
      return `<div class="cy-callout cy-tone-${tone}">${title ? `<b>${escapeHtml(title)}</b>` : ""}<div>${body}</div></div>`;
    }
  );

  output = output.replace(/<cy-pill\b([^>]*)>([\s\S]*?)<\/cy-pill>/gi, (_match, raw: string, body: string) => {
    const tone = ALLOWED_TONES.has(attr(raw, "tone")) ? attr(raw, "tone") : "info";
    return `<span class="cy-pill cy-tone-${tone}">${body}</span>`;
  });

  // A figure with an optional caption. Only ordinary http(s) sources; anything
  // else is dropped rather than rendered as a broken or dangerous image.
  output = output.replace(/<cy-figure\b([^>]*)\/?>/gi, (_match, raw: string) => {
    const src = attr(raw, "src");
    if (!/^https?:\/\//i.test(src)) return "";
    const alt = attr(raw, "alt");
    const caption = attr(raw, "caption");
    return `<figure class="cy-figure"><img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" />${
      caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""
    }</figure>`;
  });

  output = output.replace(/<cy-code\b([^>]*)>([\s\S]*?)<\/cy-code>/gi, (_match, raw: string, body: string) => {
    const language = attr(raw, "lang");
    return `<pre class="cy-code"${language ? ` data-lang="${escapeHtml(language)}"` : ""}><code>${escapeHtml(
      body.replace(/<[^>]+>/g, "")
    )}</code></pre>`;
  });

  return output;
}

export interface TocEntry { level: number; text: string; id: string }

/**
 * Document-level pass: give headings stable ids, then fill any <cy-toc/> with a
 * contents list built from them. Rendering a table of contents needs the whole
 * document, which a per-tag replacement cannot see.
 */
export function renderDocument(html: string): string {
  let output = renderKit(html);

  const entries: TocEntry[] = [];
  output = output.replace(/<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi, (match, level: string, attrs: string, body: string) => {
    const text = body.replace(/<[^>]+>/g, "").trim();
    if (!text) return match;
    const existing = /id="([^"]+)"/i.exec(attrs)?.[1];
    const generated =
      text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || `section-${entries.length + 1}`;
    const id = existing ?? generated;
    entries.push({ level: Number(level), text, id });
    return existing ? match : `<h${level}${attrs} id="${id}">${body}</h${level}>`;
  });

  if (/<cy-toc\b[^>]*\/?>/i.test(output) && entries.length > 0) {
    const items = entries
      .map((e) => `<li class="cy-toc-l${e.level}"><a href="#${e.id}">${escapeHtml(e.text)}</a></li>`)
      .join("");
    output = output.replace(/<cy-toc\b[^>]*\/?>/gi, `<nav class="cy-toc" aria-label="Contents"><b>Contents</b><ol>${items}</ol></nav>`);
  } else {
    output = output.replace(/<cy-toc\b[^>]*\/?>/gi, "");
  }

  return output;
}

/** Styles the kit depends on, injected ahead of the author's own CSS. */
export const PAGE_KIT_CSS = `
.cy-toc{border:1px solid #e6e5f0;border-radius:12px;padding:12px 16px;margin:16px 0;background:#fbfbfe}
.cy-toc b{display:block;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#6b6880;margin-bottom:6px}
.cy-toc ol{margin:0;padding-left:18px}
.cy-toc li{margin:2px 0;font-size:13px}
.cy-toc .cy-toc-l3{margin-left:14px;font-size:12px}
.cy-toc a{color:#3f3a63;text-decoration:none}
.cy-toc a:hover{text-decoration:underline}
.cy-figure{margin:18px 0}
.cy-figure img{max-width:100%;border-radius:12px;border:1px solid #e6e5f0;display:block}
.cy-figure figcaption{margin-top:6px;font-size:12px;color:#6b6880}
.cy-code{background:#f6f6fb;border:1px solid #e6e5f0;border-radius:10px;padding:12px 14px;overflow-x:auto;font-size:12px;line-height:1.5}
.cy-code code{background:none;padding:0;font-size:12px}
.cy-metrics{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px;margin:14px 0}
.cy-metric{border:1px solid #e6e5f0;border-radius:12px;padding:12px 14px;background:#fbfbfe}
.cy-metric-value{font-size:22px;font-weight:700;letter-spacing:-.02em;color:#16151f}
.cy-metric-label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:#6b6880;margin-top:2px}
.cy-metric-hint{font-size:11px;color:#5b4bd6;margin-top:4px}
.cy-bars{margin:14px 0;display:flex;flex-direction:column;gap:8px}
.cy-bar-row{display:grid;grid-template-columns:minmax(70px,26%) 1fr auto;align-items:center;gap:10px;font-size:12px}
.cy-bar-name{color:#43414f;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cy-bar-track{background:#eeeef6;border-radius:999px;height:8px;overflow:hidden}
.cy-bar-fill{display:block;height:100%;background:linear-gradient(90deg,#6d5ee8,#8b7ef0);border-radius:999px}
.cy-bar-value{font-variant-numeric:tabular-nums;color:#6b6880}
.cy-line{margin:14px 0;border:1px solid #e6e5f0;border-radius:12px;padding:10px;background:#fbfbfe}
.cy-line svg{width:100%;height:160px;display:block}
.cy-line-labels{display:flex;justify-content:space-between;font-size:10px;color:#6b6880;margin-top:6px;gap:4px;overflow:hidden}
.cy-callout{border-radius:12px;padding:11px 14px;margin:14px 0;font-size:13px;border:1px solid #e6e5f0;background:#f7f7fb}
.cy-callout b{display:block;margin-bottom:3px;font-size:12px}
.cy-tone-good{background:#eefaf1;border-color:#bfe7c9;color:#12592b}
.cy-tone-warn{background:#fdf6e7;border-color:#f0dcae;color:#6b4a05}
.cy-tone-bad{background:#fdeeee;border-color:#f2c6c6;color:#7a1c1c}
.cy-tone-info{background:#f1f0fd;border-color:#d8d4f5;color:#3a2f8f}
.cy-pill{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;border:1px solid transparent}
`;
