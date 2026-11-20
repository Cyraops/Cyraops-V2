/**
 * The workspace model selector (Settings → Permissions → Model).
 *
 * The DeepSeek Harness's llm-deepseek adapter lists exactly two official
 * models from the DeepSeek API (`model listing … loaded 2 model(s)`):
 * `deepseek-chat` (fast, conversational) and `deepseek-reasoner` (thinking).
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
  { id: "deepseek-chat", label: "DeepSeek Chat (fast)" },
  { id: "deepseek-reasoner", label: "DeepSeek Reasoner (thinking)" },
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
