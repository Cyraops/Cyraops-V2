import { ToolDefinition, ToolExecutionContext, ToolExecutionResult } from "./types";
import { db } from "@/lib/db";

const SENSITIVE_KEY =
  /(^|[^a-z])(password|passwd|secret|token|api[-_]?key|credential|authorization|cookie|session)([^a-z]|$)/;

function maskSensitiveData(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(maskSensitiveData);

  const sanitized: Record<string, any> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    // Whole-word matching: substring tests masked `author`, `authorId` and
    // `authors` because they contain "auth", so cached replays showed
    // "***MASKED***" instead of a name.
    if (SENSITIVE_KEY.test(lowerKey)) {
      sanitized[key] = "***MASKED***";
    } else if (typeof val === "object" && val !== null) {
      sanitized[key] = maskSensitiveData(val);
    } else {
      sanitized[key] = val;
    }
  }
  return sanitized;
}

export class ToolRegistry {
  private tools: Map<string, ToolDefinition> = new Map();

  public registerTool(tool: ToolDefinition): void {
    this.tools.set(tool.id, tool);
  }

  public getTool(id: string): ToolDefinition | undefined {
    return this.tools.get(id);
  }

  public listTools(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  public listToolsForAgent(toolIds: string[]): ToolDefinition[] {
    return toolIds.map((id) => this.tools.get(id)).filter(Boolean) as ToolDefinition[];
  }

  public async executeTool(
    toolId: string,
    input: any,
    context: ToolExecutionContext
  ): Promise<ToolExecutionResult> {
    const tool = this.tools.get(toolId);
    if (!tool) {
      return { success: false, error: `Tool "${toolId}" not found in registry.` };
    }

    // Idempotency check: prevent duplicate execution of operations during recovery
    if ((context.taskId || context.conversationId) && context.idempotencyKey) {
      try {
        const cached = await db.aiToolCall.findFirst({
          where: {
            idempotencyKey: context.idempotencyKey,
            ...(context.taskId ? { taskId: context.taskId } : { conversationId: context.conversationId }),
          },
        });
        if (cached) {
          if (cached.status === "SUCCESS") {
            let cachedData = null;
            try {
              cachedData = cached.output ? JSON.parse(cached.output) : null;
            } catch {
              cachedData = cached.output;
            }
            return {
              success: true,
              data: cachedData,
            };
          }
          // If a previous execution was interrupted in RUNNING state for a mutating operation
          if (cached.status === "RUNNING" && tool.riskClass !== "CLASS_A") {
            console.warn(
              `[ToolRegistry] Ambiguous in-flight mutation detected for tool "${toolId}" (key: ${context.idempotencyKey}). Halting for verification.`
            );
            return {
              success: false,
              requiresApproval: true,
              error: `Ambiguous in-flight mutation detected for tool "${toolId}" during recovery. Paused to prevent duplicate operations.`,
            };
          }
        }
      } catch (cacheErr) {
        console.warn("[ToolRegistry] Idempotency check error:", cacheErr);
      }
    }

    const startTime = Date.now();
    let toolCallRecord: any = null;

    // Pre-record in-flight tool call intent in database before execution.
    // Assistant calls were never recorded at all, so there was no history of
    // what the bot actually did.
    if (context.taskId || context.conversationId) {
      try {
        const safeInput = JSON.stringify(maskSensitiveData(input) || {});
        toolCallRecord = await db.aiToolCall.create({
          data: {
            taskId: context.taskId ?? null,
            conversationId: context.conversationId ?? null,
            stepId: context.stepId,
            toolId: tool.id,
            toolName: tool.name,
            idempotencyKey: context.idempotencyKey || null,
            input: safeInput,
            status: "RUNNING",
            riskClass: tool.riskClass,
            requiresApproval: tool.requiresApproval,
          },
        });
      } catch (preLogErr) {
        console.warn("[ToolRegistry] Failed to pre-log tool intent:", preLogErr);
      }
    }

    let result: ToolExecutionResult;

    try {
      result = await tool.execute(input, context);
    } catch (err: any) {
      result = {
        success: false,
        error: err?.message || `Execution failed for tool ${toolId}`,
      };
    }

    const durationMs = Date.now() - startTime;

    // Update AiToolCall record with final execution status and output
    if (toolCallRecord) {
      try {
        const safeOutput = result.data ? JSON.stringify(maskSensitiveData(result.data)) : null;

        await db.aiToolCall.update({
          where: { id: toolCallRecord.id },
          data: {
            output: safeOutput,
            status: result.success ? "SUCCESS" : "ERROR",
            error: result.error || null,
            executionTimeMs: durationMs,
          },
        });
      } catch (logErr) {
        console.error("[ToolRegistry] Failed to update tool call:", logErr);
      }
    } else if (context.taskId || context.conversationId) {
      try {
        const safeInput = JSON.stringify(maskSensitiveData(input) || {});
        const safeOutput = result.data ? JSON.stringify(maskSensitiveData(result.data)) : null;

        await db.aiToolCall.create({
          data: {
            taskId: context.taskId ?? null,
            conversationId: context.conversationId ?? null,
            stepId: context.stepId,
            toolId: tool.id,
            toolName: tool.name,
            idempotencyKey: context.idempotencyKey || null,
            input: safeInput,
            output: safeOutput,
            status: result.success ? "SUCCESS" : "ERROR",
            error: result.error || null,
            riskClass: tool.riskClass,
            requiresApproval: tool.requiresApproval,
            executionTimeMs: durationMs,
          },
        });
      } catch (logErr) {
        console.error("[ToolRegistry] Failed to log tool call:", logErr);
      }
    }

    // Audit logging for anything that mutates. CLASS_A used to be skipped
    // entirely, which meant memory and page writes — the two tools an
    // injection most wants — left no trace.
    const mutating = tool.riskClass !== "CLASS_A" || tool.persistsContent || !tool.readOnly;
    if (mutating) {
      try {
        await db.aiAuditLog.create({
          data: {
            eventType: "TOOL_EXECUTION",
            entity: tool.category,
            entityId: context.taskId,
            actorId: context.userId,
            actorType: context.agentSlug ? "AGENT" : "USER",
            // `action` is not a column on AiAuditLog: passing it here made every
            // mutating tool throw on its audit write, so the trail was empty for
            // exactly the calls worth auditing.
            details: JSON.stringify({
              action: tool.id,
              input: maskSensitiveData(input),
              success: result.success,
              error: result.error,
            }),
          },
        });
      } catch (auditErr) {
        console.error("[ToolRegistry] Failed to log audit event:", auditErr);
      }
    }

    return result;
  }
}

export const toolRegistry = new ToolRegistry();

