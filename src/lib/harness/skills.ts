/**
 * The skill capabilities actually mounted in the Cyraops harness boot.
 *
 * Source of truth (read once at build time, never at runtime): the vendored
 * dsh-skill packages under `vendor/dsh/node_modules/@deepseek-ai/` — their
 * `package.json` `description` fields. The Cyraops native runtime boots the
 * headless profile (`dsh-base` + `dsh-headless` + `@cyraops/harness-crm`),
 * and `dsh-base` mounts exactly these three skill-related packages:
 *
 *   - `@deepseek-ai/dsh-skill`            — the merged skill registry;
 *   - `@deepseek-ai/dsh-skill-filesystem` — local-directory skill discovery;
 *   - `@deepseek-ai/dsh-tool-skill`       — the model-facing skill loader tool.
 *
 * `@deepseek-ai/dsh-skill-office` and `@deepseek-ai/dsh-skill-badge` are
 * *declared* in `vendor/dsh/package.json` (the distribution manifest) but are
 * NOT vendored under `vendor/dsh/node_modules` and are NOT mounted by the
 * headless profile — they ship as optional bundles
 * (`dsh-experimental-badge-skill-bundle`, etc.) that this profile does not
 * enable. They are therefore deliberately excluded from this catalog.
 */

export interface HarnessSkill {
  /** Stable kebab-case id (the package name). */
  id: string;
  /** Human-facing name shown in the Skills rail section. */
  name: string;
  /** The package.json description, verbatim. */
  description: string;
}

export const HARNESS_SKILLS: HarnessSkill[] = [
  {
    id: "dsh-skill",
    name: "Skills registry",
    description: "Agent skill provider registry for the DeepSeek Harness",
  },
  {
    id: "dsh-skill-filesystem",
    name: "Filesystem skills",
    description: "Local filesystem skill provider for the DeepSeek Harness",
  },
  {
    id: "dsh-tool-skill",
    name: "Skill loader",
    description: "Model-facing skill loading tool for the DeepSeek Harness",
  },
];

/** A defensive copy so callers cannot mutate the shared catalog. */
export function listHarnessSkills(): HarnessSkill[] {
  return HARNESS_SKILLS.map((skill) => ({ ...skill }));
}
