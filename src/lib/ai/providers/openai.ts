import OpenAI from "openai";
import {
  AIProvider,
  AIProviderCapabilities,
  ChatMessage,
  ChatOptions,
  ChatResult,
  ToolCallPayload
} from "../types";
import { estimateCostUsd } from "../models";
import { recordChatUsage } from "../usage";

export class OpenAIUnavailableError extends Error {
  constructor(message: string = "OpenAI API is currently unreachable.") {
    super(message);
    this.name = "OpenAIUnavailableError";
  }
}

export class OpenAIKeyMissingError extends Error {
  constructor(message: string = "OPENAI_API_KEY is not configured in .env. Please configure your key in non-production.") {
    super(message);
    this.name = "OpenAIKeyMissingError";
  }
}

export class OpenAIKeyInvalidError extends Error {
  constructor(message: string = "OpenAI authentication failed: Invalid OPENAI_API_KEY.") {
    super(message);
    this.name = "OpenAIKeyInvalidError";
  }
}

export class OpenAIRateLimitError extends Error {
  constructor(message: string = "OpenAI rate limit exceeded. Please wait and retry.") {
    super(message);
    this.name = "OpenAIRateLimitError";
  }
}

export class OpenAIModelError extends Error {
  constructor(message: string = "OpenAI requested model is not accessible or does not support requested capability.") {
    super(message);
    this.name = "OpenAIModelError";
  }
}

export class OpenAITimeoutError extends Error {
  constructor(message: string = "OpenAI API request timed out.") {
    super(message);
    this.name = "OpenAITimeoutError";
  }
}

export class OpenAIProvider implements AIProvider {
  id = "openai";
  name = "OpenAI Responses API";

  private client: OpenAI | null = null;

  constructor(
    /** Optional per-instance overrides, used by "bring your own key" providers. */
    private readonly overrides?: { apiKey?: string; baseUrl?: string; defaultModel?: string; label?: string }
  ) {
    // Client initialized lazily so missing key at startup doesn't crash app
    if (overrides?.label) {
      this.name = overrides.label;
      this.id = "custom";
    }
  }

  private getClient(): OpenAI {
    const apiKey = this.overrides?.apiKey?.trim() || process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      throw new OpenAIKeyMissingError(
        "OPENAI_API_KEY is not configured. Please add your OpenAI API key to the .env file in locally hosted app dev."
      );
    }
    if (!this.client || this.client.apiKey !== apiKey) {
      this.client = new OpenAI({
        apiKey,
        baseURL: this.overrides?.baseUrl,
        timeout: 60000,
        maxRetries: 2,
      });
    }
    return this.client;
  }

  private getModel(explicitModel?: string): string {
    // "custom:<id>" is a reference to this provider's own config, not a model
    // name: sending it upstream verbatim 400s on every request.
    if (explicitModel && explicitModel.startsWith("custom:")) {
      return this.overrides?.defaultModel || process.env.OPENAI_MODEL?.trim() || "gpt-4o";
    }
    return explicitModel || this.overrides?.defaultModel || process.env.OPENAI_MODEL?.trim() || "gpt-4o";
  }

  getCapabilities(model?: string): AIProviderCapabilities {
    const currentModel = this.getModel(model).toLowerCase();
    const isReasoning = currentModel.startsWith("o1") || currentModel.startsWith("o3");
    return {
      supportsReasoning: isReasoning,
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      maxContextTokens: currentModel.includes("gpt-4o") ? 128000 : 64000,
    };
  }

  getModels(): string[] {
    const configured = process.env.OPENAI_MODEL?.trim();
    const standard = ["gpt-4o", "gpt-4o-mini", "o1", "o3-mini", "gpt-4-turbo"];
    if (configured && !standard.includes(configured)) {
      return [configured, ...standard];
    }
    return standard;
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      return {
        ok: false,
        message: "OPENAI_API_KEY is not configured in .env",
      };
    }

    const model = this.getModel();
    try {
      const client = this.getClient();
      // Test connectivity by querying models endpoint
      const list = await client.models.list();
      const hasModel = list.data.some((m) => m.id === model || m.id.includes(model));
      return {
        ok: true,
        message: `OpenAI API reachable and authenticated (Active model: ${model}${hasModel ? "" : " - verified via API"})`,
      };
    } catch (err: any) {
      if (err?.status === 401) {
        return { ok: false, message: "OpenAI authentication failed: Invalid OPENAI_API_KEY" };
      }
      return { ok: false, message: `OpenAI health check failed: ${err?.message || err}` };
    }
  }

  private formatTools(toolsInput?: any[]): any[] {
    if (!toolsInput || toolsInput.length === 0) return [];
    return toolsInput.map((t) => {
      if (t.type === "function" && t.function) {
        return t;
      }
      return {
        type: "function",
        function: {
          name: t.name || t.id,
          description: t.description || "",
          parameters: t.inputSchema || t.parameters || { type: "object", properties: {} },
        },
      };
    });
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const callStartedAt = Date.now();
    const client = this.getClient();
    const model = this.getModel(options.model);
    const isReasoning = model.startsWith("o1") || model.startsWith("o3");

    // Try Responses API first
    try {
      const inputItems: any[] = [];
      let instructions: string | undefined = undefined;

      for (const m of messages) {
        if (m.role === "system") {
          instructions = instructions ? `${instructions}\n\n${m.content}` : m.content;
        } else if (m.role === "tool" && m.toolCallId) {
          inputItems.push({
            type: "function_call_output",
            call_id: m.toolCallId,
            output: m.content,
          });
        } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          for (const tc of m.toolCalls) {
            inputItems.push({
              type: "function_call",
              call_id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            });
          }
          if (m.content) {
            inputItems.push({
              role: "assistant",
              content: m.content,
            });
          }
        } else {
          inputItems.push({
            role: m.role as "user" | "assistant",
            content: m.content,
          });
        }
      }

      const tools = this.formatTools(options.tools);
      const responsesTools = tools.map((t) => ({
        type: "function" as const,
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));

      const params: any = {
        model,
        input: inputItems,
        instructions: instructions || null,
        max_output_tokens: options.maxTokens ?? 4096,
      };

      if (!isReasoning && options.temperature !== undefined) {
        params.temperature = options.temperature;
      }

      if (responsesTools.length > 0) {
        params.tools = responsesTools;
      }

      if (options.responseFormat === "json_object") {
        params.text = { format: { type: "json_object" } };
      }

      const response = await client.responses.create(params);

      // Extract text content
      const content = response.output_text || "";

      // Extract tool calls
      const toolCalls: ToolCallPayload[] = [];
      if (Array.isArray(response.output)) {
        for (const item of response.output) {
          if (item.type === "function_call") {
            let parsedArgs: any = {};
            try {
              parsedArgs = JSON.parse(item.arguments);
            } catch {
              parsedArgs = { raw: item.arguments };
            }
            toolCalls.push({
              id: item.call_id || item.id || `call-${Date.now()}`,
              name: item.name,
              arguments: parsedArgs,
            });
          }
        }
      }

      const promptTokens = response.usage?.input_tokens || 0;
      const completionTokens = response.usage?.output_tokens || 0;
      const totalTokens = response.usage?.total_tokens || (promptTokens + completionTokens);
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
      };
      recordChatUsage(options, model, usage, Date.now() - callStartedAt);

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model,
        usage,
      };
    } catch (err: any) {
      // Check if fallback to Chat Completions is warranted for models that don't support Responses API yet
      if (err?.status === 400 && err?.message?.includes("responses")) {
        return await this.chatViaCompletions(client, model, messages, options, isReasoning);
      }
      this.handleError(err);
    }
  }

  private async chatViaCompletions(
    client: OpenAI,
    model: string,
    messages: ChatMessage[],
    options: ChatOptions,
    isReasoning: boolean
  ): Promise<ChatResult> {
    const callStartedAt = Date.now();
    try {
      const formattedMessages = messages.map((m) => {
        const item: any = { role: m.role, content: m.content };
        if (m.name) item.name = m.name;
        if (m.toolCalls) {
          item.tool_calls = m.toolCalls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          }));
        }
        if (m.toolCallId) item.tool_call_id = m.toolCallId;
        return item;
      });

      const params: any = {
        model,
        messages: formattedMessages,
      };

      if (!isReasoning) {
        params.temperature = options.temperature ?? 0.3;
        params.max_tokens = options.maxTokens ?? 4096;
      }

      const tools = this.formatTools(options.tools);
      if (tools.length > 0) {
        params.tools = tools;
      }

      if (options.responseFormat === "json_object") {
        params.response_format = { type: "json_object" };
      }

      const completion = await client.chat.completions.create(params);
      const choice = completion.choices[0];
      const content = choice?.message?.content || "";

      const toolCalls: ToolCallPayload[] = [];
      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === "function") {
            let parsedArgs: Record<string, any> = {};
            let parseError: string | undefined;
            try {
              parsedArgs = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              parseError = "The tool arguments were not valid JSON.";
            }
            toolCalls.push({
              id: tc.id,
              name: tc.function.name,
              arguments: parsedArgs,
              ...(parseError ? { parseError } : {}),
            });
          }
        }
      }

      const promptTokens = completion.usage?.prompt_tokens || 0;
      const completionTokens = completion.usage?.completion_tokens || 0;
      const totalTokens = completion.usage?.total_tokens || (promptTokens + completionTokens);
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens,
        estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
      };
      recordChatUsage(options, model, usage, Date.now() - callStartedAt);

      return {
        content,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model,
        usage,
      };
    } catch (err: any) {
      this.handleError(err);
    }
  }

  async stream(
    messages: ChatMessage[],
    options: ChatOptions = {},
    onChunk?: (chunk: string) => void
  ): Promise<ChatResult> {
    const client = this.getClient();
    const model = this.getModel(options.model);
    const isReasoning = model.startsWith("o1") || model.startsWith("o3");

    try {
      const inputItems: any[] = [];
      let instructions: string | undefined = undefined;

      for (const m of messages) {
        if (m.role === "system") {
          instructions = instructions ? `${instructions}\n\n${m.content}` : m.content;
        } else if (m.role === "tool" && m.toolCallId) {
          inputItems.push({
            type: "function_call_output",
            call_id: m.toolCallId,
            output: m.content,
          });
        } else if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
          for (const tc of m.toolCalls) {
            inputItems.push({
              type: "function_call",
              call_id: tc.id,
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            });
          }
          if (m.content) {
            inputItems.push({
              role: "assistant",
              content: m.content,
            });
          }
        } else {
          inputItems.push({
            role: m.role as "user" | "assistant",
            content: m.content,
          });
        }
      }

      const tools = this.formatTools(options.tools);
      const responsesTools = tools.map((t) => ({
        type: "function" as const,
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      }));

      const params: any = {
        model,
        input: inputItems,
        instructions: instructions || null,
        stream: true,
        max_output_tokens: options.maxTokens ?? 4096,
      };

      if (!isReasoning && options.temperature !== undefined) {
        params.temperature = options.temperature;
      }

      if (responsesTools.length > 0) {
        params.tools = responsesTools;
      }

      const streamStartedAt = Date.now();
      const responseStream = await client.responses.create(params);

      let fullContent = "";
      let streamFinishReason: string | undefined;
      const toolCallsMap: Map<string, { id: string; name: string; argumentsStr: string }> = new Map();

      for await (const event of responseStream as any) {
        if (event.type === "response.incomplete" || event.type === "response.completed") {
          const reason = event.response?.incomplete_details?.reason;
          streamFinishReason =
            event.type === "response.incomplete"
              ? reason === "max_output_tokens"
                ? "length"
                : "incomplete"
              : "stop";
        } else if (event.type === "response.output_text.delta" && event.delta) {
          fullContent += event.delta;
          onChunk?.(event.delta);
        } else if (event.type === "response.output_item.added" && event.item?.type === "function_call") {
          const item = event.item;
          // Key by item id, because the delta events reference `item_id`.
          const key = item.id || item.call_id || `call-${Date.now()}-${toolCallsMap.size}`;
          toolCallsMap.set(key, {
            id: item.call_id || item.id || key,
            name: item.name,
            argumentsStr: item.arguments || "",
          });
        } else if (event.type === "response.function_call_arguments.delta" && event.delta) {
          // Appending to "whichever call was added last" silently merged two
          // concurrent tool calls into corrupted JSON.
          const call =
            toolCallsMap.get(event.item_id) ??
            (toolCallsMap.size === 1 ? Array.from(toolCallsMap.values())[0] : undefined);
          if (call) call.argumentsStr += event.delta;
        } else if (event.type === "response.output_item.done" && event.item?.type === "function_call") {
          // `done` carries the authoritative arguments; prefer it when present.
          const key = event.item.id || event.item.call_id;
          const known = key ? toolCallsMap.get(key) : undefined;
          if (known && typeof event.item.arguments === "string") known.argumentsStr = event.item.arguments;
        }
      }

      const toolCalls: ToolCallPayload[] = [];
      for (const call of toolCallsMap.values()) {
        let parsed: Record<string, any> = {};
        let parseError: string | undefined;
        try {
          parsed = call.argumentsStr ? JSON.parse(call.argumentsStr) : {};
        } catch {
          // Never run a tool on empty arguments: a mangled search becomes an
          // unfiltered one, and a mangled write proposes a card with no fields.
          parseError = "The tool arguments were not valid JSON.";
        }
        toolCalls.push({
          id: call.id,
          name: call.name,
          arguments: parsed,
          ...(parseError ? { parseError } : {}),
        });
      }

      // Streamed turns never reported usage, so the assistant — the highest
      // traffic path in the app — was invisible to cost reporting.
      const promptTokens = Math.ceil(
        inputItems.reduce((acc: number, item: any) => acc + String(item?.content ?? "").length, 0) / 4
      );
      const completionTokens = Math.ceil(fullContent.length / 4);
      const usage = {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
      };
      recordChatUsage(options, model, usage, Date.now() - streamStartedAt);

      return {
        content: fullContent,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        model,
        usage,
        finishReason: streamFinishReason,
        truncated: streamFinishReason === "length",
      };
    } catch (err: any) {
      this.handleError(err);
    }
  }

  async generateStructuredOutput<T>(
    messages: ChatMessage[],
    schemaDescription: string,
    options: ChatOptions = {}
  ): Promise<T> {
    const enrichedMessages: ChatMessage[] = [
      ...messages,
      {
        role: "user",
        content: `Respond ONLY with valid JSON conforming to: ${schemaDescription}. No markdown formatting, no backticks, only raw JSON.`,
      },
    ];

    const result = await this.chat(enrichedMessages, {
      ...options,
      responseFormat: "json_object",
    });

    try {
      const cleanJson = result.content.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
      return JSON.parse(cleanJson) as T;
    } catch {
      throw new Error(`Failed to parse structured JSON output from OpenAI: ${result.content}`);
    }
  }

  private handleError(err: any): never {
    console.error("[OpenAIProvider] API Error:", err?.message || err);
    if (err instanceof OpenAIKeyMissingError) {
      throw err;
    }
    if (err?.status === 401 || err?.message?.includes("API key")) {
      throw new OpenAIKeyInvalidError(
        "OpenAI authentication failed: Invalid OPENAI_API_KEY. Please verify your API key in .env."
      );
    }
    if (err?.status === 429 || err?.message?.includes("rate limit")) {
      throw new OpenAIRateLimitError(
        "OpenAI API rate limit exceeded. Please wait a moment and retry."
      );
    }
    if (err?.status === 404 || err?.message?.includes("model")) {
      throw new OpenAIModelError(`OpenAI model error: ${err.message}`);
    }
    if (err?.code === "ETIMEDOUT" || err?.name === "TimeoutError") {
      throw new OpenAITimeoutError("OpenAI API request timed out. Please retry.");
    }
    throw new OpenAIUnavailableError(`OpenAI API error (${err?.status || "network"}): ${err?.message || err}`);
  }
}

