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
  onEvent?: (event: HarnessEvent) => void;
}

/** Resolved at runtime, so no machine-specific path ends up in package.json. */
export function harnessProfile(): string {
  return process.env.HARNESS_PROFILE?.trim() || "headless";
}

export function harnessBinary(): string {
  return process.env.HARNESS_BIN?.trim() || "dsh";
}

export async function runHarnessTask(options: HarnessOptions): Promise<HarnessResult> {
  const timeoutMs = options.timeoutMs ?? 180_000;
  const args = ["--profile", harnessProfile(), "--json", "--approval-policy", "never"];
  if (options.sessionId) args.push("--session-id", options.sessionId);
  args.push(options.task);

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
