/**
 * scratch/perm-ui-e2e.mjs — real-Chrome Playwright verification of the
 * unified Permission Manager card on the settings page (UI only; the backend
 * API was verified by earlier probes).
 *
 *   (a) as owner, the card shows the four modes and workspace = CONTROLLED
 *   (b) workspace → READ_ONLY, Save, GET confirms READ_ONLY
 *   (c) agent override (sales agent if present, else first agent) → SYSTEM
 *   (d) clear the override, Save, GET shows inherit
 *   (e) restore workspace → CONTROLLED
 *   (f) screenshot-free description of the card rendering + console errors
 *
 * Usage (dev server on 3003, default env):
 *   node scratch/perm-ui-e2e.mjs
 */

import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://127.0.0.1:3003";
const OWNER_EMAIL = "tanveer@cyraops.com";
const OWNER_PASSWORD = "CyraOps-dev-2026";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[ui-probe] ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(`pageerror: ${err.message}`));

  // ---- login as owner -------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.fill('input[name="email"]', OWNER_EMAIL);
  await page.fill('input[name="password"]', OWNER_PASSWORD);
  await Promise.all([
    page.waitForURL(/dashboard/, { timeout: 30000 }),
    page.click('button:has-text("Sign in")'),
  ]);
  record("login", page.url().includes("dashboard"), `landed on ${page.url()}`);

  // ---- settings page, Permissions card --------------------------------------
  await page.goto(`${BASE}/settings`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Settings & Company Setup", { timeout: 30000 });
  await page.waitForSelector("h2:has-text('Permissions')", { timeout: 30000 });

  const card = page.locator("section", { has: page.locator("h2:text-is('Permissions')") });
  const wsSelect = card.locator('label', { hasText: "Workspace mode" }).locator("select");
  const saveButton = card.locator('button:has-text("Save permissions")');
  await wsSelect.waitFor({ timeout: 15000 });

  async function getState() {
    return await page.evaluate(async () => {
      const res = await fetch("/api/ai/permission-mode");
      return await res.json();
    });
  }

  async function saveAndWait() {
    await saveButton.click();
    await page.waitForSelector("text=effective modes updated", { timeout: 15000 });
  }

  // (a) four modes + CONTROLLED -------------------------------------------------
  const optionValues = await wsSelect.locator("option").evaluateAll((opts) => opts.map((o) => o.value));
  const optionLabels = await wsSelect.locator("option").evaluateAll((opts) => opts.map((o) => o.textContent ?? ""));
  const expectedModes = ["READ_ONLY", "CONTROLLED", "FULL_CONTROL", "SYSTEM"];
  record(
    "a-four-modes",
    JSON.stringify(optionValues) === JSON.stringify(expectedModes),
    `options=${optionValues.join(", ")}`
  );
  record(
    "a-one-line-descriptions",
    optionLabels.every((label) => label.includes("—")),
    optionLabels.join(" | ")
  );
  const initialValue = await wsSelect.inputValue();
  record("a-workspace-controlled", initialValue === "CONTROLLED", `workspace select value=${initialValue}`);

  let state = await getState();
  record(
    "a-initial-get",
    state.workspace.mode === "CONTROLLED",
    `GET ${JSON.stringify(state.workspace)}; agents=${state.agents
      .map((a) => `${a.name}:${a.mode ?? "inherit"}->${a.effective}`)
      .join(", ")}`
  );

  const rowCount = await card.locator(".divide-y > div").count();
  record("a-agent-rows", rowCount === state.agents.length, `${rowCount} rows on page vs ${state.agents.length} active agents`);

  const target = state.agents.find((a) => /sales/i.test(`${a.name} ${a.slug}`)) ?? state.agents[0];
  record("a-target-agent", Boolean(target), `override target: ${target?.name} (${target?.slug})`);

  // (b) workspace → READ_ONLY ----------------------------------------------------
  await wsSelect.selectOption("READ_ONLY");
  await saveAndWait();
  state = await getState();
  record("b-readonly-saved", state.workspace.mode === "READ_ONLY", `GET workspace.mode=${state.workspace.mode}`);

  // (c) agent override → SYSTEM --------------------------------------------------
  const agentRow = card.locator(
    `.divide-y > div:has(div.truncate:text-is("${target.name}"))`
  );
  await agentRow.locator("select").selectOption("SYSTEM");
  await saveAndWait();
  state = await getState();
  const overridden = state.agents.find((a) => a.id === target.id);
  record(
    "c-override-saved",
    overridden?.mode === "SYSTEM" && overridden?.effective === "SYSTEM",
    `GET agent=${overridden?.name} mode=${overridden?.mode} effective=${overridden?.effective}`
  );

  // (d) clear override ------------------------------------------------------------
  await agentRow.locator("select").selectOption("");
  await saveAndWait();
  state = await getState();
  const inherited = state.agents.find((a) => a.id === target.id);
  record(
    "d-override-cleared",
    inherited?.mode === null && inherited?.effective === state.workspace.mode,
    `GET agent=${inherited?.name} mode=${inherited?.mode} effective=${inherited?.effective} (workspace=${state.workspace.mode})`
  );

  // (e) restore workspace → CONTROLLED ---------------------------------------------
  await wsSelect.selectOption("CONTROLLED");
  await saveAndWait();
  state = await getState();
  record("e-restored", state.workspace.mode === "CONTROLLED", `GET workspace.mode=${state.workspace.mode}`);

  // (f) rendering description + console errors --------------------------------------
  const cardText = (await card.innerText()).split("\n");
  const agentRows = await card
    .locator(".divide-y > div")
    .evaluateAll((rows) =>
      rows.map((row) => ({
        name: row.querySelector("div.truncate")?.textContent?.trim(),
        effective: row.querySelector("div.min-w-0 > div:last-child")?.textContent?.trim(),
        selectValue: row.querySelector("select")?.value,
      }))
    );
  const relevantErrors = consoleErrors.filter((e) => !e.includes("Failed to load resource"));
  record(
    "f-console-clean",
    relevantErrors.length === 0,
    relevantErrors.length === 0
      ? "no console errors"
      : relevantErrors.join(" ;; ")
  );

  console.log("\n[ui-probe] RENDERED CARD (innerText):");
  console.log(cardText.map((line) => `    ${line}`).join("\n"));
  console.log("\n[ui-probe] AGENT ROWS:");
  for (const row of agentRows) console.log(`    ${JSON.stringify(row)}`);
  console.log("\n[ui-probe] FINAL GET STATE:");
  console.log("    " + JSON.stringify(state, null, 2));
  if (consoleErrors.length > 0) {
    console.log("\n[ui-probe] ALL CONSOLE ERRORS (incl. resource-load noise):");
    for (const err of consoleErrors) console.log(`    ${err}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n[ui-probe] SUMMARY: ${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`    FAILED: ${f.name} — ${f.detail}`);
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
