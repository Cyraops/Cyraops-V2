import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODEL_CHOICES, isValidModel, resolveModel } from "./model";

describe("model catalog", () => {
  it("declares exactly the two DeepSeek API models", () => {
    assert.deepEqual(
      MODEL_CHOICES.map((choice) => choice.id),
      ["deepseek-chat", "deepseek-reasoner"]
    );
    assert.deepEqual(
      MODEL_CHOICES.map((choice) => choice.label),
      ["DeepSeek Chat (fast)", "DeepSeek Reasoner (thinking)"]
    );
  });
});

describe("isValidModel", () => {
  it("accepts a catalog id", () => {
    assert.equal(isValidModel("deepseek-chat"), true);
    assert.equal(isValidModel("deepseek-reasoner"), true);
  });

  it("rejects unknown, empty, and non-string values", () => {
    assert.equal(isValidModel("deepseek-flash"), false);
    assert.equal(isValidModel(""), false);
    assert.equal(isValidModel(null), false);
    assert.equal(isValidModel(undefined), false);
    assert.equal(isValidModel(42), false);
  });
});

describe("resolveModel", () => {
  it("returns the stored override", () => {
    assert.equal(resolveModel({ model: "deepseek-reasoner" }), "deepseek-reasoner");
  });

  it("returns null for an absent/cleared override (harness default)", () => {
    assert.equal(resolveModel({ model: null }), null);
    assert.equal(resolveModel({}), null);
  });

  it("is null-safe for a missing workspace", () => {
    assert.equal(resolveModel(null), null);
    assert.equal(resolveModel(undefined), null);
  });
});
