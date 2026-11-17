/**
 * J17 — templates you can clone, bots you own.
 *
 * The six shipped agents are starting points, not records: they cannot be
 * renamed or deleted, so "start from Sales Agent" means the same thing
 * tomorrow. A bot cloned from one is yours to edit and retire.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resetDb, seedUsers, invoke, db } from "../helpers";
import { POST as createAgent } from "../../src/app/api/ai/agents/route";
import { PATCH as editAgent, DELETE as retireAgent } from "../../src/app/api/ai/agents/[id]/route";

async function templates() {
  const { owner } = await seedUsers();
  const tpl = await db.aiAgent.create({
    data: {
      slug: "sales", name: "Sales Agent", role: "Pipeline", description: "Pipelines and outreach",
      systemPrompt: "You are the Sales Agent.", status: "ACTIVE", isTemplate: true,
      tools: JSON.stringify(["search_deals", "create_deal"]), permissions: "[]",
    },
  });
  return { owner, tpl };
}

test("J17: a blank bot can be created and starts with no abilities", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const res = await invoke(createAgent, "/api/ai/agents", {
    method: "POST", userId: owner.id,
    body: { name: "Alarm Triage", role: "Watches alarms", tools: [] },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const agent = (res.body as any).agent;
  assert.equal(agent.name, "Alarm Triage");
  assert.equal(agent.isTemplate, false);
  assert.deepEqual(JSON.parse(agent.tools), []);
});

test("J17: a bot cloned from a template copies its wording and abilities", async () => {
  await resetDb();
  const { owner } = await templates();

  const res = await invoke(createAgent, "/api/ai/agents", {
    method: "POST", userId: owner.id,
    body: { name: "My Sales Bot", role: "Outbound", templateSlug: "sales" },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const agent = (res.body as any).agent;
  assert.equal(agent.systemPrompt, "You are the Sales Agent.");
  assert.deepEqual(JSON.parse(agent.tools), ["search_deals", "create_deal"]);
  assert.equal(agent.isTemplate, false, "the copy is an ordinary bot");
});

test("J17: an unknown ability is refused rather than silently dropped", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const res = await invoke(createAgent, "/api/ai/agents", {
    method: "POST", userId: owner.id,
    body: { name: "Bad", role: "x", tools: ["search_deals", "launch_missiles"] },
  });
  assert.equal(res.status, 400);
  assert.match(JSON.stringify(res.body), /launch_missiles/);
});

test("J17: a template cannot be edited or retired", async () => {
  await resetDb();
  const { owner, tpl } = await templates();

  const edit = await invoke(editAgent, `/api/ai/agents/${tpl.id}`, {
    method: "PATCH", userId: owner.id, params: { id: tpl.id }, body: { name: "Renamed" },
  });
  assert.equal(edit.status, 409);
  assert.equal((await db.aiAgent.findUniqueOrThrow({ where: { id: tpl.id } })).name, "Sales Agent");

  const gone = await invoke(retireAgent, `/api/ai/agents/${tpl.id}`, {
    method: "DELETE", userId: owner.id, params: { id: tpl.id },
  });
  assert.equal(gone.status, 409);
  assert.equal(await db.aiAgent.count(), 1);
});

test("J17: a bot you own can be renamed, re-scoped and retired", async () => {
  await resetDb();
  const { owner } = await templates();
  const created = await invoke(createAgent, "/api/ai/agents", {
    method: "POST", userId: owner.id,
    body: { name: "My Bot", role: "Anything", templateSlug: "sales" },
  });
  const id = (created.body as any).agent.id;

  const edited = await invoke(editAgent, `/api/ai/agents/${id}`, {
    method: "PATCH", userId: owner.id, params: { id },
    body: { name: "Alarm Triage", tools: ["search_tasks", "update_task"], systemPrompt: "Triage alarms." },
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  const stored = await db.aiAgent.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.name, "Alarm Triage");
  assert.deepEqual(JSON.parse(stored.tools), ["search_tasks", "update_task"]);
  assert.equal(stored.systemPrompt, "Triage alarms.");

  const retired = await invoke(retireAgent, `/api/ai/agents/${id}`, { method: "DELETE", userId: owner.id, params: { id } });
  assert.equal(retired.status, 200, JSON.stringify(retired.body));
  assert.equal(await db.aiAgent.count({ where: { id } }), 0);
});

test("J17: a bot with history is paused instead of deleted", async () => {
  await resetDb();
  const { owner } = await templates();
  const created = await invoke(createAgent, "/api/ai/agents", {
    method: "POST", userId: owner.id, body: { name: "Busy Bot", role: "Work" },
  });
  const id = (created.body as any).agent.id;
  const skill = await db.aiSkill.create({ data: { name: "s", slug: "s", description: "d", instructions: "i" } });
  await db.aiRoutine.create({ data: { name: "r", cronExpression: "0 9 * * *", skillId: skill.id, agentId: id } });

  const retired = await invoke(retireAgent, `/api/ai/agents/${id}`, { method: "DELETE", userId: owner.id, params: { id } });
  assert.equal(retired.status, 200, JSON.stringify(retired.body));
  assert.equal((retired.body as any).retired, "paused");
  const stored = await db.aiAgent.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.status, "PAUSED", "history keeps the row");
});

test("J17: a member cannot create or edit bots", async () => {
  await resetDb();
  const { member } = await seedUsers();
  const created = await invoke(createAgent, "/api/ai/agents", {
    method: "POST", userId: member.id, body: { name: "Sneaky", role: "x" },
  });
  assert.equal(created.status, 403);
});
