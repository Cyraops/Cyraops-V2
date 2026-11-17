/**
 * Tool-call markup that some models emit as plain text.
 *
 * DeepSeek occasionally writes its tool calls in a DSML-like syntax instead of
 * using the provider's native tool channel:
 *
 *   < | | DSML | | calls>
 *   < | | DSML | | invoke name="search_activities">
 *   ...
 *
 * That text is not a tool call and must never reach the reader as if it were
 * prose — it leaks the plumbing and looks broken. The runtime still executes
 * real tool calls through the provider API; this only removes stray markup from
 * text that is going to be read or stored.
 */

/**
 * The bars can arrive as full-width ｜ (U+FF5C) rather than ASCII |, and the
 * angle brackets as full-width ＜ ＞ (U+FF1C/U+FF1E). All four appear in
 * practice, so every pattern accepts both forms.
 */
const BAR = "[|｜]";
const OPEN = "[<＜]";
const CLOSE = "[>＞]";
const BLOCK = new RegExp(`${OPEN}\\s*${BAR}+\\s*DSML\\s*${BAR}+[\\s\\S]*?${OPEN}\\s*\\/\\s*${BAR}+\\s*DSML\\s*${BAR}+\\s*calls\\s*${CLOSE}`, "gi");
const SINGLE = new RegExp(`${OPEN}\\s*${BAR}+\\s*DSML\\s*${BAR}+[^${CLOSE.slice(1, -1)}]*${CLOSE}`, "gi");
const INVOKE = new RegExp(`${OPEN}\\s*${BAR}+\\s*DSML\\s*${BAR}+[\\s\\S]*?(?=\\n\\s*\\n|$)`, "gi");
/** A bare "｜｜DSML｜｜ calls" line with no brackets at all. */
const BARE = new RegExp(`${BAR}{1,2}\\s*DSML\\s*${BAR}{1,2}[^\\n]*`, "gi");

export function stripToolMarkup(input: string): string {
  if (!input || !/DSML/i.test(input)) return input ?? "";
  let text = input.replace(BLOCK, "").replace(SINGLE, "").replace(BARE, "");
  // Anything still dangling from an unterminated block.
  text = text.replace(INVOKE, "");
  // Collapse the blank lines the removal leaves behind.
  return text.replace(/\n{3,}/g, "\n\n").trim();
}

/** True when the text looks like it was mostly markup, i.e. nothing useful to show. */
export function isMostlyToolMarkup(input: string): boolean {
  if (!input) return false;
  const stripped = stripToolMarkup(input);
  return stripped.length === 0 && input.trim().length > 0;
}
