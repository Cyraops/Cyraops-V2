/**
 * Models sometimes write tool calls as text. That text must never be read as if
 * it were the assistant's answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isMostlyToolMarkup, stripToolMarkup } from "./tool-markup";

const LEAK = `< || DSML || calls>
< || DSML || invoke name="search_activities">
< || DSML || parameter name="query" string="true">meeting US client< / || DSML || parameter>
</ || DSML || invoke>
< / || DSML || calls>`;

test("a leaked tool block is removed entirely, contents included", () => {
  // Everything between the delimiters is the tool call itself, not prose.
  assert.equal(stripToolMarkup(`< || DSML || calls>invoke< / || DSML || calls>`).trim(), "");
  assert.equal(stripToolMarkup(LEAK).trim(), "");
});

test("prose around a leaked block survives", () => {
  const text = stripToolMarkup(`Here is what I found:\n\n${LEAK}\n\nTwo deals moved.`);
  assert.match(text, /Here is what I found/);
  assert.match(text, /Two deals moved\./);
  assert.doesNotMatch(text, /DSML/);
});

test("normal text is untouched, including angle brackets", () => {
  assert.equal(stripToolMarkup("Pipeline is 4.2L < 5L"), "Pipeline is 4.2L < 5L");
  assert.equal(stripToolMarkup("<b>bold</b>"), "<b>bold</b>");
  assert.equal(stripToolMarkup(""), "");
});

test("an unterminated block does not swallow the whole reply", () => {
  const text = stripToolMarkup(`< || DSML || calls>\n< || DSML || invoke name="x">\n\nUseful conclusion.`);
  assert.match(text, /Useful conclusion\./);
});

test("blank lines left behind are collapsed", () => {
  assert.doesNotMatch(stripToolMarkup(`a\n\n${LEAK}\n\n\nb`), /\n{3,}/);
});

test("isMostlyToolMarkup distinguishes nothing-left from real text", () => {
  assert.equal(isMostlyToolMarkup(LEAK), true);
  assert.equal(isMostlyToolMarkup("Real answer"), false);
  assert.equal(isMostlyToolMarkup(""), false);
});

test("full-width bars and brackets are stripped too", () => {
  const leaked = [
    "Here is what is due.",
    "",
    "<｜｜DSML｜｜ calls>",
    '<｜｜DSML｜｜ invoke name="list_schedule">',
    '<｜｜DSML｜｜ parameter name="days" string="true">90</｜｜DSML｜｜ parameter>',
    "</｜｜DSML｜｜ invoke>",
    "</｜｜DSML｜｜ calls>",
  ].join("\n");

  const clean = stripToolMarkup(leaked);
  assert.equal(clean, "Here is what is due.");
  assert.ok(!/DSML/i.test(clean));
});

test("a bare DSML line with no brackets is removed", () => {
  const clean = stripToolMarkup("Answer first.\n｜｜DSML｜｜ invoke name=\"x\"");
  assert.equal(clean, "Answer first.");
});
