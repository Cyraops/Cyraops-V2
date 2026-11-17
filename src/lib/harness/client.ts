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
    const child = spawn(harnessBinary(), args, {
      cwd: options.cwd ?? process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const events: HarnessEvent[] = [];
    let final = "";
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
        try {
          const event = JSON.parse(line) as HarnessEvent;
          events.push(event);
          if (event.type === "session" && typeof event.sessionId === "string") sessionId = event.sessionId;
          if (event.type === "final" && typeof event.text === "string") final = event.text;
          options.onEvent?.(event);
        } catch {
          // Non-JSON diagnostics, not an event.
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
      const text = final || [...events].reverse().find((event) => event.type === "text" && event.text)?.text || "";
      resolve({ text, sessionId, events, stderr, code, timedOut });
    });
  });
}
