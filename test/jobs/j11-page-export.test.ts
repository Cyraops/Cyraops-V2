/**
 * J11 — a page can leave the CRM.
 *
 * The report is only useful if it survives the journey: a Markdown file someone
 * can paste into a proposal, an HTML file someone can archive, and a print view
 * that produces a PDF. A report that loses its table on export is worse than no
 * export, because it looks authoritative and is wrong.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { GET as exportPage } from "../../src/app/api/pages/[id]/export/route";

const PAGE_HTML = `
<h2>What changed</h2>
<p>Two deals <strong>moved</strong>.</p>
<table><tr><th>Deal</th><th>Value</th></tr><tr><td>Northwind</td><td>18000</td></tr></table>
<cy-metrics><cy-metric value="4.2L" label="Pipeline" hint="+12%"/></cy-metrics>
<cy-callout tone="warn" title="Heads up">Two deals are stalled.</cy-callout>
<cy-toc/>
`;

async function makePage(userId: string, title = "Q4 pipeline brief") {
  return db.page.create({ data: { userId, title, content: PAGE_HTML, publicSlug: `slug-${Math.random().toString(36).slice(2)}` } });
}

test("J11: markdown export is a real file with a pipe table", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  const res = await invoke(exportPage, `/api/pages/${page.id}/export?format=md`, { params: { id: page.id }, userId: owner.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const text = String(res.body);

  assert.match(text, /^# Q4 pipeline brief/m, "the title becomes an h1");
  assert.match(text, /\| Deal \| Value \|/, "the table survives");
  assert.match(text, /\| Northwind \| 18000 \|/);
  assert.match(text, /## What changed/);
  assert.match(text, /- \*\*4\.2L\*\* Pipeline/, "kit metrics become a list");
  assert.match(text, /> \*\*Heads up\*\*/, "the callout becomes a blockquote");
});

test("J11: html export is a standalone document", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  const res = await invoke(exportPage, `/api/pages/${page.id}/export?format=html`, { params: { id: page.id }, userId: owner.id });
  assert.equal(res.status, 200);
  const html = String(res.body);
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<title>Q4 pipeline brief<\/title>/);
  assert.match(html, /class="cy-metrics"/, "kit tags are rendered, not left raw");
  assert.match(html, /id="what-changed"/, "headings carry anchors");
  assert.match(html, /class="cy-toc"/, "the contents list is built");
});

test("J11: print export opens the browser print dialog", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  const res = await invoke(exportPage, `/api/pages/${page.id}/export?format=print`, { params: { id: page.id }, userId: owner.id });
  assert.equal(res.status, 200);
  const html = String(res.body);
  assert.match(html, /window\.print\(\)/, "the print dialog is triggered");
  assert.match(html, /@page/, "an A4 page box is defined");
  assert.match(html, /@media print/, "print-specific rules exist");
  assert.match(html, /class="print-hint"/, "the on-screen hint is separate from the file");
});

test("J11: another person's page cannot be exported", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const page = await makePage(owner.id);

  const res = await invoke(exportPage, `/api/pages/${page.id}/export?format=md`, { params: { id: page.id }, userId: member.id });
  assert.equal(res.status, 404);
});

test("J11: anonymous export is refused", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  const res = await invoke(exportPage, `/api/pages/${page.id}/export?format=md`, { params: { id: page.id } });
  assert.equal(res.status, 401);
});

test("J11: an unknown format is rejected rather than guessed", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  const res = await invoke(exportPage, `/api/pages/${page.id}/export?format=docx`, { params: { id: page.id }, userId: owner.id });
  assert.equal(res.status, 400);
});

test("J11: a filename is suggested, derived from the title and today's date", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id, "Q4 Pipeline — brief / v2");

  const { NextRequest } = await import("next/server");
  const { createSession } = await import("../../src/lib/auth");
  const { token } = await createSession(owner.id);
  const response = await exportPage(
    new NextRequest(`https://test.local/api/pages/${page.id}/export?format=md`, {
      headers: { cookie: `company_session=${token}` },
    }),
    { params: Promise.resolve({ id: page.id }) }
  );
  assert.equal(response.status, 200);
  const disposition = response.headers.get("content-disposition") ?? "";
  assert.match(disposition, /attachment; filename="q4-pipeline-brief-v2-\d{4}-\d{2}-\d{2}\.md"/);
});
