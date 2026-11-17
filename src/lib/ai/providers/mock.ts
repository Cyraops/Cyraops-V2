import { AIProvider, AIProviderCapabilities, ChatMessage, ChatOptions, ChatResult } from "../types";

export class MockProvider implements AIProvider {
  id = "mock";
  name = "Deterministic Offline AI Engine";

  getCapabilities(): AIProviderCapabilities {
    return {
      supportsReasoning: true,
      supportsStreaming: true,
      supportsTools: true,
      supportsStructuredOutput: true,
      maxContextTokens: 32000,
    };
  }

  getModels(): string[] {
    return ["mock-reasoner", "mock-fast", "mock-general"];
  }

  async healthCheck(): Promise<{ ok: boolean; message: string }> {
    return { ok: true, message: "Mock offline engine operational" };
  }

  async chat(messages: ChatMessage[], options: ChatOptions = {}): Promise<ChatResult> {
    const lastMsg = messages[messages.length - 1]?.content || "";
    let content = `[Offline Intelligence Response]: Analyzed "${lastMsg.slice(0, 80)}". Operation processed with high confidence.`;

    if (options.responseFormat === "json_object") {
      content = JSON.stringify({
        status: "success",
        plan: [
          { step: 1, action: "Identify target entity and verify permissions", agent: "research" },
          { step: 2, action: "Execute query or record modification", agent: "sales" },
          { step: 3, action: "Consolidate and verify output", agent: "chief_of_staff" },
        ],
        summary: `Plan formulated for: ${lastMsg.slice(0, 100)}`,
      });
    }

    return {
      content,
      usage: {
        promptTokens: 45,
        completionTokens: 85,
        totalTokens: 130,
        estimatedCostUsd: 0.00002,
      },
      model: options.model || "mock-reasoner",
    };
  }

  async stream(messages: ChatMessage[], options: ChatOptions = {}, onChunk?: (chunk: string) => void): Promise<ChatResult> {
    const result = await this.chat(messages, options);
    const chunks = result.content.split(" ");
    for (const chunk of chunks) {
      onChunk?.(chunk + " ");
      await new Promise((r) => setTimeout(r, 20));
    }
    return result;
  }

  async generateStructuredOutput<T>(messages: ChatMessage[], schemaDescription: string, options: ChatOptions = {}): Promise<T> {
    const res = await this.chat(messages, { ...options, responseFormat: "json_object" });
    try {
      return JSON.parse(res.content) as T;
    } catch {
      return { status: "success", parsed: true } as unknown as T;
    }
  }
}

