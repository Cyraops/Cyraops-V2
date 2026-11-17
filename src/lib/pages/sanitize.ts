/**
 * Pages are HTML authored by the assistant, so the content is untrusted by the
 * time it reaches a browser. The real boundary is the sandboxed iframe the page
 * renders inside (no allow-same-origin, no allow-scripts); this sanitiser is the
 * second layer, removing the active content that has no business in a document.
 */

import { PAGE_KIT_CSS, renderDocument } from "./kit";

const MAX_CONTENT = 400_000;

/**
 * Models frequently wrap HTML in a markdown fence even when asked for raw
 * markup. Unwrapping it here means a fence never shows up as literal text in
 * the rendered page.
 */
export function unwrapHtmlFence(input: string): string {
  const text = String(input ?? "").trim();
  const fenced = /^```(?:html|HTML)?\s*\n([\s\S]*?)\n?```$/.exec(text);
  const body = fenced ? fenced[1] : text;
  return body.trim();
}

export function sanitizePageHtml(input: string): string {
  let html = unwrapHtmlFence(input).slice(0, MAX_CONTENT);

  // Drop script/style-less active containers wholesale.
  html = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  html = html.replace(/<script\b[^>]*\/?>/gi, "");
  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe\s*>/gi, "");
  html = html.replace(/<object\b[^>]*>[\s\S]*?<\/object\s*>/gi, "");
  html = html.replace(/<embed\b[^>]*\/?>/gi, "");
  html = html.replace(/<form\b[^>]*>[\s\S]*?<\/form\s*>/gi, "");
  html = html.replace(/<(link|meta)\b[^>]*>/gi, "");

  // Inline event handlers (onclick=, onerror=, ...).
  html = html.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "");
  html = html.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "");
  html = html.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "");

  // Any javascript:/data: URL that could execute on click.
  html = html.replace(/(href|src|xlink:href)\s*=\s*(["'])\s*(javascript|vbscript|data:text\/html)[^"']*\2/gi, '$1="#"');

  // formaction is only meaningful inside forms, which are already stripped.
  html = html.replace(/\s+formaction\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");

  // Declarative kit tags become styled HTML and inline SVG here, so a page
  // looks designed without ever shipping a script to the viewer.
  // Whole-document pass: heading anchors and the contents list need every
  // heading in view, which a per-tag replacement cannot see.
  return renderDocument(html);
}

/** Wrap page HTML in a standalone document for the public share route. */
export function renderStandalonePage(title: string, content: string): string {
  const safeTitle = title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex" />
<title>${safeTitle}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #16151f; background: #f6f6fb; line-height: 1.6;
  }
  main { max-width: 900px; margin: 0 auto; background: #fff; border: 1px solid #e6e5f0;
    border-radius: 16px; padding: 28px 32px; box-shadow: 0 1px 2px rgba(16,15,40,.04); }
  ${PAGE_KIT_CSS}
  h1 { font-size: 24px; margin: 0 0 4px; }
  h2 { font-size: 18px; margin: 24px 0 8px; }
  h3 { font-size: 15px; margin: 20px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
  th, td { border-bottom: 1px solid #eceaf4; padding: 8px 10px; text-align: left; }
  th { background: #f6f6fb; font-weight: 600; }
  code { background: #f2f1f8; padding: 1px 5px; border-radius: 5px; font-size: 12px; }
  pre { background: #f6f6fb; padding: 12px 14px; border-radius: 10px; overflow-x: auto; }
  .cyraops-footer { max-width: 900px; margin: 14px auto 0; font-size: 11px; color: #6b6880; text-align: center; }
  .cyraops-footer a { color: #5b4bd6; text-decoration: none; }
</style>
</head>
<body>
<main>${content}</main>
<div class="cyraops-footer">Shared from Cyraops · <a href="https://www.cyraops.com" rel="noopener">cyraops.com</a></div>
</body>
</html>`;
}

/**
 * The same document, set up to be printed or saved as a PDF.
 *
 * PDF generation without a headless browser in the container means using the
 * print engine every browser already has. This variant removes the on-screen
 * chrome, sets A4 page size and margins, keeps headings with their content, and
 * asks the browser to open the print dialog once the page has loaded.
 */
export function renderPrintPage(title: string, content: string): string {
  const safeTitle = title.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="robots" content="noindex" />
<title>${safeTitle}</title>
<style>
  @page { size: A4; margin: 18mm 16mm 20mm; }
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0;
    font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #16151f; background: #fff; line-height: 1.55; font-size: 11.5pt;
  }
  main { max-width: 100%; }
  ${PAGE_KIT_CSS}
  h1 { font-size: 21pt; margin: 0 0 2mm; line-height: 1.2; }
  h2 { font-size: 14pt; margin: 7mm 0 2mm; line-height: 1.25; break-after: avoid; page-break-after: avoid; }
  h3 { font-size: 12pt; margin: 5mm 0 1.5mm; break-after: avoid; page-break-after: avoid; }
  p, li { orphans: 2; widows: 2; }
  table { width: 100%; border-collapse: collapse; margin: 3mm 0; font-size: 9.5pt; break-inside: avoid; page-break-inside: avoid; }
  th, td { border-bottom: 0.4pt solid #dedbe8; padding: 2mm 2.5mm; text-align: left; vertical-align: top; }
  th { background: #f4f3fa; font-weight: 600; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  code { background: #f2f1f8; padding: 0.3mm 1.2mm; border-radius: 2px; font-size: 9.5pt; }
  pre { background: #f6f6fb; padding: 3mm; border-radius: 3px; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 9.5pt; }
  blockquote { margin: 3mm 0; padding: 2mm 4mm; border-left: 2pt solid #5b4bd6; background: #f7f6fd; }
  img { max-width: 100%; height: auto; }
  .print-hint {
    position: fixed; inset: auto 0 0 0; padding: 10px 14px; background: #16151f; color: #fff;
    font: 500 12px/1.4 ui-sans-serif, system-ui, sans-serif; text-align: center;
  }
  @media print { .print-hint { display: none; } body { font-size: 10.5pt; } }
</style>
</head>
<body>
<main>${content}</main>
<div class="print-hint">Choose “Save as PDF” in the print dialog. This banner does not appear in the file.</div>
<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });</script>
</body>
</html>`;
}
