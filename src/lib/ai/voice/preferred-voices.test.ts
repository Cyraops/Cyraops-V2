import { test } from "node:test";
import assert from "node:assert/strict";

import { pickVoice, voiceGender, availableGenders } from "./preferred-voices";

const macVoices = [
  { name: "Fred", lang: "en-US" },
  { name: "Veena", lang: "en-IN" },
  { name: "Rishi", lang: "en-IN" },
  { name: "Ava (Premium)", lang: "en-US" },
  { name: "Tom (Enhanced)", lang: "en-US" },
];

test("a premium voice beats a plain one of the same gender", () => {
  assert.equal(pickVoice(macVoices, "female")?.name, "Ava (Premium)");
  assert.equal(pickVoice(macVoices, "male")?.name, "Tom (Enhanced)");
});

test("gender is read from the name", () => {
  assert.equal(voiceGender({ name: "Google UK English Female", lang: "en-GB" }), "female");
  assert.equal(voiceGender({ name: "Google UK English Male", lang: "en-GB" }), "male");
  assert.equal(voiceGender({ name: "Samantha", lang: "en-US" }), "female");
  assert.equal(voiceGender({ name: "Daniel", lang: "en-GB" }), "male");
  assert.equal(voiceGender({ name: "Mystery Voice", lang: "en-US" }), null);
});

test("an unknown voice is never chosen for either gender", () => {
  const odd = [{ name: "Mystery Voice", lang: "en-US" }];
  assert.deepEqual(availableGenders(odd), []);
});

test("local accent breaks a tie between equal quality voices", () => {
  const tie = [
    { name: "Karen", lang: "en-AU" },
    { name: "Veena", lang: "en-IN" },
  ];
  assert.equal(pickVoice(tie, "female")?.name, "Veena");
});

test("a list with only one gender offers only that one", () => {
  const onlyMale = [{ name: "Rishi", lang: "en-IN" }];
  assert.deepEqual(availableGenders(onlyMale), ["male"]);
  assert.equal(pickVoice(onlyMale, "female"), null);
});
