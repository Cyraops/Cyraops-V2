/**
 * Pages must be able to leave the CRM intact.
 *
 * A Markdown export that quietly drops tables, or turns a metric row into a
 * paragraph of run-on text, is worse than no export: people send it to clients.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { pageToMarkdown } from "./to-markdown";
import { parseCsv, profileTable } from "./table-analysis";

const page = (body: string) => pageToMarkdown("Q4 pipeline brief", body);

test("to-markdown: headings, paragraphs and emphasis survive", () => {
  const md = page("<h2>What changed</h2><p>Two deals <strong>moved</strong> and one <em>stalled</em>.</p>");
  assert.match(md, /^# Q4 pipeline brief/m);
  assert.match(md, /## What changed/);
  assert.match(md, /\*\*moved\*\*/);
  assert.match(md, /_stalled_/);
});

test("to-markdown: a table becomes a pipe table with a header rule", () => {
  const md = page("<table><tr><th>Deal</th><th>Value</th></tr><tr><td>Northwind</td><td>18000</td></tr></table>");
  assert.match(md, /\| Deal \| Value \|/);
  assert.match(md, /\| --- \| --- \|/);
  assert.match(md, /\| Northwind \| 18000 \|/);
});

test("to-markdown: ragged rows are padded, not dropped", () => {
  const md = page("<table><tr><th>A</th><th>B</th><th>C</th></tr><tr><td>1</td><td>2</td></tr></table>");
  assert.match(md, /\| 1 \| 2 \|  \|/);
});

test("to-markdown: kit metrics become a bold list rather than disappearing", () => {
  const md = page('<cy-metrics><cy-metric value="4.2L" label="Pipeline" hint="+12% WoW"/><cy-metric value="9" label="Deals"/></cy-metrics>');
  assert.match(md, /- \*\*4\.2L\*\* Pipeline \(% WoW\)|- \*\*4\.2L\*\* Pipeline/);
  assert.match(md, /- \*\*9\*\* Deals/);
});

test("to-markdown: a callout becomes a blockquote and keeps the title", () => {
  const md = page('<cy-callout tone="warn" title="Heads up">Two deals are stalled.</cy-callout>');
  assert.match(md, /> \*\*Heads up\*\*/);
  assert.match(md, /> Two deals are stalled\./);
});

test("to-markdown: charts become readable lists of label and value", () => {
  const md = page('<cy-bars values="12,8,5" labels="New,Qualified,Won"/>');
  assert.match(md, /- New: 12/);
  assert.match(md, /- Won: 5/);
});

test("to-markdown: code blocks keep their content and are not parsed as prose", () => {
  const md = page("<pre><code>SELECT * FROM deals\nWHERE stage = 'P</code></pre>".replace("P</code>", "PROPOSAL'</code>"));
  assert.match(md, /```/);
  assert.match(md, /SELECT \* FROM deals/);
  assert.match(md, /WHERE stage = 'PROPOSAL'/);
});

test("to-markdown: ordered and unordered lists are numbered correctly", () => {
  const md = page("<ol><li>Scope</li><li>Prove</li></ol><ul><li>Build</li><li>Run</li></ul>");
  assert.match(md, /1\. Scope\n2\. Prove/);
  assert.match(md, /- Build\n- Run/);
});

test("to-markdown: links and empty paragraphs", () => {
  const md = page('<p>See <a href="https://www.cyraops.com/about">about</a>.</p><p></p>');
  assert.match(md, /\[about\]\(https:\/\/www\.cyraops\.com\/about\)/);
  assert.doesNotMatch(md, /\n\n\n\n/);
});

test("to-markdown: never throws on malformed markup", () => {
  assert.doesNotThrow(() => page("<table><tr><td>unclosed"));
  assert.doesNotThrow(() => page("<<<>>>"));
  assert.doesNotThrow(() => page(""));
});

test("parseCsv: quotes, escaped quotes, CRLF and embedded newlines", () => {
  const rows = parseCsv('name,note\r\n"Acme, Inc.","He said ""go"""\r\n"multi\nline",x\r\n');
  assert.deepEqual(rows[0], ["name", "note"]);
  assert.deepEqual(rows[1], ["Acme, Inc.", 'He said "go"']);
  assert.deepEqual(rows[2], ["multi\nline", "x"]);
});

test("profileTable: infers types and computes real statistics", () => {
  const matrix = [
    ["deal", "value", "stage", "closed"],
    ["Northwind", "18000", "PROPOSAL", "2026-01-05"],
    ["Acme", "42,500", "WON", "2026-02-11"],
    ["Globex", "", "LOST", ""],
  ];
  const profile = profileTable("deals", matrix);
  const value = profile.columns_profile.find((c) => c.name === "value")!;
  const stage = profile.columns_profile.find((c) => c.name === "stage")!;
  const closed = profile.columns_profile.find((c) => c.name === "closed")!;

  assert.equal(profile.rows, 3);
  assert.equal(value.type, "number");
  assert.equal(value.sum, 60500);
  assert.equal(value.mean, 30250);
  assert.equal(value.filled, 2);
  assert.equal(value.empty, 1);

  assert.equal(stage.type, "text");
  assert.equal(stage.distinct, 3);

  assert.equal(closed.type, "date");
  assert.equal(closed.empty, 1);
});

test("profileTable: an empty column is reported, not crashed on", () => {
  const profile = profileTable("t", [["a", "b"], ["1", ""], ["2", ""]]);
  const b = profile.columns_profile.find((c) => c.name === "b")!;
  assert.equal(b.type, "empty");
  assert.equal(b.filled, 0);
  assert.equal(b.empty, 2);
});

test("profileTable: an empty sheet is handled", () => {
  const profile = profileTable("t", []);
  assert.equal(profile.rows, 0);
  assert.deepEqual(profile.columns_profile, []);
});
