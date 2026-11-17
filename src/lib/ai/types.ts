export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallPayload {
  /** Set when the provider's arguments were not valid JSON. */
  parseError?: string;
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
  toolCalls?: ToolCallPayload[];
  toolCallId?: string;
}

export interface ChatOptions {
  model?: string;
  profile?: "reasoning" | "fast" | "general" | "long-context";
  temperature?: number;
  maxTokens?: number;
  tools?: any[];
  responseFormat?: "json_object" | "text";
  /** Attribution for per-user AI usage tracking. */
  userId?: string;
  source?: "agent" | "voice" | "email" | "presence" | string;
  agentSlug?: string;
  taskId?: string;
}

export interface ChatResult {
  content: string;
  toolCalls?: ToolCallPayload[];
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedCostUsd: number;
  };
  model: string;
  /** Provider stop reason, e.g. "stop" | "length" | "tool_calls". */
  finishReason?: string;
  /** True when the provider ran out of output budget mid-answer. */
  truncated?: boolean;
}

export interface AIProviderCapabilities {
  supportsReasoning: boolean;
  supportsStreaming: boolean;
  supportsTools: boolean;
  supportsStructuredOutput: boolean;
  maxContextTokens: number;
}

export interface AIProvider {
  id: string;
  name: string;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<ChatResult>;
  stream(messages: ChatMessage[], options?: ChatOptions, onChunk?: (chunk: string) => void): Promise<ChatResult>;
  generateStructuredOutput<T>(messages: ChatMessage[], schemaDescription: string, options?: ChatOptions): Promise<T>;
  getModels(): string[];
  getCapabilities(): AIProviderCapabilities;
  healthCheck(): Promise<{ ok: boolean; message: string }>;
}

