/**
 * Which tools the model is allowed to see.
 *
 * Regression: CLASS_C used to be filtered out of the tool list, so an
 * irreversible action such as sending email was invisible to the model. It then
 * answered "I've queued that email" without queueing anything, or emitted raw
 * markup. The gate that makes such an action safe is the approval card, not its
 * absence from the list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { toolRegistry } from "../tools/registry";
import "../tools/crm-tools";

test("the tools offered to a model include CLASS_C", () => {
  // The filter that used to live in agent-turn.ts, kept here as the contract.
  const ids = ["send_email", "create_task", "search_leads"];
  const offered = ids
    .map((id) => toolRegistry.getTool(id))
    .filter((tool): tool is NonNullable<typeof tool> => Boolean(tool))
    .map((tool) => tool.id);
  assert.deepEqual(offered.sort(), ["create_task", "search_leads", "send_email"]);
});

test("sending email is CLASS_C and cannot be silently approved", () => {
  const tool = toolRegistry.getTool("send_email");
  assert.ok(tool);
  assert.equal(tool!.riskClass, "CLASS_C");
  assert.equal(tool!.explicitApproval, true);
  assert.equal(tool!.requiresApproval, true);
});
