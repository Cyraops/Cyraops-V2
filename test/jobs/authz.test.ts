import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { resetDb, seedUsers, db } from "../helpers";
import { createSession } from "../../src/lib/auth";

import { GET as listPages } from "../../src/app/api/pages/route";
import { GET as getPage, PATCH as patchPage, DELETE as deletePage } from "../../src/app/api/pages/[id]/route";
import { GET as listVersions, POST as restoreVersion } from "../../src/app/api/pages/[id]/versions/route";
import { POST as sharePage } from "../../src/app/api/pages/[id]/share/route";

import { POST as uploadAttachment } from "../../src/app/api/chat/attachments/route";
import { GET as getAttachment } from "../../src/app/api/chat/attachments/[id]/route";

import {
  GET as listAssistantConversations,
  POST as createAssistantConversation,
} from "../../src/app/api/assistant/conversations/route";
import {
  PATCH as patchAssistantConversation,
  DELETE as deleteAssistantConversation,
} from "../../src/app/api/assistant/conversations/[id]/route";
import { GET as listMemories, PATCH as patchMemory, DELETE as deleteMemory } from "../../src/app/api/assistant/memories/route";
import { GET as getAssistant, PATCH as patchAssistant } from "../../src/app/api/assistant/me/route";

import { GET as listGoals, POST as createGoal } from "../../src/app/api/ai/goals/route";
import { GET as getGoal, POST as steerGoal } from "../../src/app/api/ai/goals/[id]/route";

/**
 * AUTHZ — cross-cutting ownership and CSRF on the recently added routes.
 *
 * Every file in this suite is written so that the *only* reason a call can
 * succeed is that the caller owns the row: the attacker (`member`) is a real,
 * fully-privileged teammate with a real session cookie, and the assertions are
 * read back from Postgres rather than trusted from the response body.
 */

type Handler = (request: NextRequest, context: any) => Promise<Response>;

interface CallOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
  userId?: string;
  params?: Record<string, string>;
  headers?: Record<string, string>;
}

/** A same-origin browser request, exactly what `test/helpers.invoke` sends. */
const SAME_SITE = { origin: "https://test.local", "sec-fetch-site": "same-origin" };
/**
 * A request from an attacker's page. `Host` is present because a real HTTP
 * server always supplies it, so the only thing that can make this request look
 * legitimate is the origin check itself.
 */
const FOREIGN = { origin: "https://evil.example", host: "test.local" };
/** A non-browser / legacy client: no Origin, no Referer, no Sec-Fetch-Site. */
const NO_ORIGIN = { host: "test.local" };

async function call(handler: Handler, path: string, options: CallOptions = {}) {
  const headers: Record<string, string> = { ...(options.headers ?? {}) };
  // `content-type` is deliberately not set for multipart: the FormData body
  // carries its own boundary, and overriding it would break parsing.
  if (!options.form && !headers["content-type"]) headers["content-type"] = "application/json";
  if (options.userId) {
    const { token } = await createSession(options.userId);
    headers.cookie = `company_session=${token}`;
  }
  const request = new NextRequest(new URL(`https://test.local${path}`), {
    method: options.method ?? "GET",
    headers,
    body: options.form ?? (options.body !== undefined ? JSON.stringify(options.body) : undefined),
  });
  const response = await handler(request, { params: Promise.resolve(options.params ?? {}) });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: response.status, body, text };
}

async function makePage(
  userId: string,
  overrides: { title?: string; content?: string; isPublic?: boolean } = {}
) {
  const page = await db.page.create({
    data: {
      userId,
      title: overrides.title ?? "Q3 pricing plan",
      content: overrides.content ?? "<p>confidential board notes</p>",
      publicSlug: randomUUID(),
      isPublic: overrides.isPublic ?? false,
    },
  });
  await db.pageVersion.create({
    data: { pageId: page.id, version: 1, title: page.title, content: page.content },
  });
  return page;
}

async function makeAssistant(userId: string) {
  return db.assistant.create({ data: { userId } });
}

async function uploadAs(userId: string | undefined, headers: Record<string, string> = SAME_SITE) {
  const form = new FormData();
  form.append("file", new File(["secret attachment body"], "notes.txt", { type: "text/plain" }));
  return call(uploadAttachment, "/api/chat/attachments", { method: "POST", form, userId, headers });
}

/** Collects every route in `checks` that answered 200-399 to a hostile caller. */
async function offendingRoutes(checks: Array<{ label: string; status: number }>) {
  return checks.filter((c) => c.status >= 200 && c.status < 400).map((c) => `${c.label} -> ${c.status}`);
}

// ---------------------------------------------------------------------------
// 1. Nothing works without a session.
// ---------------------------------------------------------------------------

test("authz: every new route answers 401 without a session cookie", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);
  const assistant = await makeAssistant(owner.id);
  const conversation = await db.assistantConversation.create({
    data: { assistantId: assistant.id, title: "Owner private chat" },
  });
  const memory = await db.assistantMemory.create({ data: { assistantId: assistant.id, content: "owner fact" } });
  const attachment = await db.messageAttachment.create({
    data: { uploadedById: owner.id, name: "a.txt", storageKey: `${randomUUID()}.txt`, mimeType: "text/plain", size: 3 },
  });
  const goal = await db.aiGoal.create({
    data: { title: "Grow pipeline", objective: "Book 20 qualified calls", successCriteria: "20 calls booked", createdById: owner.id },
  });

  const checks: Array<{ label: string; res: { status: number } }> = [
    { label: "GET /api/pages", res: await call(listPages, "/api/pages") },
    { label: "GET /api/pages/[id]", res: await call(getPage, `/api/pages/${page.id}`, { params: { id: page.id } }) },
    {
      label: "PATCH /api/pages/[id]",
      res: await call(patchPage, `/api/pages/${page.id}`, { method: "PATCH", body: { title: "x" }, params: { id: page.id }, headers: SAME_SITE }),
    },
    {
      label: "DELETE /api/pages/[id]",
      res: await call(deletePage, `/api/pages/${page.id}`, { method: "DELETE", params: { id: page.id }, headers: SAME_SITE }),
    },
    { label: "GET versions", res: await call(listVersions, `/api/pages/${page.id}/versions`, { params: { id: page.id } }) },
    {
      label: "POST versions",
      res: await call(restoreVersion, `/api/pages/${page.id}/versions`, { method: "POST", body: { version: 1 }, params: { id: page.id }, headers: SAME_SITE }),
    },
    {
      label: "POST share",
      res: await call(sharePage, `/api/pages/${page.id}/share`, { method: "POST", body: { enabled: true }, params: { id: page.id }, headers: SAME_SITE }),
    },
    { label: "GET attachment", res: await call(getAttachment, `/api/chat/attachments/${attachment.id}`, { params: { id: attachment.id } }) },
    { label: "POST attachment upload", res: await uploadAs(undefined) },
    { label: "GET conversations", res: await call(listAssistantConversations, "/api/assistant/conversations") },
    {
      label: "POST conversations",
      res: await call(createAssistantConversation, "/api/assistant/conversations", { method: "POST", body: {}, headers: SAME_SITE }),
    },
    {
      label: "PATCH conversation",
      res: await call(patchAssistantConversation, `/api/assistant/conversations/${conversation.id}`, {
        method: "PATCH", body: { title: "x" }, params: { id: conversation.id }, headers: SAME_SITE,
      }),
    },
    {
      label: "DELETE conversation",
      res: await call(deleteAssistantConversation, `/api/assistant/conversations/${conversation.id}`, {
        method: "DELETE", params: { id: conversation.id }, headers: SAME_SITE,
      }),
    },
    { label: "GET memories", res: await call(listMemories, "/api/assistant/memories") },
    {
      label: "PATCH memory",
      res: await call(patchMemory, "/api/assistant/memories", { method: "PATCH", body: { id: memory.id, content: "pwn" }, headers: SAME_SITE }),
    },
    {
      label: "DELETE memory",
      res: await call(deleteMemory, `/api/assistant/memories?id=${memory.id}`, { method: "DELETE", headers: SAME_SITE }),
    },
    { label: "GET assistant me", res: await call(getAssistant, "/api/assistant/me") },
    {
      label: "PATCH assistant me",
      res: await call(patchAssistant, "/api/assistant/me", { method: "PATCH", body: { model: "deepseek-v4-pro" }, headers: SAME_SITE }),
    },
    { label: "GET goals", res: await call(listGoals, "/api/ai/goals") },
    {
      label: "POST goals",
      res: await call(createGoal, "/api/ai/goals", {
        method: "POST",
        body: { title: "Hostile goal", objective: "Do something hostile to the team", successCriteria: "hostility done" },
        headers: SAME_SITE,
      }),
    },
    { label: "GET goal", res: await call(getGoal, `/api/ai/goals/${goal.id}`, { params: { id: goal.id } }) },
    {
      label: "POST goal steer",
      res: await call(steerGoal, `/api/ai/goals/${goal.id}`, { method: "POST", body: { action: "pause" }, params: { id: goal.id }, headers: SAME_SITE }),
    },
  ];

  const wrong = checks.filter((c) => c.res.status !== 401).map((c) => `${c.label} -> ${c.res.status}`);
  assert.deepEqual(wrong, [], `these routes did not require a session:\n${wrong.join("\n")}`);

  // And nothing was written on the way in.
  assert.equal(await db.aiGoal.count({ where: { title: "Hostile goal" } }), 0, "an anonymous request created a team goal");
  assert.equal((await db.page.findUnique({ where: { id: page.id } }))?.isPublic, false, "an anonymous request shared a page");
  assert.equal((await db.assistantMemory.findUnique({ where: { id: memory.id } }))?.content, "owner fact");
  assert.equal((await db.assistantConversation.findUnique({ where: { id: conversation.id } }))?.title, "Owner private chat");
});

test("authz: a disabled user's live session stops working immediately", async () => {
  await resetDb();
  const { member } = await seedUsers();
  const page = await makePage(member.id);

  await db.user.update({ where: { id: member.id }, data: { disabledAt: new Date() } });

  const list = await call(listPages, "/api/pages", { headers: SAME_SITE, userId: member.id });
  const one = await call(getPage, `/api/pages/${page.id}`, { headers: SAME_SITE, userId: member.id, params: { id: page.id } });
  const write = await call(patchPage, `/api/pages/${page.id}`, {
    method: "PATCH", body: { title: "still here?" }, headers: SAME_SITE, userId: member.id, params: { id: page.id },
  });
  assert.equal(list.status, 401, "a disabled user could list pages");
  assert.equal(one.status, 401, "a disabled user could read a page");
  assert.equal(write.status, 401, "a disabled user could write a page");
  assert.equal((await db.page.findUnique({ where: { id: page.id } }))?.title, "Q3 pricing plan");
});

test("authz: an expired session is rejected and purged", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const { token } = await createSession(owner.id);
  await db.session.updateMany({ where: { userId: owner.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

  const res = await call(listPages, "/api/pages", { headers: { ...SAME_SITE, cookie: `company_session=${token}` } });
  assert.equal(res.status, 401, "an expired session still authenticated");
  assert.equal(await db.session.count({ where: { userId: owner.id } }), 0, "the dead session row was not purged");
});

// ---------------------------------------------------------------------------
// 2. Pages: a teammate cannot read, write, share or restore someone else's page.
// ---------------------------------------------------------------------------

test("authz: the page list only ever contains the caller's own pages", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerPage = await makePage(owner.id, { title: "Owner Q3 pricing" });
  const memberPage = await makePage(member.id, { title: "Member onboarding notes" });

  const asMember = await call(listPages, "/api/pages", { userId: member.id, headers: SAME_SITE });
  assert.equal(asMember.status, 200, JSON.stringify(asMember.body));
  const memberIds = (asMember.body.pages as Array<{ id: string }>).map((p) => p.id);
  assert.deepEqual(memberIds, [memberPage.id], "the page list leaked another user's page");

  const asOwner = await call(listPages, "/api/pages", { userId: owner.id, headers: SAME_SITE });
  assert.deepEqual((asOwner.body.pages as Array<{ id: string }>).map((p) => p.id), [ownerPage.id]);
});

test("authz: a teammate cannot read another user's page or its version history", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerPage = await makePage(owner.id, { content: "<p>confidential board notes</p>" });

  const asOwner = await call(getPage, `/api/pages/${ownerPage.id}`, { userId: owner.id, headers: SAME_SITE, params: { id: ownerPage.id } });
  assert.equal(asOwner.status, 200, "the owner must be able to read their own page");
  assert.equal(asOwner.body.page.content, "<p>confidential board notes</p>");

  const read = await call(getPage, `/api/pages/${ownerPage.id}`, { userId: member.id, headers: SAME_SITE, params: { id: ownerPage.id } });
  assert.equal(read.status, 404, `another user's page was readable: ${read.text}`);
  assert.ok(!read.text.includes("confidential board notes"), "the page body leaked in the error response");

  const versions = await call(listVersions, `/api/pages/${ownerPage.id}/versions`, {
    userId: member.id, headers: SAME_SITE, params: { id: ownerPage.id },
  });
  assert.equal(versions.status, 404, `another user's version history was readable: ${versions.text}`);
  assert.ok(!versions.text.includes("Q3 pricing plan"), "version titles leaked in the error response");
});

test("authz: a teammate cannot rename, delete, share or restore another user's page", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerPage = await makePage(owner.id);

  const rename = await call(patchPage, `/api/pages/${ownerPage.id}`, {
    method: "PATCH", body: { title: "PWNED", content: "<p>pwned</p>" }, userId: member.id, headers: SAME_SITE, params: { id: ownerPage.id },
  });
  assert.equal(rename.status, 404, `another user's page was writable: ${rename.text}`);

  const share = await call(sharePage, `/api/pages/${ownerPage.id}/share`, {
    method: "POST", body: { enabled: true, regenerate: true }, userId: member.id, headers: SAME_SITE, params: { id: ownerPage.id },
  });
  assert.equal(share.status, 404, `another user's page could be published: ${share.text}`);

  const restore = await call(restoreVersion, `/api/pages/${ownerPage.id}/versions`, {
    method: "POST", body: { version: 1 }, userId: member.id, headers: SAME_SITE, params: { id: ownerPage.id },
  });
  assert.equal(restore.status, 404, `another user's page history could be rewritten: ${restore.text}`);

  const remove = await call(deletePage, `/api/pages/${ownerPage.id}`, {
    method: "DELETE", userId: member.id, headers: SAME_SITE, params: { id: ownerPage.id },
  });
  assert.equal(remove.status, 404, `another user's page was deletable: ${remove.text}`);

  // The database is the authority: the row must be untouched in every respect.
  const after = await db.page.findUniqueOrThrow({ where: { id: ownerPage.id } });
  assert.equal(after.title, "Q3 pricing plan", "an outsider renamed the page");
  assert.equal(after.content, "<p>confidential board notes</p>", "an outsider rewrote the page body");
  assert.equal(after.isPublic, false, "an outsider published the page");
  assert.equal(after.publicSlug, ownerPage.publicSlug, "an outsider rotated the share link");
  assert.equal(after.currentVersion, 1, "an outsider changed the page version");
  assert.equal(await db.pageVersion.count({ where: { pageId: ownerPage.id } }), 1, "an outsider created a version");
});

// ---------------------------------------------------------------------------
// 3. Pages: CSRF.
// ---------------------------------------------------------------------------

test("authz: page mutations reject a request from a foreign origin", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  const checks = [
    {
      label: "PATCH /api/pages/[id]",
      status: (await call(patchPage, `/api/pages/${page.id}`, {
        method: "PATCH", body: { title: "CSRF", isPublic: true }, userId: owner.id, headers: FOREIGN, params: { id: page.id },
      })).status,
    },
    {
      label: "DELETE /api/pages/[id]",
      status: (await call(deletePage, `/api/pages/${page.id}`, {
        method: "DELETE", userId: owner.id, headers: FOREIGN, params: { id: page.id },
      })).status,
    },
    {
      label: "POST /api/pages/[id]/share",
      status: (await call(sharePage, `/api/pages/${page.id}/share`, {
        method: "POST", body: { enabled: true }, userId: owner.id, headers: FOREIGN, params: { id: page.id },
      })).status,
    },
    {
      label: "POST /api/pages/[id]/versions",
      status: (await call(restoreVersion, `/api/pages/${page.id}/versions`, {
        method: "POST", body: { version: 1 }, userId: owner.id, headers: FOREIGN, params: { id: page.id },
      })).status,
    },
  ];

  const offenders = await offendingRoutes(checks);
  assert.deepEqual(offenders, [], `cross-origin page mutations were accepted:\n${offenders.join("\n")}`);

  const after = await db.page.findUniqueOrThrow({ where: { id: page.id } });
  assert.equal(after.title, "Q3 pricing plan", "a cross-origin request renamed the page");
  assert.equal(after.isPublic, false, "a cross-origin request published the page");
  assert.equal(after.currentVersion, 1, "a cross-origin request changed the version");
});

test("authz: page mutations reject a request with no Origin and no Sec-Fetch-Site", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  // One page per route: a successful DELETE would otherwise mask the status of
  // every later call with a 404 and hide how many routes are actually open.
  const patchTarget = await makePage(owner.id, { title: "patch target" });
  const deleteTarget = await makePage(owner.id, { title: "delete target" });
  const shareTarget = await makePage(owner.id, { title: "share target" });
  const restoreTarget = await makePage(owner.id, { title: "restore target" });

  const statuses: Record<string, number> = {};
  statuses["PATCH /api/pages/[id]"] = (
    await call(patchPage, `/api/pages/${patchTarget.id}`, {
      method: "PATCH", body: { title: "CSRF", isPublic: true }, userId: owner.id, headers: NO_ORIGIN, params: { id: patchTarget.id },
    })
  ).status;
  statuses["DELETE /api/pages/[id]"] = (
    await call(deletePage, `/api/pages/${deleteTarget.id}`, {
      method: "DELETE", userId: owner.id, headers: NO_ORIGIN, params: { id: deleteTarget.id },
    })
  ).status;
  statuses["POST /api/pages/[id]/share"] = (
    await call(sharePage, `/api/pages/${shareTarget.id}/share`, {
      method: "POST", body: { enabled: true }, userId: owner.id, headers: NO_ORIGIN, params: { id: shareTarget.id },
    })
  ).status;
  statuses["POST /api/pages/[id]/versions"] = (
    await call(restoreVersion, `/api/pages/${restoreTarget.id}/versions`, {
      method: "POST", body: { version: 1 }, userId: owner.id, headers: NO_ORIGIN, params: { id: restoreTarget.id },
    })
  ).status;

  const problems = Object.entries(statuses)
    .filter(([, status]) => status >= 200 && status < 400)
    .map(([label, status]) => `${label} -> ${status}`);

  const afterPatch = await db.page.findUnique({ where: { id: patchTarget.id } });
  if (!afterPatch || afterPatch.title !== "patch target" || afterPatch.isPublic) {
    problems.push("the origin-less PATCH wrote to the database");
  }
  if (!(await db.page.findUnique({ where: { id: deleteTarget.id } }))) {
    problems.push("the origin-less DELETE removed the page from the database");
  }
  const afterShare = await db.page.findUnique({ where: { id: shareTarget.id } });
  if (!afterShare || afterShare.isPublic) problems.push("the origin-less share published the page");
  const afterRestore = await db.page.findUnique({ where: { id: restoreTarget.id } });
  if (!afterRestore || afterRestore.currentVersion !== 1) problems.push("the origin-less restore changed the page version");

  assert.deepEqual(
    problems,
    [],
    `a request with no Origin, no Referer and no Sec-Fetch-Site was treated as same-origin:\n${problems.join("\n")}`
  );
});

test("authz: (diagnostic) the origin guard's origin-less bypass is NODE_ENV-dependent", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const page = await makePage(owner.id);

  // `process.env` is read-only on the Node type surface; the guard itself reads
  // it on every call, so a cast is enough to show what the environment changes.
  const env = process.env as Record<string, string | undefined>;
  const previous = env.NODE_ENV;
  try {
    env.NODE_ENV = "production";
    const res = await call(patchPage, `/api/pages/${page.id}`, {
      method: "PATCH", body: { title: "CSRF" }, userId: owner.id, headers: NO_ORIGIN, params: { id: page.id },
    });
    assert.equal(
      res.status,
      403,
      `outside development an origin-less mutation must be refused, got ${res.status}: ${res.text}`
    );
  } finally {
    env.NODE_ENV = previous;
  }
});

// ---------------------------------------------------------------------------
// 4. Chat attachments.
// ---------------------------------------------------------------------------

test("authz: an unsent attachment is readable only by the teammate who uploaded it", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  const uploaded = await uploadAs(member.id);
  assert.equal(uploaded.status, 200, `upload failed: ${uploaded.text}`);
  const attachmentId = uploaded.body.attachment.id as string;

  const row = await db.messageAttachment.findUniqueOrThrow({ where: { id: attachmentId } });
  assert.equal(row.uploadedById, member.id, "the upload was not attributed to the uploader");

  const asOwner = await call(getAttachment, `/api/chat/attachments/${attachmentId}`, {
    userId: owner.id, headers: SAME_SITE, params: { id: attachmentId },
  });
  assert.equal(asOwner.status, 404, `another user's unsent attachment was served: ${asOwner.status} ${asOwner.text}`);

  const asUploader = await call(getAttachment, `/api/chat/attachments/${attachmentId}`, {
    userId: member.id, headers: SAME_SITE, params: { id: attachmentId },
  });
  assert.equal(asUploader.status, 200, "the uploader must be able to read their own file");
  assert.equal(asUploader.text, "secret attachment body");
});

test("authz: a sent attachment is readable only by members of that conversation", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();

  const conversation = await db.conversation.create({ data: { type: "DIRECT" } });
  await db.conversationMember.create({ data: { conversationId: conversation.id, userId: member.id } });
  const message = await db.message.create({
    data: { conversationId: conversation.id, senderId: member.id, body: "here is the file" },
  });

  const uploaded = await uploadAs(member.id);
  assert.equal(uploaded.status, 200, `upload failed: ${uploaded.text}`);
  const attachmentId = uploaded.body.attachment.id as string;
  await db.messageAttachment.update({ where: { id: attachmentId }, data: { messageId: message.id } });

  const asOutsider = await call(getAttachment, `/api/chat/attachments/${attachmentId}`, {
    userId: owner.id, headers: SAME_SITE, params: { id: attachmentId },
  });
  assert.equal(asOutsider.status, 404, `a non-member read a conversation attachment: ${asOutsider.text}`);

  await db.conversationMember.create({ data: { conversationId: conversation.id, userId: owner.id } });
  const asMember = await call(getAttachment, `/api/chat/attachments/${attachmentId}`, {
    userId: owner.id, headers: SAME_SITE, params: { id: attachmentId },
  });
  assert.equal(asMember.status, 200, "a conversation member must be able to read the attachment");
  assert.equal(asMember.text, "secret attachment body");
});

test("authz: attachment upload is rejected unauthenticated or cross-origin and writes no row", async () => {
  await resetDb();
  const { owner } = await seedUsers();

  const anonymous = await uploadAs(undefined);
  assert.equal(anonymous.status, 401, `anonymous upload was accepted: ${anonymous.text}`);

  const foreign = await uploadAs(owner.id, FOREIGN);
  assert.equal(foreign.status, 403, `cross-origin upload was accepted: ${foreign.status} ${foreign.text}`);

  assert.equal(await db.messageAttachment.count(), 0, "a rejected upload still wrote an attachment row");
});

// ---------------------------------------------------------------------------
// 5. Assistant: profile, memories and conversations are per-user.
// ---------------------------------------------------------------------------

test("authz: the assistant profile and its memories are per-user", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerAssistant = await makeAssistant(owner.id);
  await db.assistantMemory.create({ data: { assistantId: ownerAssistant.id, content: "owner's bank details" } });

  const me = await call(getAssistant, "/api/assistant/me", { userId: member.id, headers: SAME_SITE });
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.assistant.userId, member.id, "the assistant endpoint returned another user's profile");
  assert.notEqual(me.body.assistant.id, ownerAssistant.id);

  const memories = await call(listMemories, "/api/assistant/memories", { userId: member.id, headers: SAME_SITE });
  assert.equal(memories.status, 200, JSON.stringify(memories.body));
  const contents = (memories.body.memories as Array<{ content: string }>).map((m) => m.content);
  assert.deepEqual(contents, [], "another user's memories were readable");
});

test("authz: a teammate cannot edit or delete another user's memory", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerAssistant = await makeAssistant(owner.id);
  const memory = await db.assistantMemory.create({ data: { assistantId: ownerAssistant.id, content: "owner's bank details" } });

  const edit = await call(patchMemory, "/api/assistant/memories", {
    method: "PATCH", body: { id: memory.id, content: "and their home address" }, userId: member.id, headers: SAME_SITE,
  });
  assert.equal(edit.status, 404, `another user's memory was editable: ${edit.text}`);

  const del = await call(deleteMemory, `/api/assistant/memories?id=${memory.id}`, {
    method: "DELETE", userId: member.id, headers: SAME_SITE,
  });
  assert.equal(del.status, 404, `another user's memory was deletable: ${del.text}`);

  const after = await db.assistantMemory.findUniqueOrThrow({ where: { id: memory.id } });
  assert.equal(after.content, "owner's bank details", "an outsider rewrote the memory");
  assert.equal(after.archivedAt, null, "an outsider archived the memory");
});

test("authz: assistant conversations are per-user", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const ownerAssistant = await makeAssistant(owner.id);
  const ownerConversation = await db.assistantConversation.create({
    data: { assistantId: ownerAssistant.id, title: "Owner strategy chat" },
  });
  await db.assistantMessage.create({
    data: { assistantId: ownerAssistant.id, conversationId: ownerConversation.id, role: "user", content: "confidential question" },
  });

  const list = await call(listAssistantConversations, "/api/assistant/conversations", { userId: member.id, headers: SAME_SITE });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const ids = (list.body.conversations as Array<{ id: string }>).map((c) => c.id);
  assert.deepEqual(ids, [], "another user's conversations were listed");

  const rename = await call(patchAssistantConversation, `/api/assistant/conversations/${ownerConversation.id}`, {
    method: "PATCH", body: { title: "PWNED", pinned: true }, userId: member.id, headers: SAME_SITE,
    params: { id: ownerConversation.id },
  });
  assert.equal(rename.status, 404, `another user's conversation was renameable: ${rename.text}`);

  const remove = await call(deleteAssistantConversation, `/api/assistant/conversations/${ownerConversation.id}`, {
    method: "DELETE", userId: member.id, headers: SAME_SITE, params: { id: ownerConversation.id },
  });
  assert.equal(remove.status, 404, `another user's conversation was deletable: ${remove.text}`);

  const after = await db.assistantConversation.findUniqueOrThrow({ where: { id: ownerConversation.id } });
  assert.equal(after.title, "Owner strategy chat", "an outsider renamed the conversation");
  assert.equal(after.pinnedAt, null, "an outsider pinned the conversation");
});

test("authz: assistant mutations reject a request from a foreign origin", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const assistant = await makeAssistant(owner.id);
  const conversation = await db.assistantConversation.create({ data: { assistantId: assistant.id, title: "My chat" } });
  const memory = await db.assistantMemory.create({ data: { assistantId: assistant.id, content: "my fact" } });

  const checks = [
    {
      label: "POST /api/assistant/conversations",
      status: (await call(createAssistantConversation, "/api/assistant/conversations", {
        method: "POST", body: {}, userId: owner.id, headers: FOREIGN,
      })).status,
    },
    {
      label: "PATCH /api/assistant/conversations/[id]",
      status: (await call(patchAssistantConversation, `/api/assistant/conversations/${conversation.id}`, {
        method: "PATCH", body: { title: "CSRF" }, userId: owner.id, headers: FOREIGN, params: { id: conversation.id },
      })).status,
    },
    {
      label: "DELETE /api/assistant/conversations/[id]",
      status: (await call(deleteAssistantConversation, `/api/assistant/conversations/${conversation.id}`, {
        method: "DELETE", userId: owner.id, headers: FOREIGN, params: { id: conversation.id },
      })).status,
    },
    {
      label: "PATCH /api/assistant/memories",
      status: (await call(patchMemory, "/api/assistant/memories", {
        method: "PATCH", body: { id: memory.id, content: "csrf fact" }, userId: owner.id, headers: FOREIGN,
      })).status,
    },
    {
      label: "DELETE /api/assistant/memories",
      status: (await call(deleteMemory, `/api/assistant/memories?id=${memory.id}`, {
        method: "DELETE", userId: owner.id, headers: FOREIGN,
      })).status,
    },
    {
      label: "PATCH /api/assistant/me",
      status: (await call(patchAssistant, "/api/assistant/me", {
        method: "PATCH", body: { model: "deepseek-v4-pro", approvalMode: "NEVER" }, userId: owner.id, headers: FOREIGN,
      })).status,
    },
  ];

  const offenders = await offendingRoutes(checks);
  assert.deepEqual(offenders, [], `cross-origin assistant mutations were accepted:\n${offenders.join("\n")}`);

  assert.equal(await db.assistantConversation.count({ where: { assistantId: assistant.id } }), 1, "a conversation was created");
  assert.equal((await db.assistantConversation.findUniqueOrThrow({ where: { id: conversation.id } })).title, "My chat");
  assert.equal((await db.assistantMemory.findUniqueOrThrow({ where: { id: memory.id } })).content, "my fact");
  assert.equal((await db.assistant.findUniqueOrThrow({ where: { id: assistant.id } })).model, "deepseek-flash");
});

// ---------------------------------------------------------------------------
// 6. Team goals: role gate + CSRF.
// ---------------------------------------------------------------------------

test("authz: a member cannot create or steer a team goal", async () => {
  await resetDb();
  const { owner, member } = await seedUsers();
  const goal = await db.aiGoal.create({
    data: { title: "Grow pipeline", objective: "Book 20 qualified calls", successCriteria: "20 calls booked", createdById: owner.id, status: "ACTIVE" },
  });

  const create = await call(createGoal, "/api/ai/goals", {
    method: "POST",
    body: { title: "Member goal", objective: "Do whatever the member wants", successCriteria: "member wins" },
    userId: member.id,
    headers: SAME_SITE,
  });
  assert.equal(create.status, 403, `a member created a team goal: ${create.status} ${create.text}`);

  const steer = await call(steerGoal, `/api/ai/goals/${goal.id}`, {
    method: "POST", body: { action: "cancel" }, userId: member.id, headers: SAME_SITE, params: { id: goal.id },
  });
  assert.equal(steer.status, 403, `a member steered a team goal: ${steer.status} ${steer.text}`);

  assert.equal(await db.aiGoal.count({ where: { title: "Member goal" } }), 0, "a member's goal was written anyway");
  assert.equal((await db.aiGoal.findUniqueOrThrow({ where: { id: goal.id } })).status, "ACTIVE", "a member cancelled the goal");
});

test("authz: goal mutations reject a request from a foreign origin", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const goal = await db.aiGoal.create({
    data: { title: "Grow pipeline", objective: "Book 20 qualified calls", successCriteria: "20 calls booked", createdById: owner.id, status: "ACTIVE" },
  });

  const checks = [
    {
      label: "POST /api/ai/goals",
      status: (await call(createGoal, "/api/ai/goals", {
        method: "POST",
        body: { title: "CSRF goal", objective: "Drive the team with a forged request", successCriteria: "forgery accepted" },
        userId: owner.id,
        headers: FOREIGN,
      })).status,
    },
    {
      label: "POST /api/ai/goals/[id]",
      status: (await call(steerGoal, `/api/ai/goals/${goal.id}`, {
        method: "POST", body: { action: "cancel" }, userId: owner.id, headers: FOREIGN, params: { id: goal.id },
      })).status,
    },
  ];

  const offenders = await offendingRoutes(checks);
  assert.deepEqual(offenders, [], `cross-origin goal mutations were accepted:\n${offenders.join("\n")}`);

  assert.equal(await db.aiGoal.count({ where: { title: "CSRF goal" } }), 0, "a cross-origin request created a goal");
  assert.equal((await db.aiGoal.findUniqueOrThrow({ where: { id: goal.id } })).status, "ACTIVE", "a cross-origin request cancelled the goal");
});

// ---------------------------------------------------------------------------
// 7. Cross-cutting: the origin guard itself, across every mutating route.
// ---------------------------------------------------------------------------

test("authz: no mutating route treats an origin-less request as same-origin", async () => {
  await resetDb();
  const { owner } = await seedUsers();
  const assistant = await makeAssistant(owner.id);
  const goal = await db.aiGoal.create({
    data: { title: "Grow pipeline", objective: "Book 20 qualified calls", successCriteria: "20 calls booked", createdById: owner.id, status: "ACTIVE" },
  });

  // A fresh row (and a fresh FormData) per route: a route that succeeds must not
  // turn the next route's 404 into a false "rejected".
  const fresh = () => ({
    page: makePage(owner.id, { title: "victim" }),
    conversation: db.assistantConversation.create({ data: { assistantId: assistant.id, title: "My chat" } }),
    memory: db.assistantMemory.create({ data: { assistantId: assistant.id, content: "my fact" } }),
    upload: (() => {
      const form = new FormData();
      form.append("file", new File(["x"], "x.txt", { type: "text/plain" }));
      return form;
    })(),
  });

  const problems: string[] = [];
  const expectRefused = (label: string, status: number) => {
    if (status >= 200 && status < 400) problems.push(`${label} -> ${status}`);
  };

  {
    const { page } = fresh();
    const p = await page;
    expectRefused(
      "PATCH /api/pages/[id]",
      (await call(patchPage, `/api/pages/${p.id}`, {
        method: "PATCH", body: { title: "CSRF", isPublic: true }, userId: owner.id, headers: NO_ORIGIN, params: { id: p.id },
      })).status
    );
    const after = await db.page.findUnique({ where: { id: p.id } });
    if (!after || after.title !== "victim" || after.isPublic) problems.push("an origin-less request wrote to a page");
  }
  {
    const { page } = fresh();
    const p = await page;
    expectRefused(
      "DELETE /api/pages/[id]",
      (await call(deletePage, `/api/pages/${p.id}`, { method: "DELETE", userId: owner.id, headers: NO_ORIGIN, params: { id: p.id } })).status
    );
    if (!(await db.page.findUnique({ where: { id: p.id } }))) problems.push("an origin-less request deleted a page");
  }
  {
    const { page } = fresh();
    const p = await page;
    expectRefused(
      "POST /api/pages/[id]/share",
      (await call(sharePage, `/api/pages/${p.id}/share`, {
        method: "POST", body: { enabled: true }, userId: owner.id, headers: NO_ORIGIN, params: { id: p.id },
      })).status
    );
    const after = await db.page.findUnique({ where: { id: p.id } });
    if (!after || after.isPublic) problems.push("an origin-less request published a page");
  }
  {
    const { page } = fresh();
    const p = await page;
    expectRefused(
      "POST /api/pages/[id]/versions",
      (await call(restoreVersion, `/api/pages/${p.id}/versions`, {
        method: "POST", body: { version: 1 }, userId: owner.id, headers: NO_ORIGIN, params: { id: p.id },
      })).status
    );
    const after = await db.page.findUnique({ where: { id: p.id } });
    if (!after || after.currentVersion !== 1) problems.push("an origin-less request restored a page version");
  }
  {
    const { upload } = fresh();
    const before = await db.messageAttachment.count();
    expectRefused(
      "POST /api/chat/attachments",
      (await call(uploadAttachment, "/api/chat/attachments", { method: "POST", form: upload, userId: owner.id, headers: NO_ORIGIN })).status
    );
    if ((await db.messageAttachment.count()) !== before) problems.push("an origin-less request uploaded a file");
  }
  {
    const { conversation } = fresh();
    const c = await conversation;
    expectRefused(
      "PATCH /api/assistant/conversations/[id]",
      (await call(patchAssistantConversation, `/api/assistant/conversations/${c.id}`, {
        method: "PATCH", body: { title: "CSRF" }, userId: owner.id, headers: NO_ORIGIN, params: { id: c.id },
      })).status
    );
    const after = await db.assistantConversation.findUnique({ where: { id: c.id } });
    if (!after || after.title !== "My chat") problems.push("an origin-less request renamed a conversation");
  }
  {
    const { conversation } = fresh();
    const c = await conversation;
    expectRefused(
      "DELETE /api/assistant/conversations/[id]",
      (await call(deleteAssistantConversation, `/api/assistant/conversations/${c.id}`, {
        method: "DELETE", userId: owner.id, headers: NO_ORIGIN, params: { id: c.id },
      })).status
    );
    if (!(await db.assistantConversation.findUnique({ where: { id: c.id } }))) {
      problems.push("an origin-less request deleted a conversation");
    }
  }
  {
    const before = await db.assistantConversation.count({ where: { assistantId: assistant.id } });
    expectRefused(
      "POST /api/assistant/conversations",
      (await call(createAssistantConversation, "/api/assistant/conversations", {
        method: "POST", body: {}, userId: owner.id, headers: NO_ORIGIN,
      })).status
    );
    const after = await db.assistantConversation.count({ where: { assistantId: assistant.id } });
    if (after !== before) problems.push("an origin-less request created a conversation");
  }
  {
    const { memory } = fresh();
    const m = await memory;
    expectRefused(
      "PATCH /api/assistant/memories",
      (await call(patchMemory, "/api/assistant/memories", {
        method: "PATCH", body: { id: m.id, content: "csrf fact" }, userId: owner.id, headers: NO_ORIGIN,
      })).status
    );
    const after = await db.assistantMemory.findUnique({ where: { id: m.id } });
    if (!after || after.content !== "my fact") problems.push("an origin-less request rewrote a memory");
  }
  {
    const { memory } = fresh();
    const m = await memory;
    expectRefused(
      "DELETE /api/assistant/memories",
      (await call(deleteMemory, `/api/assistant/memories?id=${m.id}`, { method: "DELETE", userId: owner.id, headers: NO_ORIGIN })).status
    );
    const after = await db.assistantMemory.findUnique({ where: { id: m.id } });
    if (!after || after.archivedAt !== null) problems.push("an origin-less request archived a memory");
  }
  {
    const assistantRow = await db.assistant.findUniqueOrThrow({ where: { id: assistant.id } });
    expectRefused(
      "PATCH /api/assistant/me",
      (await call(patchAssistant, "/api/assistant/me", {
        method: "PATCH", body: { model: "deepseek-v4-pro" }, userId: owner.id, headers: NO_ORIGIN,
      })).status
    );
    const after = await db.assistant.findUniqueOrThrow({ where: { id: assistant.id } });
    if (after.model !== assistantRow.model) problems.push("an origin-less request changed the assistant model");
  }
  {
    expectRefused(
      "POST /api/ai/goals/[id]",
      (await call(steerGoal, `/api/ai/goals/${goal.id}`, {
        method: "POST", body: { action: "pause" }, userId: owner.id, headers: NO_ORIGIN, params: { id: goal.id },
      })).status
    );
    const after = await db.aiGoal.findUniqueOrThrow({ where: { id: goal.id } });
    if (after.status !== "ACTIVE") problems.push("an origin-less request steered a team goal");
  }

  assert.deepEqual(
    problems,
    [],
    `these mutating routes accepted a request with no Origin, no Referer and no Sec-Fetch-Site:\n${problems.join("\n")}`
  );
});
