/**
 * scratch/workspace-root-probe.mjs — Phase A per-conversation workspace roots:
 * end-to-end proof against the LIVE dev DB (cyraops_v2) and the dev server
 * on :3003 (default env), plus the real in-process native harness host.
 *
 * What it proves:
 *   1. OWNER API   — POST /api/assistant/conversations/[id]/workspace-root
 *                    {path} records BOTH the user-supplied path and the
 *                    resolved realpath; GET .../workspace lists {exists,
 *                    realpath}; bad paths (relative / missing / file) get 400;
 *                    a request without an Origin fails the same-origin gate.
 *   2. NATIVE TURN — the owner's native turn "list the files in the project
 *                    root using your tools" runs under /tmp/cyraops-probe-root
 *                    and reports the marker file name.
 *   3. NON-OWNER    — a second user's session gets 404 on the owner's
 *                    conversation, and a non-owner turn resolves NO root
 *                    (owner-gate function + a real turn that cannot list the
 *                    marker).
 *   4. UNSET        — POST {path:null} clears; the next owner turn boots in
 *                    CRM mode (repo cwd), starts a FRESH harness session
 *                    (the root-change guard), and no longer sees the marker.
 *   5. AI SURFACE   — the same set/clear/owner-gate on
 *                    /api/ai/conversations/[id]/workspace(-root) (the
 *                    AiConversation schema the Phase A spec names).
 *
 * All probe data is reverted: conversations, sessions, the workspace
 * permission mode, and /tmp/cyraops-probe-root are removed at the end.
 *
 * Usage (from the repo root):
 *   node --import tsx scratch/workspace-root-probe.mjs
 */

import { config } from "dotenv";
config();
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { PrismaClient } from "@prisma/client";
import { harnessSessionStore } from "../src/lib/harness/runtime";
import { createNativeRuntime } from "../src/lib/harness/native-runtime";
import { sessionIdOf } from "../src/lib/harness/events";
import { workspaceRootForTurn } from "../src/lib/harness/workspace-root";
import { resolvePermissionMode, runtimePermissionMode } from "../src/lib/permissions/mode";

const prisma = new PrismaClient();
const BASE = "http://127.0.0.1:3003";
const ORIGIN = BASE;
const PROBE_ROOT = "/tmp/cyraops-probe-root";
const MARKER = "cyraops-probe-marker.txt";
const OWNER_EMAIL = "tanveer@cyraops.com";
const OWNER_PASSWORD = "CyraOps-dev-2026";
const MEMBER_EMAIL = "member@test.cyraops.com";

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`[probe] ${ok ? "PASS" : "FAIL"} ${name} — ${detail}`);
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function compact(event) {
  const copy = { ...event };
  for (const key of ["text", "result", "input"]) {
    if (typeof copy[key] === "string" && copy[key].length > 500) {
      copy[key] = `${copy[key].slice(0, 500)}…(truncated)`;
    }
  }
  return copy;
}

/** One HTTP request with optional cookies + origin, returning {status, body}. */
async function http(path, { method = "GET", cookie, body, origin = ORIGIN, json = true } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  // null explicitly means "send no Origin header at all" (the default ORIGIN
  // must NOT re-apply, so undefined cannot be used as the sentinel).
  if (origin !== undefined && origin !== null) headers.origin = origin;
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const text = await response.text();
  let parsed = null;
  if (json) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  return { status: response.status, body: parsed ?? text, setCookie: response.headers.get("set-cookie") };
}

async function login(email, password) {
  const response = await http("/api/auth/login", { method: "POST", body: { email, password } });
  const token = response.setCookie?.match(/company_session=([^;]+)/)?.[1];
  if (token) {
    // The login minted a Session row: revert it with everything else.
    cleanup.push(() => prisma.session.deleteMany({ where: { tokenHash: sha256(decodeURIComponent(token)) } }));
  }
  return { status: response.status, cookie: token ? `company_session=${token}` : null };
}

/** Mint a session cookie for a user directly (no password needed in the probe). */
async function mintSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256(token);
  await prisma.session.create({
    data: { tokenHash, userId, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
  });
  cleanup.push(() => prisma.session.deleteMany({ where: { tokenHash } }));
  return `company_session=${token}`;
}

/** One native turn through the REAL AgentRuntime (single instance, like the route). */
async function nativeTurn({ runtime, tenantId, actorId, conversationOwnerId, conversationId, workspaceRootRealpath, permissionMode, task }) {
  const root = workspaceRootForTurn({ actorId, conversationOwnerId, workspaceRootRealpath });
  console.log(`[probe] turn root resolved: ${root ?? "null"} (actor=${actorId.slice(-6)}, owner=${conversationOwnerId.slice(-6)})`);
  const session = await runtime.createSession({ tenantId, conversationId });
  const events = [];
  try {
    for await (const event of runtime.executeTurn({
      sessionId: session.id,
      task,
      workspaceId: tenantId,
      workspaceRoot: root,
      permissionMode,
    })) {
      events.push(event);
      const line = JSON.stringify(compact(event));
      console.log(`[stream] ${line.length > 480 ? `${line.slice(0, 480)}…` : line}`);
    }
  } catch (error) {
    console.error(`[probe] turn threw: ${error?.message}`);
    return { root, events, finalText: "", announcedSessionId: null, threw: String(error?.message ?? "") };
  }
  const final = [...events].reverse().find((event) => event.type === "final");
  const announced = sessionIdOf(events);
  const toolResults = events.filter((event) => event.type === "tool_result");
  return { root, events, finalText: final?.text ?? "", announcedSessionId: announced, toolResults };
}

const LIST_TASK =
  `Use your shell tool to list the files in the project root directory (run "ls" in the project root). ` +
  `Then tell me the exact filename of the file that starts with "cyraops-probe-marker". ` +
  `If no such file exists, say exactly: NO MARKER FOUND.`;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
const cleanup = [];
async function main() {
  await rm(PROBE_ROOT, { recursive: true, force: true });
  await mkdir(PROBE_ROOT, { recursive: true });
  await writeFile(`${PROBE_ROOT}/${MARKER}`, "probe-marker-content\n");

  const owner = await prisma.user.findUniqueOrThrow({ where: { email: OWNER_EMAIL } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: MEMBER_EMAIL } });
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: "main" } });
  const originalMode = workspace.permissionMode;
  cleanup.push(async () => prisma.workspace.update({ where: { id: "main" }, data: { permissionMode: originalMode } }));
  console.log(`[probe] owner=${owner.id} member=${member.id} workspace mode=${originalMode} (restored at end)`);

  // 1. Owner logs in; fresh assistant conversation.
  const ownerLogin = await login(OWNER_EMAIL, OWNER_PASSWORD);
  record("owner login", ownerLogin.status === 200, `status ${ownerLogin.status}`);
  assert.ok(ownerLogin.cookie, "owner login must produce a session cookie");
  const created = await http("/api/assistant/conversations", { method: "POST", cookie: ownerLogin.cookie, body: { agentSlug: null } });
  record("fresh assistant conversation", created.status === 201, `status ${created.status}`);
  const conversationId = created.body?.conversation?.id;
  assert.ok(conversationId, "conversation id");
  cleanup.push(() => prisma.assistantConversation.deleteMany({ where: { id: conversationId } }));

  // 2. Owner sets the root through the API.
  const setRes = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST",
    cookie: ownerLogin.cookie,
    body: { path: PROBE_ROOT },
  });
  record(
    "owner sets root (API)",
    setRes.status === 200 && setRes.body?.conversation?.workspaceRoot === PROBE_ROOT,
    `status ${setRes.status} workspaceRoot=${JSON.stringify(setRes.body?.conversation?.workspaceRoot)}`
  );
  const storedRealpath = setRes.body?.conversation?.workspaceRootRealpath;
  record(
    "realpath recorded (both spellings stored)",
    Boolean(storedRealpath) && storedRealpath !== PROBE_ROOT,
    `realpath=${JSON.stringify(storedRealpath)}`
  );

  // The row the route reads from, straight out of the DB.
  const row = await prisma.assistantConversation.findUnique({ where: { id: conversationId } });
  record(
    "DB row carries both columns",
    row?.workspaceRoot === PROBE_ROOT && row?.workspaceRootRealpath === storedRealpath,
    `workspaceRoot=${JSON.stringify(row?.workspaceRoot)} workspaceRootRealpath=${JSON.stringify(row?.workspaceRootRealpath)}`
  );

  // GET listing.
  const listing = await http(`/api/assistant/conversations/${conversationId}/workspace`, { cookie: ownerLogin.cookie });
  record(
    "GET workspace listing",
    listing.status === 200 && listing.body?.workspace?.exists === true && listing.body?.workspace?.realpath === storedRealpath,
    `status ${listing.status} ${JSON.stringify(listing.body?.workspace)}`
  );

  // 3. Validation + security rejects.
  const relative = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: "relative/path" },
  });
  record("relative path rejected", relative.status === 400, `status ${relative.status} error=${JSON.stringify(relative.body?.error)}`);

  const missing = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: "/tmp/cyraops-no-such-dir-xyz" },
  });
  record("missing path rejected", missing.status === 400, `status ${missing.status} error=${JSON.stringify(missing.body?.error)}`);

  const notADir = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: `${PROBE_ROOT}/${MARKER}` },
  });
  record("file path rejected", notADir.status === 400, `status ${notADir.status} error=${JSON.stringify(notADir.body?.error)}`);

  const noOrigin = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: PROBE_ROOT }, origin: null,
  });
  record("same-origin gate (no Origin)", noOrigin.status === 403, `status ${noOrigin.status}`);

  // 4. Non-owner: mint a member session; the conversation must be invisible.
  const memberCookie = await mintSession(member.id);
  const memberSet = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST", cookie: memberCookie, body: { path: PROBE_ROOT },
  });
  record("non-owner cannot set the root (404)", memberSet.status === 404, `status ${memberSet.status}`);
  const memberList = await http(`/api/assistant/conversations/${conversationId}/workspace`, { cookie: memberCookie });
  record("non-owner cannot list the workspace (404)", memberList.status === 404, `status ${memberList.status}`);

  // 5. Native turns (in-process host, ONE runtime instance like the route).
  await prisma.workspace.update({ where: { id: "main" }, data: { permissionMode: "SYSTEM" } });
  const ownerMode = runtimePermissionMode(await resolvePermissionMode({ workspaceId: owner.id }), "OWNER");
  console.log(`[probe] owner turn permission mode: ${ownerMode}`);
  const runtime = createNativeRuntime(harnessSessionStore());
  const ownerUserId = owner.id; // Assistant.userId: the conversation's owner key

  const rooted = await nativeTurn({
    runtime, tenantId: owner.id, actorId: owner.id, conversationOwnerId: ownerUserId,
    conversationId, workspaceRootRealpath: storedRealpath, permissionMode: ownerMode, task: LIST_TASK,
  });
  const rootedMentions = /cyraops-probe-marker\.txt/.test(rooted.finalText);
  record(
    "owner native turn lists the marker file under the project root",
    rootedMentions && !rooted.threw,
    `final=${JSON.stringify(rooted.finalText.slice(0, 240))}`
  );

  const memberMode = runtimePermissionMode(await resolvePermissionMode({ workspaceId: member.id }), "MEMBER");
  console.log(`[probe] member turn permission mode: ${memberMode}`);
  const memberTurn = await nativeTurn({
    runtime, tenantId: member.id, actorId: member.id, conversationOwnerId: ownerUserId,
    conversationId, workspaceRootRealpath: storedRealpath, permissionMode: memberMode, task: LIST_TASK,
  });
  record(
    "non-owner turn resolves NO project root",
    memberTurn.root === null && !memberTurn.threw,
    `root=${JSON.stringify(memberTurn.root)} mode=${memberMode}`
  );
  record(
    "non-owner turn cannot see the marker",
    !/cyraops-probe-marker\.txt/.test(memberTurn.finalText),
    `final=${JSON.stringify(memberTurn.finalText.slice(0, 200))}`
  );

  // 6. Unset/clear → CRM behaviour, fresh harness session (root-change guard).
  const clearRes = await http(`/api/assistant/conversations/${conversationId}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: null },
  });
  record("owner clears the root (API)", clearRes.status === 200 && clearRes.body?.conversation?.workspaceRoot === null, `status ${clearRes.status}`);
  const clearedListing = await http(`/api/assistant/conversations/${conversationId}/workspace`, { cookie: ownerLogin.cookie });
  record(
    "listing reports the cleared root",
    clearedListing.status === 200 && clearedListing.body?.workspace?.exists === false,
    `status ${clearedListing.status} ${JSON.stringify(clearedListing.body?.workspace)}`
  );

  const crmTurn = await nativeTurn({
    runtime, tenantId: owner.id, actorId: owner.id, conversationOwnerId: ownerUserId,
    conversationId, workspaceRootRealpath: null, permissionMode: ownerMode, task: LIST_TASK,
  });
  // CRM mode: the turn boots at the repo root, so an ls shows the repo files
  // and the marker is gone. The model may answer with either the listing or
  // the instructed "NO MARKER FOUND" — both are correct CRM behaviour.
  const crmListedRepo = crmTurn.toolResults.some(
    (toolResult) => typeof toolResult.result === "string" && /package\.json/.test(toolResult.result)
  );
  record(
    "cleared root restores CRM behaviour (marker gone, repo files present)",
    !crmTurn.threw && !/cyraops-probe-marker\.txt/.test(crmTurn.finalText) && (crmListedRepo || /NO MARKER FOUND/.test(crmTurn.finalText)),
    `final=${JSON.stringify(crmTurn.finalText.slice(0, 240))} listedRepo=${crmListedRepo}`
  );
  record(
    "root change starts a fresh harness session (no adoptability crash)",
    Boolean(rooted.announcedSessionId) && Boolean(crmTurn.announcedSessionId) && rooted.announcedSessionId !== crmTurn.announcedSessionId,
    `rooted=${rooted.announcedSessionId} crm=${crmTurn.announcedSessionId}`
  );

  // 7. AI surface (AiConversation — the Phase A schema model).
  const agent = await prisma.aiAgent.findFirst({ where: { status: "ACTIVE" } });
  const aiConv = await prisma.aiConversation.create({ data: { agentId: agent.id, userId: owner.id, title: "workspace-root-probe" } });
  cleanup.push(() => prisma.aiConversation.deleteMany({ where: { id: aiConv.id } }));
  const aiSet = await http(`/api/ai/conversations/${aiConv.id}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: PROBE_ROOT },
  });
  record(
    "AI conversation: owner sets root",
    aiSet.status === 200 && aiSet.body?.conversation?.workspaceRootRealpath === storedRealpath,
    `status ${aiSet.status} ${JSON.stringify(aiSet.body?.conversation)}`
  );
  const aiList = await http(`/api/ai/conversations/${aiConv.id}/workspace`, { cookie: ownerLogin.cookie });
  record("AI conversation: GET listing", aiList.status === 200 && aiList.body?.workspace?.exists === true, `status ${aiList.status}`);
  const aiMemberSet = await http(`/api/ai/conversations/${aiConv.id}/workspace-root`, {
    method: "POST", cookie: memberCookie, body: { path: PROBE_ROOT },
  });
  record("AI conversation: non-owner gets 404", aiMemberSet.status === 404, `status ${aiMemberSet.status}`);
  const aiClear = await http(`/api/ai/conversations/${aiConv.id}/workspace-root`, {
    method: "POST", cookie: ownerLogin.cookie, body: { path: null },
  });
  record("AI conversation: clear", aiClear.status === 200 && aiClear.body?.conversation?.workspaceRoot === null, `status ${aiClear.status}`);

  // The root rides the conversation read payload (list endpoint).
  const list = await http(`/api/ai/conversations?agentSlug=${agent.slug}`, { cookie: ownerLogin.cookie });
  const listed = list.body?.conversations?.some?.((conversation) => conversation.id === aiConv.id && conversation.workspaceRoot === null && "workspaceRootRealpath" in conversation);
  record("AI conversation read payload carries the root fields", list.status === 200 && listed === true, `status ${list.status}`);
}

// ---------------------------------------------------------------------------
// Teardown: revert every probe artifact.
// ---------------------------------------------------------------------------
async function teardown() {
  for (const step of [...cleanup].reverse()) {
    try {
      await step();
    } catch (error) {
      console.error(`[probe] cleanup step failed: ${error?.message}`);
    }
  }
  await rm(PROBE_ROOT, { recursive: true, force: true });
  console.log("[probe] probe root removed");
}

try {
  await main();
} catch (error) {
  console.error(`[probe] ABORTED: ${error?.stack || error?.message}`);
} finally {
  await teardown();
  await prisma.$disconnect();
  const failed = results.filter((result) => !result.ok);
  const summary = {
    total: results.length,
    passed: results.length - failed.length,
    failed: failed.map((result) => result.name),
    results,
  };
  console.log(`[probe] SUMMARY ${summary.passed}/${summary.total} passed`);
  const { writeFile: writeEvidence, mkdir: makeDir } = await import("node:fs/promises");
  await makeDir("scratch/workspace-root-probe", { recursive: true });
  await writeEvidence("scratch/workspace-root-probe/evidence.json", `${JSON.stringify(summary, null, 2)}\n`);
  if (failed.length > 0) process.exitCode = 1;
}
