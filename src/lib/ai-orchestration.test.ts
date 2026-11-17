import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { agentRegistry } from "./ai/agents/agent-registry";
import { toolRegistry } from "./ai/tools/registry";
import { CORE_AGENTS } from "./ai/agents/definitions";
import "./ai/tools/crm-tools";
import { generateExecutionPlan } from "./ai/orchestrator/planner";
import { canTransition } from "./ai/agents/lifecycle";
import { providerManager } from "./ai/provider-manager";

describe("Agent Framework & Lifecycle", () => {
  it("enforces legal task status state machine transitions", () => {
    assert.equal(canTransition("CREATED", "PLANNING"), true);
    assert.equal(canTransition("PLANNING", "RUNNING"), true);
    assert.equal(canTransition("RUNNING", "COMPLETED"), true);
    assert.equal(canTransition("COMPLETED", "RUNNING"), false); // Terminal state
    assert.equal(canTransition("CANCELLED", "RUNNING"), false); // Terminal state
  });

  it("registers and retrieves default core agent definitions", async () => {
    await agentRegistry.ensureDefaultAgents();
    const cos = await agentRegistry.getAgentBySlug("chief_of_staff");
    assert.ok(cos);
    assert.equal(cos?.isMaster, true);

    const sales = await agentRegistry.getAgentBySlug("sales");
    assert.ok(sales);
    assert.equal(sales?.role, "Pipeline & Revenue Specialist");
  });
});

describe("Native Tool Execution", () => {
  it("lists registered CRM tools", () => {
    const tools = toolRegistry.listTools();
    assert.ok(tools.length >= 10);
    const hasSalesReport = tools.some((t) => t.id === "get_sales_report");
    assert.equal(hasSalesReport, true);
  });

  it("has registered tools for every agent capability", () => {
    for (const agent of CORE_AGENTS) {
      const missingTools = agent.tools.filter((toolId) => !toolRegistry.getTool(toolId));
      assert.deepEqual(missingTools, [], `${agent.name} references unregistered tools`);
    }
  });

  it("refuses revenue reports to a caller who is not an owner or admin", async () => {
    // Revenue is owner/admin data. The previous version of this test asserted
    // success for an arbitrary user id, which encoded the opposite policy.
    const res = await toolRegistry.executeTool("get_sales_report", {}, {
      userId: "test-user-id",
    });
    assert.equal(res.success, false);
    assert.match(String(res.error), /Owners and Admins only/);
  });
});

describe("Planning & Orchestration", () => {
  it("formulates structured execution plans with agent assignments", async () => {
    const provider = providerManager.getProvider();
    const originalGenerate = provider.generateStructuredOutput;
    provider.generateStructuredOutput = async <T>() => ({
      summary: "Review existing lead and deal records.",
      steps: [{
        stepIndex: 1,
        title: "Review leads",
        description: "Search current leads.",
        assignedAgentSlug: "sales",
        toolId: "search_leads",
        riskClass: "CLASS_A",
        requiresApproval: false,
        input: { query: "stale" },
      }],
    } as T);

    try {
      const plan = await generateExecutionPlan("Audit stale deals and qualify new leads", {
        role: "OWNER",
        userId: "unit-test-user",
        selectedAgentSlug: "sales",
      });
      assert.ok(plan);
      assert.ok(plan.steps.length > 0);
      for (const step of plan.steps) {
        assert.ok(step.assignedAgentSlug);
        assert.ok(step.riskClass);
        assert.equal(step.toolId, "search_leads");
        assert.equal(step.assignedAgentSlug, "sales");
      }
    } finally {
      provider.generateStructuredOutput = originalGenerate;
    }
  });

  it("rejects plans that select a tool outside the selected agent's registry", async () => {
    const provider = providerManager.getProvider();
    const originalGenerate = provider.generateStructuredOutput;
    provider.generateStructuredOutput = async <T>() => ({
      summary: "Try to use a task tool from sales.",
      steps: [{
        title: "Search tasks",
        assignedAgentSlug: "sales",
        toolId: "search_tasks",
        riskClass: "CLASS_A",
        requiresApproval: false,
        input: {},
      }],
    } as T);

    try {
      await assert.rejects(
        generateExecutionPlan("Search tasks", {
          role: "OWNER",
          userId: "unit-test-user",
          selectedAgentSlug: "sales",
        }),
        /unavailable tool for Sales Agent/
      );
    } finally {
      provider.generateStructuredOutput = originalGenerate;
    }
  });

  it("does not invent a fallback plan when the AI provider fails", async () => {
    const provider = providerManager.getProvider();
    const originalGenerate = provider.generateStructuredOutput;
    provider.generateStructuredOutput = async () => {
      throw new Error("provider unavailable");
    };

    try {
      await assert.rejects(
        generateExecutionPlan("Review current pipeline"),
        /provider unavailable/
      );
    } finally {
      provider.generateStructuredOutput = originalGenerate;
    }
  });

  it("registers browser automation tools in registry", () => {
    const navTool = toolRegistry.getTool("browser_navigate");
    assert.ok(navTool);
    assert.equal(navTool?.category, "system");

    const extractTool = toolRegistry.getTool("browser_extract");
    assert.ok(extractTool);
    assert.ok(toolRegistry.getTool("execute_routine"));
  });
});

