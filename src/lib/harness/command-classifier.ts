/**
 * Server-side classification of shell commands typed into the Workspace
 * panel's command box. Pure and side-effect free so the pattern list is
 * unit-testable without a database or a harness runtime.
 *
 * The list below is THE documented gate: a command matching any pattern is
 * never executed until the user allows it through the approval broker (the
 * same card tool approvals use). Patterns deliberately over-match — an
 * approval prompt costs a click, a missed destructive pattern costs data —
 * and every pattern is a conservative approximation of the dangerous shape.
 * No pattern list can be complete: this gate is defense for the SYSTEM
 * permission mode, not a replacement for it (the mode itself is the primary
 * control, and non-SYSTEM workspaces never reach execution at all).
 */

/** The longest command the box accepts (mirrored by the stream route). */
export const COMMAND_MAX_LENGTH = 4000;

export interface DestructiveCommandPattern {
  /** Stable id shown in reports/tests. */
  id: string;
  /** One-line human description of the danger. */
  label: string;
  regex: RegExp;
}

/** The documented destructive pattern list. See the module comment. */
export const DESTRUCTIVE_COMMAND_PATTERNS: readonly DestructiveCommandPattern[] = [
  {
    id: "rm-force",
    label: "delete with recursive/force flags (rm -rf family)",
    regex: /\brm\s+(?:-\S+\s+)*(?:--?[a-z]*[rf][a-z]*)\b/i,
  },
  {
    id: "rm-root",
    label: "delete at the filesystem root",
    regex: /\brm\s+(?:-\S+\s+)*\/(?:\s|$)/i,
  },
  {
    id: "git-push-force",
    label: "force push (--force / -f / --force-with-lease)",
    regex: /\bgit\s+push\b[^\n;&|]*(?:--force-with-lease|--force|(?:^|\s)-f(?:\s|$))/i,
  },
  {
    id: "git-reset-hard",
    label: "git reset --hard",
    regex: /\bgit\s+reset\s+--hard\b/i,
  },
  {
    id: "git-clean-force",
    label: "git clean with force flags",
    regex: /\bgit\s+clean\b[^\n;&|]*\s-{1,2}[a-z]*f[a-z]*\b/i,
  },
  {
    id: "git-discard",
    label: "discard working-tree changes (git checkout/restore --)",
    regex: /\bgit\s+(?:checkout|restore)\b[^\n;&|]*\s--(?:\s|$)/i,
  },
  {
    id: "git-branch-delete",
    label: "delete a branch (git branch -D)",
    regex: /\bgit\s+branch\s+-D\b/i,
  },
  {
    id: "redirect-clobber",
    label: "output redirect (overwrites a file; >> appends are not gated)",
    regex: /(?<![=>])\s>(?![=>])\s*\S/,
  },
  {
    id: "dd-write",
    label: "dd writing to an output file (of=)",
    regex: /\bdd\b[\s\S]*\bof=/i,
  },
  {
    id: "mkfs",
    label: "filesystem creation (mkfs family)",
    regex: /\bmkfs(?:\.\S+)?\b/i,
  },
  {
    id: "disk-erase",
    label: "disk erasure (diskutil erase)",
    regex: /\bdiskutil\s+erase(?:Disk|Volume)?\b/i,
  },
  {
    id: "power",
    label: "shutdown / reboot / halt",
    regex: /\b(?:shutdown|reboot|halt|poweroff)\b/i,
  },
  {
    id: "fork-bomb",
    label: "shell fork bomb",
    regex: /(?:\(\)\s*\{|:\s*\|\s*:\s*&)/,
  },
];

export interface CommandClassification {
  /** True when ANY pattern matched — the command needs approval. */
  destructive: boolean;
  /** The patterns that matched, in declaration order. */
  matches: Array<{ id: string; label: string }>;
}

/** Classify a command against the documented pattern list. */
export function classifyCommand(command: string): CommandClassification {
  const matches: Array<{ id: string; label: string }> = [];
  for (const pattern of DESTRUCTIVE_COMMAND_PATTERNS) {
    if (pattern.regex.test(command)) {
      matches.push({ id: pattern.id, label: pattern.label });
    }
  }
  return { destructive: matches.length > 0, matches };
}

export function isDestructiveCommand(command: string): boolean {
  return classifyCommand(command).destructive;
}

/**
 * The task handed to the harness for a command-box turn. The exact wording is
 * part of the contract: the model must execute the command verbatim (the
 * approval gate above has already cleared it) and relay output, not
 * editorialize, refuse, or re-ask for confirmation.
 */
export function commandTaskFor(command: string): string {
  return (
    `Run this shell command and report the output exactly:\n${command}\n\n` +
    "Execute the command verbatim with your shell tool. The user has already approved this command, " +
    "so do not ask for confirmation, do not refuse, and add no commentary — report the command's output exactly."
  );
}

/**
 * The honest answer for a command turn in a workspace whose permission mode
 * does not mount the harness shell tools (anything but SYSTEM).
 */
export const SHELL_DISABLED_REPLY =
  "Shell commands are disabled in this workspace. The workspace's permission mode must be SYSTEM for the assistant to run shell commands.";
