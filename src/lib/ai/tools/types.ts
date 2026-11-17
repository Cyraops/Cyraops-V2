import { RiskClass } from "@prisma/client";

export interface ToolExecutionContext {
  taskId?: string;
  stepId?: string;
  /** Personal-assistant calls belong to a conversation rather than a task. */
  conversationId?: string;
  /** Set when the task belongs to an AI-team goal, for inter-agent messaging. */
  goalId?: string;
  userId: string;
  userRole?: string;
  agentSlug?: string;
  idempotencyKey?: string;
}

export interface ToolExecutionResult<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  requiresApproval?: boolean;
  approvalPayload?: any;
}

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: "contacts" | "companies" | "leads" | "deals" | "tasks" | "reports" | "documents" | "communication" | "system";
  riskClass: RiskClass;
  requiresApproval: boolean;
  /** Reads only; changes nothing. */
  readOnly?: boolean;
  /** Result may contain text an outsider wrote, so it taints the run. */
  taintsRun?: boolean;
  /** Reaches outside the CRM; only these reads are interrupted under taint. */
  externalRead?: boolean;
  /** Saves content that outlives the turn (a memory, a page). */
  persistsContent?: boolean;
  /** Security boundary: can never be permanently allowed or auto-approved. */
  explicitApproval?: boolean;
  inputSchema: Record<string, any>;
  execute(input: any, context: ToolExecutionContext): Promise<ToolExecutionResult>;
}

