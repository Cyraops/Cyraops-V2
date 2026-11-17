import { test } from "node:test";
import assert from "node:assert/strict";
import { resetDb, seedUsers, invoke, db } from "../helpers";
import { POST as createDeal, GET as listDeals } from "../../src/app/api/crm/deals/route";
import { GET as getDeal, PATCH as updateDeal } from "../../src/app/api/crm/deals/[id]/route";

// J2 — work a deal from DISCOVERY to CLOSED_WON and decide it.
// Every assertion below is a business outcome read back from Postgres.

const CHAIN = ["PROPOSAL", "NEGOTIATION", "CLOSED_WON"] as const;
const STAGE_PROBABILITY: Record<string, number> = {
  DISCOVERY: 20,
  PROPOSAL: 50,
  NEGOTIATION: 75,
  CLOSED_WON: 100,
  CLOSED_LOST: 0,
};

async function newDealId(userId: string, title = "Enterprise rollout") {
  const created = await invoke(createDeal, "/api/crm/deals", {
    method: "POST",
    userId,
    body: { title, value: 250000, sourcePlatform: "DIRECT", notes: "inbound from referral" },
  });
  assert.equal(created.status, 201, `deal creation failed: ${JSON.stringify(created.body)}`);
  const id = (created.body as any)?.deal?.id;
  assert.ok(id, "expected the create response to carry the new deal id");
  return id as string;
}

async function advance(userId: string, dealId: string, stage: string) {
  return invoke(updateDeal, `/api/crm/deals/${dealId}`, {
    method: "PATCH",
    userId,
    params: { id: dealId },
    body: { stage },
  });
}

test("a created deal lands in DISCOVERY, owned by its creator, with a creation activity", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const before = Date.now();

  const created = await invoke(createDeal, "/api/crm/deals", {
    method: "POST",
    userId: owner.id,
    body: { title: "Enterprise rollout", value: 250000, sourcePlatform: "DIRECT" },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const dealId = (created.body as any)?.deal?.id as string;
  assert.ok(dealId, "expected a deal id");

  // The API response must match the row it claims to have written.
  const row = await db.deal.findUnique({ where: { id: dealId } });
  assert.ok(row, "deal row must exist in the database");
  assert.equal(row!.stage, "DISCOVERY");
  assert.equal(row!.value, 250000);
  assert.equal(row!.ownerId, owner.id, "creator should own the deal");
  assert.equal(row!.probability, STAGE_PROBABILITY.DISCOVERY, "DISCOVERY should default to 20% probability");
  assert.equal(row!.archivedAt, null);

  const activities = await db.activity.findMany({
    where: { entity: "deal", entityId: dealId },
    include: { user: true },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(activities.length, 1, "creating a deal must log exactly one activity");
  assert.equal(activities[0].action, "created");
  assert.equal(activities[0].userId, owner.id);
  assert.equal(activities[0].user.name, owner.name);
  assert.ok(
    activities[0].createdAt.getTime() >= before - 5000 && activities[0].createdAt.getTime() <= Date.now() + 5000,
    "activity must be stamped with the real clock time"
  );
});

test("DISCOVERY -> PROPOSAL -> NEGOTIATION -> CLOSED_WON persists at every stage", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const dealId = await newDealId(owner.id);

  let expectedFrom = "DISCOVERY";
  for (const stage of CHAIN) {
    const patched = await advance(owner.id, dealId, stage);
    assert.equal(patched.status, 200, `moving ${expectedFrom} -> ${stage} failed: ${JSON.stringify(patched.body)}`);
    assert.equal((patched.body as any)?.deal?.stage, stage, "PATCH response should report the new stage");

    // 1) the write really hit Postgres
    const row = await db.deal.findUnique({ where: { id: dealId } });
    assert.equal(row!.stage, stage, `${stage} must persist in the database`);
    assert.equal(row!.probability, STAGE_PROBABILITY[stage], `stage ${stage} should carry its default probability`);

    // 2) and it survives an independent read from the API (no in-request caching)
    const fetched = await invoke(getDeal, `/api/crm/deals/${dealId}`, {
      userId: owner.id,
      params: { id: dealId },
    });
    assert.equal(fetched.status, 200, JSON.stringify(fetched.body));
    assert.equal((fetched.body as any)?.deal?.stage, stage, `GET must serve stage ${stage}`);

    // 3) and it shows up in the pipeline listing under that stage
    const listed = await invoke(listDeals, `/api/crm/deals?stage=${stage}`, { userId: owner.id });
    assert.equal(listed.status, 200, JSON.stringify(listed.body));
    const listedDeals = (listed.body as any)?.deals ?? [];
    assert.ok(
      listedDeals.some((d: any) => d.id === dealId && d.stage === stage),
      `deal should be listed in the ${stage} pipeline column`
    );

    expectedFrom = stage;
  }

  const finalRow = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(finalRow!.stage, "CLOSED_WON");
  assert.equal(finalRow!.probability, 100, "a won deal should be at 100% probability");
});

test("a stage value outside the pipeline is rejected and leaves the deal untouched", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const dealId = await newDealId(owner.id);

  // Walk to NEGOTIATION so we have a real in-flight deal to protect.
  assert.equal((await advance(owner.id, dealId, "PROPOSAL")).status, 200);
  assert.equal((await advance(owner.id, dealId, "NEGOTIATION")).status, 200);

  const before = await db.deal.findUnique({ where: { id: dealId } });
  const activityCountBefore = await db.activity.count({ where: { entity: "deal", entityId: dealId } });

  // A stage outside the enum must be refused, not silently persisted.
  for (const bogus of ["WON", "proposal", "PURPLE", "", "CLOSED-WON"]) {
    const rejected = await advance(owner.id, dealId, bogus);
    assert.equal(
      rejected.status,
      400,
      `stage "${bogus}" must be rejected with 400, got ${rejected.status}: ${JSON.stringify(rejected.body)}`
    );
    assert.ok((rejected.body as any)?.error, "rejection should carry an error message");
  }

  const after = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(after!.stage, "NEGOTIATION", "rejected stage values must not change the stage");
  assert.equal(after!.updatedAt.getTime(), before!.updatedAt.getTime(), "rejected updates must not touch the row");
  assert.equal(
    await db.activity.count({ where: { entity: "deal", entityId: dealId } }),
    activityCountBefore,
    "rejected updates must not write an activity row"
  );

  // Re-sending the current stage is not a transition and must still succeed.
  const noop = await advance(owner.id, dealId, "NEGOTIATION");
  assert.equal(noop.status, 200, JSON.stringify(noop.body));
  const afterNoop = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(afterNoop!.stage, "NEGOTIATION");
});

test("pipeline-illegal moves are rejected: skipping stages and reopening a closed deal", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const dealId = await newDealId(owner.id, "Illegal move probe");

  // The pipeline only advances one stage at a time (the UI only ever sends
  // DEAL_STAGES[idx + 1]), so the API must not let a client jump straight from
  // DISCOVERY to a won deal and skip qualification + negotiation.
  const skip = await advance(owner.id, dealId, "CLOSED_WON");
  assert.equal(
    skip.status,
    400,
    `DISCOVERY -> CLOSED_WON must be rejected as an invalid transition, got ${skip.status}: ${JSON.stringify(skip.body)}`
  );
  assert.equal(
    (await db.deal.findUnique({ where: { id: dealId } }))!.stage,
    "DISCOVERY",
    "a rejected skip must not move the deal"
  );

  // Walk the deal properly to CLOSED_WON, then try to silently reopen it.
  for (const stage of CHAIN) {
    assert.equal((await advance(owner.id, dealId, stage)).status, 200);
  }
  const reopened = await advance(owner.id, dealId, "DISCOVERY");
  assert.equal(
    reopened.status,
    400,
    `CLOSED_WON -> DISCOVERY (reopening a decided deal) must be rejected, got ${reopened.status}: ${JSON.stringify(reopened.body)}`
  );

  const row = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(row!.stage, "CLOSED_WON", "a decided deal must stay decided");
  assert.equal(row!.probability, 100, "a decided deal must stay at 100% probability");
});

test("activity rows record who moved the deal and when, for every step", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await newDealId(owner.id, "Who/when audit deal");

  const startedAt = new Date();

  for (const stage of CHAIN) {
    const patched = await advance(owner.id, dealId, stage);
    assert.equal(patched.status, 200, JSON.stringify(patched.body));
  }

  // A member's own deal moved by that member must be attributed to the member.
  const memberCreated = await invoke(createDeal, "/api/crm/deals", {
    method: "POST",
    userId: member.id,
    body: { title: "Member owned deal", value: 1000 },
  });
  assert.equal(memberCreated.status, 201, JSON.stringify(memberCreated.body));
  const memberDealId = (memberCreated.body as any)?.deal?.id as string;
  const memberPatch = await advance(member.id, memberDealId, "PROPOSAL");
  assert.equal(memberPatch.status, 200, JSON.stringify(memberPatch.body));

  const activities = await db.activity.findMany({
    where: { entity: "deal", entityId: dealId },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { createdAt: "asc" },
  });

  // 1 create + 3 stage moves, and nothing else.
  assert.equal(activities.length, 4, `expected 4 activity rows, got ${activities.length}`);

  assert.equal(activities[0].action, "created");
  assert.equal(activities[0].userId, owner.id, "creation must be attributed to the creator");

  const stageActions = activities.slice(1);
  const expectedTransitions: Array<[string, string]> = [
    ["DISCOVERY", "PROPOSAL"],
    ["PROPOSAL", "NEGOTIATION"],
    ["NEGOTIATION", "CLOSED_WON"],
  ];
  stageActions.forEach((row, i) => {
    const [from, to] = expectedTransitions[i];
    assert.equal(row.userId, owner.id, `activity ${i + 1} must record the acting user`);
    assert.equal(row.user?.name, owner.name, "activity must resolve back to the acting user's name");
    assert.match(
      row.summary,
      new RegExp(`${from}\\b.*\\b${to}`),
      `activity ${i + 1} summary should narrate ${from} -> ${to}, got: ${row.summary}`
    );
    assert.ok(row.createdAt instanceof Date && !Number.isNaN(row.createdAt.getTime()), "activity needs a timestamp");
    assert.ok(
      row.createdAt.getTime() >= startedAt.getTime() - 5000,
      `activity timestamp ${row.createdAt.toISOString()} should be from this run`
    );
    if (i > 0) {
      assert.ok(
        row.createdAt.getTime() >= stageActions[i - 1].createdAt.getTime(),
        "activity rows must be appended in chronological order"
      );
    }
  });

  // The same rows are what the deal detail screen renders.
  const detail = await invoke(getDeal, `/api/crm/deals/${dealId}`, { userId: owner.id, params: { id: dealId } });
  assert.equal(detail.status, 200, JSON.stringify(detail.body));
  const apiActivities = (detail.body as any)?.activities ?? [];
  assert.equal(apiActivities.length, 4, "deal detail must expose the full history");
  assert.equal(apiActivities[0].action, "updated", "history is newest-first");
  assert.equal(apiActivities[0].user?.id, owner.id, "history must name the actor");
  assert.equal(apiActivities[3].action, "created");

  // The member's transition is attributed to the member, not to the owner.
  const memberActivity = await db.activity.findFirst({
    where: { entity: "deal", entityId: memberDealId, action: "updated" },
    include: { user: { select: { id: true, name: true } } },
  });
  assert.ok(memberActivity, "member's own stage move must be logged");
  assert.equal(memberActivity!.userId, member.id);
  assert.equal(memberActivity!.user.name, member.name);
});

test("the pipeline is shared: a member sees every deal, filters included", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownersDealId = await newDealId(owner.id, "Owner pipeline deal");
  const membersDealId = await newDealId(member.id, "Member pipeline deal");

  const list = await invoke(listDeals, "/api/crm/deals", { userId: member.id });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const deals = (list.body as any)?.deals ?? [];
  const ids = deals.map((d: any) => d.id);

  // Everyone works from one board. Visibility widened; authority did not (see
  // "cannot advance a deal owned by someone else" below).
  assert.ok(ids.includes(membersDealId), "a member sees their own deals");
  assert.ok(ids.includes(ownersDealId), "a member sees the rest of the pipeline");
  assert.equal((list.body as any)?.total, 2, `the shared pipeline total must count every deal, got ${(list.body as any)?.total}`);

  // Filters narrow that shared view rather than gating it.
  const filtered = await invoke(listDeals, `/api/crm/deals?ownerId=${owner.id}`, { userId: member.id });
  assert.equal(filtered.status, 200, JSON.stringify(filtered.body));
  const filteredIds = ((filtered.body as any)?.deals ?? []).map((d: any) => d.id);
  assert.deepEqual(filteredIds, [ownersDealId], "?ownerId must select that owner's deals and nothing else");

  const search = await invoke(listDeals, "/api/crm/deals?q=Owner%20pipeline", { userId: member.id });
  assert.equal(search.status, 200, JSON.stringify(search.body));
  const searchIds = ((search.body as any)?.deals ?? []).map((d: any) => d.id);
  assert.ok(searchIds.includes(ownersDealId), "search covers the shared pipeline");
  assert.ok(!searchIds.includes(membersDealId), "search still filters by the query");
});

test("a member can open another user's deal detail but cannot change it", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await newDealId(owner.id, "Owner only deal");

  const detail = await invoke(getDeal, `/api/crm/deals/${dealId}`, { userId: member.id, params: { id: dealId } });
  assert.equal(detail.status, 200, `a member must be able to open a pipeline deal: ${JSON.stringify(detail.body)}`);
  assert.equal((detail.body as any)?.deal?.id, dealId);

  // Reading is not writing: the PATCH that follows must still be refused and the
  // row must be untouched.
  const edit = await invoke(updateDeal, `/api/crm/deals/${dealId}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: dealId },
    body: { notes: "member was here" },
  });
  assert.ok(edit.status === 403 || edit.status === 404, `a member must not edit another user's deal, got ${edit.status}`);
  const row = await db.deal.findUnique({ where: { id: dealId } });
  assert.ok(!String(row?.notes ?? "").includes("member was here"), "the refused edit must not be written");
});

test("a member cannot advance a deal owned by someone else", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const dealId = await newDealId(owner.id, "Owner only deal");

  const patch = await invoke(updateDeal, `/api/crm/deals/${dealId}`, {
    method: "PATCH",
    userId: member.id,
    params: { id: dealId },
    body: { stage: "CLOSED_WON" },
  });
  assert.equal(patch.status, 403, `a member must not advance another user's deal: ${JSON.stringify(patch.body)}`);

  const row = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(row!.stage, "DISCOVERY", "the blocked request must not change the stage");
  assert.equal(
    await db.activity.count({ where: { entity: "deal", entityId: dealId, userId: member.id } }),
    0,
    "the blocked request must not be attributed to the member"
  );
});

test("deal endpoints refuse unauthenticated callers", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const dealId = await newDealId(owner.id);

  const noAuthCreate = await invoke(createDeal, "/api/crm/deals", { method: "POST", body: { title: "Anon deal" } });
  assert.equal(noAuthCreate.status, 401, JSON.stringify(noAuthCreate.body));

  const noAuthList = await invoke(listDeals, "/api/crm/deals");
  assert.equal(noAuthList.status, 401, JSON.stringify(noAuthList.body));

  const noAuthPatch = await invoke(updateDeal, `/api/crm/deals/${dealId}`, {
    method: "PATCH",
    params: { id: dealId },
    body: { stage: "CLOSED_WON" },
  });
  assert.equal(noAuthPatch.status, 401, JSON.stringify(noAuthPatch.body));

  const row = await db.deal.findUnique({ where: { id: dealId } });
  assert.equal(row!.stage, "DISCOVERY", "anonymous calls must not advance a deal");
  assert.equal(await db.deal.count({ where: { title: "Anon deal" } }), 0, "anonymous calls must not create deals");
});
