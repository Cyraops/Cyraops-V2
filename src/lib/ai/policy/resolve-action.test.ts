import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeApprovalMode,
  resolveToolPolicy,
  type PolicyInput,
  type PolicyTool,
} from "./resolve-action";

const readTool: PolicyTool = { id: "search_leads", riskClass: "CLASS_A", requiresApproval: false, readOnly: true };
const externalReadTool: PolicyTool = {
  id: "browser_extract",
  riskClass: "CLASS_A",
  requiresApproval: false,
  readOnly: true,
  externalRead: true,
};
const writeTool: PolicyTool = { id: "create_task", riskClass: "CLASS_B", requiresApproval: true };
const browserTool: PolicyTool = {
  id: "browser_click",
  riskClass: "CLASS_B",
  requiresApproval: true,
  taintsRun: true,
};
const secretTool: PolicyTool = {
  id: "claim_email_address",
  riskClass: "CLASS_B",
  requiresApproval: true,
  explicitApproval: true,
};

function decide(overrides: Partial<PolicyInput> & { tool: PolicyTool }) {
  return resolveToolPolicy({ rules: [], mode: "ASK", runTainted: false, ...overrides });
}

describe("tool policy", () => {
  it("lets reads through without asking", () => {
    assert.equal(decide({ tool: readTool }).decision, "allow");
  });

  it("asks before a write in Ask mode", () => {
    const decision = decide({ tool: writeTool });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.canAlwaysAllow, true);
  });

  it("a DENY rule beats an ALLOW rule and every mode", () => {
    for (const mode of ["ASK", "AUTO", "NEVER"] as const) {
      const decision = decide({
        tool: writeTool,
        mode,
        rules: [
          { toolName: "create_task", effect: "ALLOW" },
          { toolName: "create_task", effect: "DENY" },
        ],
      });
      assert.equal(decision.decision, "deny");
      assert.equal(decision.canAlwaysAllow, false);
    }
  });

  it("a standing allow skips the card in Ask mode", () => {
    const decision = decide({ tool: writeTool, rules: [{ toolName: "create_task", effect: "ALLOW" }] });
    assert.equal(decision.decision, "allow");
  });

  it("an explicit ask rule keeps asking even when Never-ask", () => {
    const decision = decide({
      tool: writeTool,
      mode: "NEVER",
      rules: [{ toolName: "create_task", effect: "ASK" }],
    });
    assert.equal(decision.decision, "ask");
  });

  it("Never-ask runs a write when nothing steered the run", () => {
    assert.equal(decide({ tool: writeTool, mode: "NEVER" }).decision, "allow");
  });

  it("Never-ask refuses a write when outside content entered the run", () => {
    const decision = decide({ tool: writeTool, mode: "NEVER", runTainted: true });
    assert.equal(decision.decision, "deny");
    assert.equal(decision.source, "taint");
  });

  it("an allow rule cannot defeat taint under Never-ask", () => {
    const decision = decide({
      tool: writeTool,
      mode: "NEVER",
      runTainted: true,
      rules: [{ toolName: "create_task", effect: "ALLOW" }],
    });
    assert.equal(decision.decision, "deny");
  });

  it("browser clicks ask, and taint still permits them with a card", () => {
    assert.equal(decide({ tool: browserTool }).decision, "ask");
    assert.equal(decide({ tool: browserTool, runTainted: true }).decision, "ask");
  });

  it("taint beats a standing allow in Ask and Auto modes", () => {
    for (const mode of ["ASK", "AUTO"] as const) {
      const decision = decide({
        tool: writeTool,
        mode,
        runTainted: true,
        rules: [{ toolName: "create_task", effect: "ALLOW" }],
      });
      assert.notEqual(decision.decision, "allow", `ALLOW rule defeated taint in ${mode}`);
    }
  });

  it("gates content writes once outsider text entered the run", () => {
    const pageTool: PolicyTool = {
      id: "create_page",
      riskClass: "CLASS_A",
      requiresApproval: false,
      persistsContent: true,
    };
    assert.equal(decide({ tool: pageTool }).decision, "allow");
    assert.equal(decide({ tool: pageTool, runTainted: true }).decision, "ask");
  });

  it("security-boundary tools can never be permanently allowed", () => {
    const decision = decide({ tool: secretTool });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.canAlwaysAllow, false);
    assert.equal(decide({ tool: secretTool, mode: "AUTO" }).decision, "ask");
  });

  it("a tainted run blocks a security-boundary tool under Never-ask", () => {
    assert.equal(decide({ tool: secretTool, mode: "NEVER", runTainted: true }).decision, "deny");
  });

  it("Auto mode passes unsteered reads but still asks for writes", () => {
    assert.equal(decide({ tool: readTool, mode: "AUTO" }).decision, "allow");
    assert.equal(decide({ tool: writeTool, mode: "AUTO" }).decision, "ask");
  });

  it("never interrupts a tainted run just to read our own data", () => {
    // Searching leads or chat history after a web fetch is normal work.
    assert.equal(decide({ tool: readTool, runTainted: true }).decision, "allow");
    assert.equal(decide({ tool: readTool, runTainted: true, mode: "AUTO" }).decision, "allow");
  });

  it("still asks before fetching outside the CRM once tainted", () => {
    assert.equal(decide({ tool: externalReadTool, runTainted: true }).decision, "ask");
    assert.equal(decide({ tool: externalReadTool, runTainted: false }).decision, "allow");
  });

  it("an unattended run never offers a permanent allow", () => {
    const decision = decide({ tool: writeTool, unattended: true });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.canAlwaysAllow, false);
  });

  it("normalizes stored modes", () => {
    assert.equal(normalizeApprovalMode("AUTO"), "AUTO");
    assert.equal(normalizeApprovalMode("nonsense"), "ASK");
    assert.equal(normalizeApprovalMode(undefined), "ASK");
  });
});

describe("permission-mode matrix (unified Permission Manager)", () => {
  const pageTool: PolicyTool = {
    id: "create_page",
    riskClass: "CLASS_A",
    requiresApproval: false,
    persistsContent: true,
  };

  it("READ_ONLY denies every mutating action with a clear reason, whatever the standing rules", () => {
    for (const tool of [writeTool, browserTool, secretTool, pageTool]) {
      const decision = decide({
        tool,
        permissionMode: "READ_ONLY",
        rules: [{ toolName: tool.id, effect: "ALLOW" }],
      });
      assert.equal(decision.decision, "deny", `${tool.id} must be denied`);
      assert.equal(decision.source, "mode");
      assert.match(decision.reason, /READ_ONLY permission mode/);
      assert.equal(decision.canAlwaysAllow, false);
    }
  });

  it("READ_ONLY still lets pure reads through", () => {
    const decision = decide({ tool: readTool, permissionMode: "READ_ONLY" });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.source, "read");
  });

  it("CONTROLLED keeps the historical behaviour", () => {
    assert.equal(decide({ tool: writeTool, permissionMode: "CONTROLLED" }).decision, "ask");
    assert.equal(decide({ tool: readTool, permissionMode: "CONTROLLED" }).decision, "allow");
    assert.equal(
      decide({ tool: writeTool, permissionMode: "CONTROLLED", requesterRole: "OWNER" }).decision,
      "ask"
    );
  });

  it("FULL_CONTROL auto-approves the OWNER's writes, flagged for the APPROVED audit row", () => {
    const decision = decide({ tool: writeTool, permissionMode: "FULL_CONTROL", requesterRole: "OWNER" });
    assert.equal(decision.decision, "allow");
    assert.equal(decision.source, "mode");
    assert.equal(decision.autoApproved, true);
  });

  it("FULL_CONTROL falls back to CONTROLLED for non-owners", () => {
    for (const role of ["ADMIN", "MEMBER", null]) {
      const decision = decide({ tool: writeTool, permissionMode: "FULL_CONTROL", requesterRole: role });
      assert.equal(decision.decision, "ask", `role ${role}`);
    }
  });

  it("SYSTEM behaves exactly like FULL_CONTROL for the owner", () => {
    const owner = decide({ tool: writeTool, permissionMode: "SYSTEM", requesterRole: "OWNER" });
    assert.equal(owner.decision, "allow");
    assert.equal(owner.autoApproved, true);
    assert.equal(decide({ tool: writeTool, permissionMode: "SYSTEM", requesterRole: "MEMBER" }).decision, "ask");
  });

  it("a tainted run still needs a person even for the OWNER under FULL_CONTROL", () => {
    const decision = decide({
      tool: writeTool,
      permissionMode: "FULL_CONTROL",
      requesterRole: "OWNER",
      runTainted: true,
    });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.autoApproved, undefined);
  });

  it("security-boundary tools always ask, even for the OWNER under FULL_CONTROL", () => {
    const decision = decide({
      tool: secretTool,
      permissionMode: "FULL_CONTROL",
      requesterRole: "OWNER",
    });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.source, "explicit");
  });

  it("a stored ask rule keeps asking under FULL_CONTROL for the owner", () => {
    const decision = decide({
      tool: writeTool,
      permissionMode: "FULL_CONTROL",
      requesterRole: "OWNER",
      rules: [{ toolName: "create_task", effect: "ASK" }],
    });
    assert.equal(decision.decision, "ask");
    assert.equal(decision.source, "rule");
  });

  it("no permission mode passed preserves every existing decision", () => {
    assert.equal(decide({ tool: writeTool }).decision, "ask");
    assert.equal(decide({ tool: writeTool, mode: "NEVER" }).decision, "allow");
    assert.equal(decide({ tool: readTool }).decision, "allow");
  });
});
