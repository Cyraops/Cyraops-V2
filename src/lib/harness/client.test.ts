import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { buildSpawnArgs } from "./client";

/**
 * CLI spawn-arg mapping for the unified Permission Manager: every mode maps
 * onto --permission-mode (except CONTROLLED, which keeps the harness default)
 * and only SYSTEM omits the system-tools-off overlay.
 */

const repo = process.cwd();
const overlay = join(repo, "vendor", "tooling", "vendored-boot", "system-tools-off.patch.yml");

test("buildSpawnArgs: CONTROLLED keeps the historical vector (overlay on, no preset arg)", () => {
  assert.deepEqual(buildSpawnArgs({ task: "hi" }), [
    "--patch",
    overlay,
    "--profile",
    "headless",
    "--json",
    "--approval-policy",
    "never",
    "hi",
  ]);
});

test("buildSpawnArgs: READ_ONLY names the read-only preset and keeps the overlay", () => {
  assert.deepEqual(buildSpawnArgs({ task: "hi", permissionPreset: "read-only" }), [
    "--patch",
    overlay,
    "--profile",
    "headless",
    "--json",
    "--approval-policy",
    "never",
    "--permission-mode",
    "read-only",
    "hi",
  ]);
});

test("buildSpawnArgs: FULL_CONTROL names danger-full-access and keeps the overlay", () => {
  assert.deepEqual(buildSpawnArgs({ task: "hi", permissionPreset: "danger-full-access" }), [
    "--patch",
    overlay,
    "--profile",
    "headless",
    "--json",
    "--approval-policy",
    "never",
    "--permission-mode",
    "danger-full-access",
    "hi",
  ]);
});

test("buildSpawnArgs: SYSTEM re-enables system tools by omitting the overlay", () => {
  assert.deepEqual(buildSpawnArgs({ task: "hi", permissionPreset: "danger-full-access", systemTools: true }), [
    "--profile",
    "headless",
    "--json",
    "--approval-policy",
    "never",
    "--permission-mode",
    "danger-full-access",
    "hi",
  ]);
});

test("buildSpawnArgs: session id still lands between policy args and the task", () => {
  assert.deepEqual(buildSpawnArgs({ task: "go", sessionId: "s1", permissionPreset: "read-only" }), [
    "--patch",
    overlay,
    "--profile",
    "headless",
    "--json",
    "--approval-policy",
    "never",
    "--permission-mode",
    "read-only",
    "--session-id",
    "s1",
    "go",
  ]);
});

test("buildSpawnArgs: a missing overlay file degrades to profile-only (never blocks the turn)", () => {
  const args = buildSpawnArgs({ task: "hi", cwd: "/nonexistent-cwd" });
  assert.deepEqual(args, ["--profile", "headless", "--json", "--approval-policy", "never", "hi"]);
});

test("buildSpawnArgs: a project workspace root rides as --add-dir (Phase A)", () => {
  assert.deepEqual(
    buildSpawnArgs({ task: "hi", permissionPreset: "workspace-write", addDir: ["/work/project"] }),
    [
      "--patch",
      overlay,
      "--profile",
      "headless",
      "--json",
      "--approval-policy",
      "never",
      "--permission-mode",
      "workspace-write",
      "--add-dir",
      "/work/project",
      "hi",
    ]
  );
});

test("buildSpawnArgs: no root keeps the vector byte-identical (CRM mode)", () => {
  assert.deepEqual(buildSpawnArgs({ task: "hi", permissionPreset: "workspace-write", addDir: [] }), [
    "--patch",
    overlay,
    "--profile",
    "headless",
    "--json",
    "--approval-policy",
    "never",
    "--permission-mode",
    "workspace-write",
    "hi",
  ]);
});
