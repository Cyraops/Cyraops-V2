#!/usr/bin/env node
/**
 * tier2-jobs-goal-probe/probe-jobs-goal.mjs — PART 2 evidence probe.
 *
 * Our architecture is request-scoped: every chat turn boots a FRESH vendored
 * cordis tree in-process and disposes it at the end of the turn; the only
 * thing that survives is the harness session journal under DSH_HOME/sessions
 * (keyed by the session id the route persists per conversation).
 *
 * This probe reproduces exactly that: N turns through runNativeTask, each in
 * a fresh tree, resuming the same session id. It asks:
 *   T1: create a goal via the goal tools (tool_result captured)
 *   T2 (fresh tree): read the goal back — does it persist?
 *   T3: start a background job via the bash tool (run_in_background), list jobs
 *   T4 (fresh tree): list jobs — do live jobs survive the tree disposal?
 * Afterwards it scans DSH_HOME/sessions for the session journal files to
 * show what IS durable (log events) vs what is not (live job records).
 *
 * Usage: node scratch/tier2-jobs-goal-probe/probe-jobs-goal.mjs [sessionId]
 * (run from the repo root)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runNativeTask } from "../../vendor/tooling/vendored-boot/native-host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const OUT = path.join(HERE, "evidence-jobs-goal.json");
const SESSION_ARG = process.argv[2];

const log = (message) => process.stderr.write(`[probe-jobs-goal] ${message}\n`);

/** One turn = one fresh tree (exactly the chat route's request scope). */
async function turn({ task, sessionId, systemTools = false, timeoutMs = 300_000 }) {
  const events = [];
  let runFailure = null;
  try {
    for await (const event of runNativeTask({
      task,
      sessionId,
      projectRoot: REPO_ROOT,
      approvalPolicy: "ask",
      systemTools,
      timeoutMs,
      log: (m) => process.stderr.write(`[host] ${m}\n`),
    })) {
      events.push(event);
    }
  } catch (error) {
    runFailure = String(error?.message ?? error);
  }
  const census = {};
  for (const event of events) {
    const key = `${event.type}${event.phase ? `/${event.phase}` : ""}`;
    census[key] = (census[key] ?? 0) + 1;
  }
  const toolCalls = events.filter((e) => e.type === "tool_call").map((e) => ({ callId: e.callId, tool: e.tool, input: e.input }));
  const toolResults = events.filter((e) => e.type === "tool_result").map((e) => ({ callId: e.callId, status: e.status, result: e.result, error: e.error }));
  const final = [...events].reverse().find((e) => e.type === "final");
  return { census, toolCalls, toolResults, finalText: final?.text ?? "", sessionEvent: events.find((e) => e.type === "session") ?? null, runFailure, events };
}

const results = {};

// ---- T1: create a goal (fresh session; capture the announced id) -----------
let goalSessionId = SESSION_ARG ?? null;
try {
  results.t1 = await turn({
    task: "Use your goal tools (create_goal) to create a goal with the objective \"Improve the Cyraops CRM onboarding flow so new workspaces reach their first ticket in under five minutes\". Then reply with exactly the goal view the tool returned (objective, phase, id).",
  });
  goalSessionId ??= results.t1.sessionEvent?.sessionId ?? null;
  log(`T1 done (session=${goalSessionId}): ${JSON.stringify(results.t1.census)}${results.t1.runFailure ? ` RUN FAILED: ${results.t1.runFailure.slice(0, 120)}` : ""}`);
} catch (error) {
  results.t1 = { error: String(error?.message ?? error) };
  log(`T1 failed: ${results.t1.error}`);
}

// ---- T2: read the goal back in a FRESH tree ---------------------------------
try {
  results.t2 = await turn({
    sessionId: goalSessionId ?? undefined,
    task: "Use your get_goal tool to read your current goal. Report the exact objective, phase, and id the tool returned. If there is no goal, say exactly: NO GOAL.",
  });
  log(`T2 done: ${JSON.stringify(results.t2.census)}`);
} catch (error) {
  results.t2 = { error: String(error?.message ?? error) };
  log(`T2 failed: ${results.t2.error}`);
}

// ---- T3: start a background job in a fresh tree -----------------------------
let jobsSessionId = null;
try {
  results.t3 = await turn({
    sessionId: undefined,
    systemTools: true, // probe-only: bash disabled for normal chat turns
    task: "Use the bash tool with run_in_background=true to start `sleep 300` in the background. Then use job_list to list your jobs and report every job id, kind and status it returns.",
  });
  jobsSessionId = results.t3.sessionEvent?.sessionId ?? null;
  log(`T3 done (session=${jobsSessionId}): ${JSON.stringify(results.t3.census)}`);
} catch (error) {
  results.t3 = { error: String(error?.message ?? error) };
  log(`T3 failed: ${results.t3.error}`);
}

// ---- T4: list jobs again in a FRESH tree (same session) ----------------------
try {
  results.t4 = await turn({
    sessionId: jobsSessionId ?? undefined,
    systemTools: true,
    task: "Use job_list to list your background jobs. Report exactly what it returns. If the list is empty, say exactly: EMPTY JOB LIST.",
  });
  log(`T4 done: ${JSON.stringify(results.t4.census)}`);
} catch (error) {
  results.t4 = { error: String(error?.message ?? error) };
  log(`T4 failed: ${results.t4.error}`);
}

// ---- Session journal scan ---------------------------------------------------
const dshHome = process.env.DSH_HOME ?? "/Users/tanveersinghsaini/.dsh";
const sessionsDir = path.join(dshHome, "sessions");
const journalFiles = [];
try {
  const visit = (dir, prefix) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) visit(full, `${prefix}${entry}/`);
      else if (entry === "session.v4.jsonl.zstd") {
        journalFiles.push({ name: `${prefix}${entry}`, bytes: stat.size, mtime: stat.mtime.toISOString() });
      }
    }
  };
  visit(sessionsDir, "");
} catch (error) {
  journalFiles.push({ error: String(error?.message ?? error) });
}
// Session journal records relevant to jobs/goals, for both probe sessions.
const journalRecords = {};
for (const sessionId of [goalSessionId, jobsSessionId].filter(Boolean)) {
  const candidates = journalFiles.filter((f) => typeof f.name === "string" && f.name.includes(sessionId));
  const records = [];
  for (const file of candidates) {
    try {
      const raw = fs.readFileSync(path.join(sessionsDir, file.name));
      // session journals are zstd-compressed (session.v4.jsonl.zstd); try zstd,
      // else fall back to raw text (older layout).
      let text = raw.toString("utf8");
      try {
        const { execFileSync } = await import("node:child_process");
        text = execFileSync("zstd", ["-d", "-c", path.join(sessionsDir, file.name)], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
      } catch { /* not zstd or zstd missing */ }
      const lines = text.split("\n").filter(Boolean);
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          const type = parsed?.type;
          if (typeof type === "string" && /goal|job/i.test(type)) {
            records.push({ file: file.name, type, seq: parsed?.seq, data: parsed?.data });
          }
        } catch { /* non-JSON or partial line */ }
      }
    } catch (error) {
      records.push({ file: file.name, error: String(error?.message ?? error) });
    }
  }
  journalRecords[sessionId] = records;
}

const summary = {
  goalSessionId,
  jobsSessionId,
  t1: { census: results.t1.census, toolCalls: results.t1.toolCalls, toolResults: results.t1.toolResults, finalText: results.t1.finalText, error: results.t1.error, runFailure: results.t1.runFailure },
  t2: { census: results.t2.census, toolCalls: results.t2.toolCalls, toolResults: results.t2.toolResults, finalText: results.t2.finalText, error: results.t2.error, runFailure: results.t2.runFailure },
  t3: { census: results.t3.census, toolCalls: results.t3.toolCalls, toolResults: results.t3.toolResults, finalText: results.t3.finalText, error: results.t3.error, runFailure: results.t3.runFailure },
  t4: { census: results.t4.census, toolCalls: results.t4.toolCalls, toolResults: results.t4.toolResults, finalText: results.t4.finalText, error: results.t4.error, runFailure: results.t4.runFailure },
  journalFiles,
  journalRecords,
};
fs.writeFileSync(OUT, JSON.stringify(summary, null, 2));
log(`wrote ${OUT}`);
log(`T2 goal persistence verdict: ${JSON.stringify(results.t2.finalText ?? results.t2.error).slice(0, 300)}`);
log(`T4 jobs verdict: ${JSON.stringify(results.t4.finalText ?? results.t4.error).slice(0, 300)}`);
