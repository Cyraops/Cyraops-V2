import { AIProvider, AIProviderCapabilities, ChatMessage, ChatOptions, ChatResult, ToolCallPayload } from "../types";
import { estimateCostUsd } from "../models";
import { recordChatUsage } from "../usage";

/**
 * One serializer for both request paths.
 *
 * The streaming path used to send only `{ role, content }`, which silently
 * dropped `tool_call_id`. DeepSeek then rejected the whole request with
 * "missing field tool_call_id" whenever a turn had used a tool and then
 * streamed its answer — which surfaced to the user as "the assistant failed to
 * reply". Exported so a regression test can hold it still.
 */
export function toDeepSeekMessages(messages: ChatMessage[]): any[] {
  return messages.map((m) => {
    const item: any = { role: m.role, content: m.content };
    if (m.name) item.name = m.name;
    if (m.toolCalls && m.toolCalls.length) {
      item.tool_calls = m.toolCalls.map((tc) => ({
        id: tc.id,
        type: "function",
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      }));
    }
    if (m.toolCallId) item.tool_call_id = m.toolCallId;
    return item;
  });
}

export class DeepSeekProvider implements AIProvider {
  id = "deepseek";
  name = "DeepSeek API";

  private apiKey: string;
  private baseUrl: string;

  constructor(apiKey?: string, baseUrl?: string) {
    this.apiKey = apiKey || process.env.DEEPSEEK_API_KEY || "";
    this.baseUrl = (baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com/v1").replace(/\/$/, "");
  }

  getCapabilities(): AIProviderCapabilities {
    return {
      supportsReasoning: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      maxContextTokens: 64000,
    };
  }

  getModels(): string[] {
    return ["deepseek-flash", "deepseek-v4-pro", "deepseek-chat", "deepseek-reasoner"];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    if (!this.apiKey) {
      return { ok: false, message: "DEEPSEEK_API_KEY is not configured in .env" };
    }
    try {
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return { ok: true, message: "DeepSeek API reachable" };
      return { ok: false, message: `DeepSeek API returned HTTP ${res.status}` };
    } catch (e: any) {
      return { ok: false, message: `Connection failed: ${e?.message || e}` };
    }
  }

  /**
   * Resolves which model a request uses.
   *
   * The API currently exposes exactly two models: `deepseek-flash` and
   * `deepseek-v4-pro`. DEEPSEEK_MODEL pins one of them for every caller (for
   * example force flash-only operation); otherwise the reasoning profile picks
   * the pro model and everything else uses flash.
   */
  private resolveModelName(options: ChatOptions): string {
    if (options.model) return options.model;
    const forced = process.env.DEEPSEEK_MODEL?.trim();
    if (forced) return forced;
    return options.profile === "reasoning" ? "deepseek-v4-pro" : "deepseek-flash";
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured. Add it to .env or configure in AI Admin.");
    }

    const startedAt = Date.now();
    const model = this.resolveModelName(options);
    const body: Record<string, any> = {
      model,
      messages: toDeepSeekMessages(messages),
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
    };

    if (options.responseFormat === "json_object" && !model.includes("reasoner")) {
      body.response_format = { type: "json_object" };
    }

    if (options.tools && options.tools.length > 0) {
      if (model.includes("reasoner")) {
        // The reasoner path drops tools. Failing loudly beats the model
        // answering from memory and inventing CRM records.
        console.warn(
          `[DeepSeek] Model "${model}" does not support tool calling; ${options.tools.length} tools omitted. Use a non-reasoner model for agent turns.`
        );
      } else {
        body.tools = options.tools;
      }
    }

    let retries = 2;
    while (retries >= 0) {
      try {
        const res = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(90000),
        });

        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          if (res.status === 429 && retries > 0) {
            retries--;
            await new Promise((r) => setTimeout(r, 2000));
            continue;
          }
          throw new Error(`DeepSeek API error (${res.status}): ${errText}`);
        }

        const data = await res.json();
        const choice = data.choices?.[0];
        const msg = choice?.message;

        const toolCalls: ToolCallPayload[] = [];
        if (msg?.tool_calls) {
          for (const tc of msg.tool_calls) {
            let args: Record<string, any> = {};
            let parseError: string | undefined;
            try {
              args = tc.function.arguments ? JSON.parse(tc.function.arguments) : {};
            } catch {
              // DeepSeek counts reasoning tokens against max_tokens, so a tool
              // call can arrive cut off. Running it with {} silently turns a
              // filtered search into an unfiltered one.
              parseError = "The tool arguments were not valid JSON (the response was probably truncated).";
            }
            toolCalls.push({ id: tc.id, name: tc.function.name, arguments: args, ...(parseError ? { parseError } : {}) });
          }
        }

        const promptTokens = data.usage?.prompt_tokens ?? 0;
        const completionTokens = data.usage?.completion_tokens ?? 0;
        const totalTokens = data.usage?.total_tokens ?? (promptTokens + completionTokens);
        const usage = {
          promptTokens,
          completionTokens,
          totalTokens,
          estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
        };
        recordChatUsage(options, model, usage, Date.now() - startedAt);

        return {
          content: msg?.content || "",
          toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
          usage,
          model,
          finishReason: choice?.finish_reason,
          truncated: choice?.finish_reason === "length",
        };
      } catch (err: any) {
        if (retries <= 0) throw err;
        retries--;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    throw new Error("DeepSeek API request failed after retries.");
  }

  async stream(messages: ChatMessage[], options: ChatOptions = {}, onChunk?: (chunk: string) => void): Promise<ChatResult> {
    if (!this.apiKey) {
      throw new Error("DEEPSEEK_API_KEY is not configured.");
    }

    const startedAt = Date.now();
    const model = this.resolveModelName(options);
    const body: Record<string, any> = {
      model,
      stream: true,
      messages: toDeepSeekMessages(messages),
      temperature: options.temperature ?? 0.3,
      max_tokens: options.maxTokens ?? 4096,
    };

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      // A stalled stream used to hang the spinner forever.
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      throw new Error(`DeepSeek Stream failed (${res.status}): ${err}`);
    }

    let fullContent = "";
    const reader = res.body?.getReader();
    const decoder = new TextDecoder("utf-8");

    let finished = false;
    let streamFinishReason: string | undefined;
    if (reader) {
      let buffer = "";
      while (!finished) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const dataStr = trimmed.replace(/^data:\s*/, "");
          if (dataStr === "[DONE]") {
            finished = true;
            break;
          }
          try {
            const parsed = JSON.parse(dataStr);
            const delta = parsed.choices?.[0]?.delta;
            if (delta?.content) {
              fullContent += delta.content;
              onChunk?.(delta.content);
            }
            const reason = parsed.choices?.[0]?.finish_reason;
            if (reason) streamFinishReason = reason;
          } catch {}
        }
      }
    }

    const promptTokens = Math.ceil(
      messages.reduce((acc, m) => acc + (m.content ?? "").length, 0) / 4
    );
    const completionTokens = Math.ceil(fullContent.length / 4);
    const usage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
    };
    recordChatUsage(options, model, usage, Date.now() - startedAt);

    return {
      content: fullContent,
      usage,
      model,
      finishReason: streamFinishReason,
      // A streamed answer that hit the output limit used to be presented as if
      // it had finished, mid-sentence.
      truncated: streamFinishReason === "length",
    };
  }

  async generateStructuredOutput<T>(messages: ChatMessage[], schemaDescription: string, options: ChatOptions = {}): Promise<T> {
    const systemPrompt: ChatMessage = {
      role: "system",
      content: `You are an expert structured data synthesizer.
CRITICAL INSTRUCTION: You MUST return a strictly valid JSON object matching this schema:
${schemaDescription}
DO NOT wrap your output in markdown backticks. Return raw parseable JSON only.`,
    };

    const result = await this.chat([systemPrompt, ...messages], {
      ...options,
      responseFormat: "json_object",
    });

    const raw = result.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/, "").replace(/```$/, "").trim();

    try {
      return JSON.parse(cleaned) as T;
    } catch (e: any) {
      throw new Error(`Failed to parse structured AI output into JSON: ${e.message}. Content was: ${raw.slice(0, 200)}...`);
    }
  }
}

