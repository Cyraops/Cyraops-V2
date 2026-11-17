export type ModelProfileType = "reasoning" | "fast" | "general" | "long-context";

export interface ModelProfile {
  name: string;
  defaultModel: string;
  temperature: number;
  maxTokens: number;
  description: string;
}

const activeOpenAIModel = process.env.OPENAI_MODEL?.trim() || "gpt-4o";

export const MODEL_PROFILES: Record<ModelProfileType, ModelProfile> = {
  reasoning: {
    name: "Deep Reasoning",
    defaultModel: process.env.OPENAI_REASONING_MODEL || activeOpenAIModel,
    temperature: 0.2,
    maxTokens: 4096,
    description: "Deep multi-step reasoning, execution planning, root-cause analysis, and complex synthesis.",
  },
  fast: {
    name: "Fast Analytical",
    defaultModel: process.env.OPENAI_FAST_MODEL || "gpt-4o-mini",
    temperature: 0.2,
    maxTokens: 2048,
    description: "Low-latency classification, extraction, scoring, and quick data transformations.",
  },
  general: {
    name: "General Business",
    defaultModel: process.env.OPENAI_GENERAL_MODEL || activeOpenAIModel,
    temperature: 0.5,
    maxTokens: 4096,
    description: "Email drafting, summaries, meeting minutes, and communicative operations.",
  },
  "long-context": {
    name: "Long Context Analysis",
    defaultModel: process.env.OPENAI_LONG_CONTEXT_MODEL || activeOpenAIModel,
    temperature: 0.3,
    maxTokens: 8192,
    description: "Full document parsing, multi-contact discovery, and comprehensive history review.",
  },
};

export function resolveModel(profile: ModelProfileType = "reasoning", explicitModel?: string): string {
  if (explicitModel) return explicitModel;
  const currentEnvModel = process.env.OPENAI_MODEL?.trim();
  if (currentEnvModel) return currentEnvModel;
  return MODEL_PROFILES[profile]?.defaultModel || "gpt-4o";
}

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const m = model.toLowerCase();
  if (m.startsWith("o1")) {
    // OpenAI o1: $15.00 / 1M prompt, $60.00 / 1M completion
    return (promptTokens / 1_000_000) * 15.0 + (completionTokens / 1_000_000) * 60.0;
  }
  if (m.startsWith("o3")) {
    // OpenAI o3-mini: $1.10 / 1M prompt, $4.40 / 1M completion
    return (promptTokens / 1_000_000) * 1.10 + (completionTokens / 1_000_000) * 4.40;
  }
  if (m.includes("gpt-4o-mini")) {
    // OpenAI gpt-4o-mini: $0.15 / 1M prompt, $0.60 / 1M completion
    return (promptTokens / 1_000_000) * 0.15 + (completionTokens / 1_000_000) * 0.60;
  }
  if (m.includes("gpt-4o")) {
    // OpenAI gpt-4o: $2.50 / 1M prompt, $10.00 / 1M completion
    return (promptTokens / 1_000_000) * 2.50 + (completionTokens / 1_000_000) * 10.00;
  }
  if (m.includes("reasoner")) {
    // DeepSeek R1 fallback
    return (promptTokens / 1_000_000) * 0.55 + (completionTokens / 1_000_000) * 2.19;
  }
  if (m.includes("deepseek")) {
    // DeepSeek Chat fallback
    return (promptTokens / 1_000_000) * 0.14 + (completionTokens / 1_000_000) * 0.28;
  }
  // Generic fallback: $2.50 / $10.00 per 1M
  return (promptTokens / 1_000_000) * 2.50 + (completionTokens / 1_000_000) * 10.00;
}
