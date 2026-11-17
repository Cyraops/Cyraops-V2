import assert from "node:assert/strict";
import { test } from "node:test";
import { nextSentence } from "./sentences";

test("nextSentence: returns null while no boundary has arrived", () => {
  assert.equal(nextSentence(""), null);
  assert.equal(nextSentence("There are three"), null);
  assert.equal(nextSentence("Almost done"), null);
});

test("nextSentence: a period followed by a space ends the sentence", () => {
  const split = nextSentence("One is due. Two are done.");
  assert.deepEqual(split, { sentence: "One is due.", consumed: 11 });
});

test("nextSentence: the trailing space stays unconsumed and belongs to the next sentence", () => {
  const split = nextSentence("One. Two. Three.");
  assert.equal(split?.sentence, "One.");
  const rest = "One. Two. Three.".slice(split.consumed);
  assert.equal(rest, " Two. Three.");
  // The leading space is part of the next sentence's prefix; the caller
  // trims it before speaking (plain() in the voice screen).
  assert.equal(nextSentence(rest)?.sentence, " Two.");
});

test("nextSentence: a period at end-of-string also ends the sentence", () => {
  assert.deepEqual(nextSentence("That is all."), { sentence: "That is all.", consumed: 12 });
});

test("nextSentence: question marks and exclamation marks are boundaries", () => {
  assert.equal(nextSentence("What is due this week? Something else.")?.sentence, "What is due this week?");
  assert.equal(nextSentence("Great! Thanks.")?.sentence, "Great!");
});

test("nextSentence: ellipsis ends a sentence", () => {
  assert.equal(nextSentence("Well… maybe not.")?.sentence, "Well…");
});

test("nextSentence: a boundary followed by a newline works", () => {
  assert.equal(nextSentence("First line.\nSecond line.")?.sentence, "First line.");
});

test("nextSentence: a decimal point is skipped because it is not followed by whitespace", () => {
  // The boundary rule needs punctuation + whitespace (or end-of-string), so
  // the "3." inside "3.14" cannot end a sentence.
  assert.equal(nextSentence("Version 3.14 is out now.")?.sentence, "Version 3.14 is out now.");
});

test("nextSentence: an abbreviation dot followed by a letter is not a boundary", () => {
  // "e.g." is followed by a space, so by the stated rule it IS a boundary:
  // document the accepted behaviour rather than silently changing it.
  assert.equal(nextSentence("Use e.g. this form.")?.sentence, "Use e.g.");
});
