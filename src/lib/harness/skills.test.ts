import assert from "node:assert/strict";
import { test } from "node:test";
import { HARNESS_SKILLS, listHarnessSkills, type HarnessSkill } from "./skills";

test("the harness skills catalog is non-empty and curated", () => {
  assert.ok(HARNESS_SKILLS.length > 0);
});

test("every skill carries a non-empty id, name and description", () => {
  for (const skill of HARNESS_SKILLS) {
    assert.ok(skill.id.trim().length > 0, `id must be non-empty: ${JSON.stringify(skill)}`);
    assert.ok(skill.name.trim().length > 0, `name must be non-empty: ${JSON.stringify(skill)}`);
    assert.ok(skill.description.trim().length > 0, `description must be non-empty: ${JSON.stringify(skill)}`);
  }
});

test("ids are unique", () => {
  const ids = HARNESS_SKILLS.map((skill) => skill.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("catalog matches the vendored dsh-skill packages mounted by dsh-base", () => {
  const ids = HARNESS_SKILLS.map((skill) => skill.id).sort();
  assert.deepEqual(ids, ["dsh-skill", "dsh-skill-filesystem", "dsh-tool-skill"]);
});

test("descriptions are the package.json descriptions, verbatim", () => {
  const byId = new Map(HARNESS_SKILLS.map((skill) => [skill.id, skill.description]));
  assert.equal(byId.get("dsh-skill"), "Agent skill provider registry for the DeepSeek Harness");
  assert.equal(byId.get("dsh-skill-filesystem"), "Local filesystem skill provider for the DeepSeek Harness");
  assert.equal(byId.get("dsh-tool-skill"), "Model-facing skill loading tool for the DeepSeek Harness");
});

test("listHarnessSkills returns a defensive copy", () => {
  const first = listHarnessSkills();
  const second = listHarnessSkills();
  assert.notEqual(first, second);
  assert.deepEqual(first, second);

  const mutating = listHarnessSkills() as HarnessSkill[];
  mutating[0].name = "mutated";
  mutating.pop();
  assert.equal(HARNESS_SKILLS[0].name, "Skills registry");
  assert.equal(HARNESS_SKILLS.length, 3);
});
