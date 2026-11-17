import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { providerManager } from "./ai/provider-manager";
import { estimateCostUsd, resolveModel } from "./ai/models";

describe("AI Foundation & OpenAI Provider Framework", () => {
  // These tests used to assert that OpenAI was always the active provider with
  // gpt-4o models. The product supports a DeepSeek-only deployment, which is what
  // production actually runs, so that assumption failed for configuration reasons
  // rather than product ones. What is worth locking down is the contract: the
  // selected provider follows AI_PROVIDER, both stay available, and a missing key
  // is reported honestly instead of crashing.
  const selectedProviderId = () => (process.env.AI_PROVIDER ?? "").trim().toLowerCase();

  it("selects the configured provider and keeps the other one available", () => {
    const provider = providerManager.getProvider();
    assert.ok(provider);

    const expected = selectedProviderId();
    if (expected === "openai" || expected === "deepseek") {
      assert.equal(provider.id, expected, "AI_PROVIDER must decide the active provider");
    } else {
      assert.ok(["openai", "deepseek"].includes(provider.id), `unexpected provider ${provider.id}`);
    }

    assert.equal(provider.getCapabilities().supportsTools, true);
    assert.equal(provider.getCapabilities().supportsStreaming, true);

    // Whichever is active, the other must remain constructible and distinct.
    const deepseek = providerManager.getDeepSeekProvider();
    assert.ok(deepseek);
    assert.equal(deepseek.id, "deepseek");
    const openai = providerManager.getOpenAIProvider();
    assert.ok(openai);
    assert.equal(openai.id, "openai");
    assert.notEqual(deepseek.id, openai.id);
  });

  it("resolves model profiles from configuration, with explicit models winning", () => {
    // An explicit model is always honoured, whatever the environment says.
    assert.equal(resolveModel("general", "custom-model"), "custom-model");
    assert.equal(resolveModel("reasoning", "o3-mini"), "o3-mini");

    const configured = process.env.OPENAI_MODEL?.trim();
    if (configured) {
      // One configured model overrides every profile, which is what the env var means.
      assert.equal(resolveModel("reasoning"), configured);
      assert.equal(resolveModel("fast"), configured);
    } else {
      // With nothing configured, each profile falls back to its own default.
      const reasoning = resolveModel("reasoning");
      const fast = resolveModel("fast");
      assert.ok(reasoning.length > 0);
      assert.ok(fast.length > 0);
      assert.notEqual(reasoning, fast, "profiles must not all collapse to one model");
    }
  });

  it("calculates token cost estimates accurately for OpenAI models", () => {
    // gpt-4o: $2.50 / 1M prompt, $10.00 / 1M completion
    const gpt4oCost = estimateCostUsd("gpt-4o", 1000, 1000);
    // (1000 / 1e6) * 2.50 + (1000 / 1e6) * 10.00 = 0.0025 + 0.010 = 0.0125
    assert.ok(Math.abs(gpt4oCost - 0.0125) < 0.0001);

    // gpt-4o-mini: $0.15 / 1M prompt, $0.60 / 1M completion
    const miniCost = estimateCostUsd("gpt-4o-mini", 1000, 1000);
    // (1000 / 1e6) * 0.15 + (1000 / 1e6) * 0.60 = 0.00015 + 0.00060 = 0.00075
    assert.ok(Math.abs(miniCost - 0.00075) < 0.0001);
  });

  it("reports key configuration honestly during healthCheck", async () => {
    const provider = providerManager.getProvider();
    const health = await provider.healthCheck();
    assert.equal(typeof health.ok, "boolean");

    // The check must agree with the environment: healthy when the selected
    // provider has a key, a clear message naming the missing variable when not.
    const keyName = provider.id === "deepseek" ? "DEEPSEEK_API_KEY" : "OPENAI_API_KEY";
    const keyPresent = Boolean(process.env[keyName]?.trim());
    if (!keyPresent) {
      assert.equal(health.ok, false, `${keyName} is unset, so healthCheck must not claim success`);
      assert.ok(health.message.includes(keyName), `message should name ${keyName}: ${health.message}`);
    } else {
      assert.equal(health.ok, true, `healthCheck failed despite ${keyName} being set: ${health.message}`);
    }
  });
});
