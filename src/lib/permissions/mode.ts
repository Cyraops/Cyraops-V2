/**
 * The unified Cyraops Permission Manager's mode model (CYRAOPS_PERMISSION_AUDIT.md §8).
 *
 * Four named modes, stored per workspace and overridable per agent:
 * - READ_ONLY    — every mutating action is denied; the harness runs read-only.
 * - CONTROLLED   — the default: reads run, writes wait for approval (today's behaviour).
 * - FULL_CONTROL — the workspace OWNER's actions run without approval (audited);
 *                  everyone else falls back to CONTROLLED.
 * - SYSTEM       — FULL_CONTROL behaviour plus the harness system tools
 *                  (tool-bash / tool-fs / tool-fs-search) are mounted.
 *
 * This module is the single authority for resolving the effective mode and for
 * mapping it onto the two engines (V1 policy resolver + harness runtime).
 */

import { db } from "@/lib/db";

export const PERMISSION_MODES = ["READ_ONLY", "CONTROLLED", "FULL_CONTROL", "SYSTEM"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const DEFAULT_PERMISSION_MODE: PermissionMode = "CONTROLLED";

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === "string" && (PERMISSION_MODES as readonly string[]).includes(value);
}

/** Unknown or missing values fall back to the safe default (CONTROLLED). */
export function normalizePermissionMode(value: unknown): PermissionMode {
  return isPermissionMode(value) ? value : DEFAULT_PERMISSION_MODE;
}

/**
 * The precedence rule: an agent override wins over the workspace value, which
 * wins over the default. Null means "inherit", not "off".
 */
export function effectivePermissionMode(
  agentMode: PermissionMode | null | undefined,
  workspaceMode: PermissionMode | null | undefined
): PermissionMode {
  return agentMode ?? workspaceMode ?? DEFAULT_PERMISSION_MODE;
}

/**
 * Resolve the effective permission mode for a turn from an ALREADY-RESOLVED
 * workspace (see `resolveWorkspaceForUser` in @/lib/workspace-resolve) plus an
 * optional agent override. `agentSlug` names an AiAgent whose override (if
 * set) wins.
 *
 * `workspace === null` means "no workspace for this caller" — the effective
 * mode falls back to CONTROLLED, never to a singleton row or another tenant's
 * mode. Doing the workspace lookup in one place (resolveWorkspaceForUser) is
 * what makes the multi-tenant case safe: this function no longer guesses.
 */
export async function resolvePermissionMode(input: {
  workspace?: { permissionMode: PermissionMode | null } | null;
  agentSlug?: string | null;
}): Promise<PermissionMode> {
  const agent = input.agentSlug
    ? await db.aiAgent.findFirst({
        where: { slug: input.agentSlug },
        select: { permissionMode: true },
      })
    : null;
  return effectivePermissionMode(agent?.permissionMode, input.workspace?.permissionMode);
}

/** READ_ONLY is the only mode in which nothing may change. */
export function canWrite(mode: PermissionMode): boolean {
  return mode !== "READ_ONLY";
}

/**
 * FULL_CONTROL (and SYSTEM, which behaves like it) auto-approves only for the
 * workspace OWNER; anyone else falls back to CONTROLLED behaviour.
 */
export function canAutoApprove(mode: PermissionMode, role: string | null | undefined): boolean {
  if (mode !== "FULL_CONTROL" && mode !== "SYSTEM") return false;
  return (role ?? "").toUpperCase() === "OWNER";
}

/** SYSTEM is the only mode that mounts the harness shell/filesystem tools. */
export function allowsSystemTools(mode: PermissionMode): boolean {
  return mode === "SYSTEM";
}

/**
 * The effective mode a turn should run under once the requester's role is
 * known: a non-owner asking under FULL_CONTROL/SYSTEM gets CONTROLLED.
 */
export function runtimePermissionMode(
  mode: PermissionMode,
  requesterRole?: string | null
): PermissionMode {
  if ((mode === "FULL_CONTROL" || mode === "SYSTEM") && !canAutoApprove(mode, requesterRole)) {
    return "CONTROLLED";
  }
  return mode;
}

// ---------------------------------------------------------------------------
// Harness runtime mapping (DSH_PERMISSION_MODE presets / --permission-mode).
// ---------------------------------------------------------------------------

export type HarnessPermissionPreset = "read-only" | "workspace-write" | "danger-full-access";

/** Cyraops mode → the harness sandbox preset it maps onto. */
export function harnessPermissionPreset(mode: PermissionMode): HarnessPermissionPreset {
  switch (mode) {
    case "READ_ONLY":
      return "read-only";
    case "FULL_CONTROL":
    case "SYSTEM":
      return "danger-full-access";
    default:
      return "workspace-write";
  }
}

/**
 * CLI spawn args for a mode: CONTROLLED is the harness default and adds
 * nothing; every other mode names its preset explicitly.
 */
export function cliPermissionArgs(mode: PermissionMode): string[] {
  if (mode === "CONTROLLED") return [];
  return ["--permission-mode", harnessPermissionPreset(mode)];
}

/** The system-tools-off overlay stays on for every mode except SYSTEM. */
export function systemToolsEnabled(mode: PermissionMode): boolean {
  return allowsSystemTools(mode);
}
