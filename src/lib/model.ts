/**
 * The workspace model selector (Settings → Permissions → Model).
 *
 * The DeepSeek Harness's llm-deepseek adapter lists exactly two official
 * models from the DeepSeek API — verified live: `deepseek-flash` (the
 * configured default) and `deepseek-v4-pro` (most capable).
 * A workspace stores at most one of these as an override; `null` means "the
 * harness's configured default" (the agent-default-model composition entry).
 *
 * This module is the single authority for the choice set and for validating
 * / resolving a stored value, so the API, the UI and the turn routes can
 * never disagree about which ids are selectable.
 */

export interface ModelChoice {
  id: string;
  label: string;
}

export const MODEL_CHOICES: readonly ModelChoice[] = [
  { id: "deepseek-flash", label: "DeepSeek Flash (fast · default)" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro (most capable)" },
] as const;

export type ModelId = (typeof MODEL_CHOICES)[number]["id"];

/** True only for an id the selectable catalog declares. */
export function isValidModel(value: unknown): value is ModelId {
  return typeof value === "string" && MODEL_CHOICES.some((choice) => choice.id === value);
}

/**
 * Resolve a workspace's stored model override: the stored id, or `null` when
 * it is absent (the harness's configured default). Null-safe for the routes,
 * which resolve the workspace through `resolveWorkspaceForUser` (null when the
 * caller owns no workspace).
 */
export function resolveModel(workspace: { model?: string | null } | null | undefined): string | null {
  return workspace?.model ?? null;
}
