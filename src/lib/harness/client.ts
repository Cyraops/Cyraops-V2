/**
 * The Cyraops bot's engine: a DeepSeek Harness profile, run headlessly.
 *
 * The harness ships as a CLI (`dsh --profile headless`), not a library — it has
 * no main/exports and cannot be imported. So V2 treats it as a process: one task
 * in, newline-delimited JSON events out, the final answer at the end. A longer
 * lived SDK (dsh-sdk-jsonrpc-server) is the production target; see
 * CYRAOPS_ARCHITECTURE_DECISION.md.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { finalTextOf, parseHarnessLine, sessionIdOf } from "./events";

export interface HarnessEvent {
  type: string;
  text?: string;
  sessionId?: string;
  phase?: string;
  turn?: number;
  step?: number;
  reason?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  [key: string]: unknown;
}

export interface HarnessResult {
  text: string;
  sessionId: string | null;
  events: HarnessEvent[];
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

export interface HarnessOptions {
  task: string;
  sessionId?: string;
  cwd?: string;
  timeoutMs?: number;
  /** Per-spawn environment (e.g. CYRAOPS_WORKSPACE_ID tenant scoping). */
  env?: NodeJS.ProcessEnv;
  /**
   * The harness sandbox preset for this turn (DSH permission presets:
   * "read-only" | "workspace-write" | "danger-full-access"). Omitted keeps
   * the harness's default preset, exactly as before.
   */
  permissionPreset?: "read-only" | "workspace-write" | "danger-full-access";
  /**
   * Project-work harness (Phase A): absolute directories granted as
   * additional writable roots under the workspace-write preset via the
   * harness CLI's --add-dir (repeatable). The per-conversation project root
   * rides here, one spawn per turn.
   */
  addDir?: string[];
  /** SYSTEM permission mode: re-enable the harness system tools (skip the overlay). */
  systemTools?: boolean;
  onEvent?: (event: HarnessEvent) => void;
}

/** Resolved at runtime, so no machine-specific path ends up in package.json. */
export function harnessProfile(): string {
  return process.env.HARNESS_PROFILE?.trim() || "headless";
}

export function harnessBinary(): string {
  return process.env.HARNESS_BIN?.trim() || "dsh";
}

/**
 * The full CLI argument vector for one turn, exported pure so the permission
 * mapping is unit-testable without spawning a process. `--patch` is a
 * top-level CLI option and must precede --profile (the headless app parser
 * does not accept it after).
 */
export function buildSpawnArgs(options: {
  task: string;
  sessionId?: string;
  permissionPreset?: "read-only" | "workspace-write" | "danger-full-access";
  systemTools?: boolean;
  cwd?: string;
  /** Absolute directories appended as --add-dir (workspace-write grants). */
  addDir?: string[];
}): string[] {
  const args = ["--json", "--approval-policy", "never"];
  if (options.permissionPreset) args.push("--permission-mode", options.permissionPreset);
  // Project-work harness (Phase A): the per-turn project root rides as
  // --add-dir so the CLI harness grants it as an additional writable root
  // under the workspace-write preset for exactly this spawn.
  for (const dir of options.addDir ?? []) {
    if (dir) args.push("--add-dir", dir);
  }
  // Security overlay: disable the harness's shell/filesystem tools in every
  // Cyraops CLI turn (same rows the native profile patch disables), except
  // for SYSTEM permission mode, which explicitly opts back in.
  const overlay = path.join(
    options.cwd ?? process.cwd(),
    "vendor",
    "tooling",
    "vendored-boot",
    "system-tools-off.patch.yml"
  );
  if (existsSync(overlay) && !options.systemTools) args.unshift("--patch", overlay, "--profile", harnessProfile());
  else args.unshift("--profile", harnessProfile());
  if (options.sessionId) args.push("--session-id", options.sessionId);
  args.push(options.task);
  return args;
}

export async function runHarnessTask(options: HarnessOptions): Promise<HarnessResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const args = buildSpawnArgs({
    task: options.task,
    sessionId: options.sessionId,
    permissionPreset: options.permissionPreset,
    systemTools: options.systemTools,
    cwd: options.cwd,
    addDir: options.addDir,
  });

  return new Promise<HarnessResult>((resolve) => {
    // Next's build rejects dynamic spawn in App Routes unless excluded from static analysis.
    const child = spawn(/* turbopackIgnore: true */ harnessBinary(), args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const events: HarnessEvent[] = [];
    let sessionId: string | null = options.sessionId ?? null;
    let stderr = "";
    let buffer = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        index = buffer.indexOf("\n");
        if (!line) continue;
        const event = parseHarnessLine(line);
        if (event) {
          events.push(event);
          const announced = sessionIdOf([event]);
          if (announced) sessionId = announced;
          options.onEvent?.(event);
        }
      }
    });

    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ text: "", sessionId, events, stderr: `${stderr}\n${error.message}`, code: null, timedOut });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const text = finalTextOf(events);
      resolve({ text, sessionId, events, stderr, code, timedOut });
    });
  });
}
