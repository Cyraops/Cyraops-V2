import { AIProvider } from "./types";
import {
  OpenAIProvider,
  OpenAIUnavailableError,
  OpenAIKeyMissingError,
  OpenAIKeyInvalidError,
  OpenAIRateLimitError
} from "./providers/openai";
import { DeepSeekProvider } from "./providers/deepseek";
import { db } from "@/lib/db";
import { decryptSecret } from "./crypto";

export class DeepSeekUnavailableError extends Error {
  constructor(message: string = "DeepSeek API is currently unreachable. Task state preserved.") {
    super(message);
    this.name = "DeepSeekUnavailableError";
  }
}

export {
  OpenAIUnavailableError,
  OpenAIKeyMissingError,
  OpenAIKeyInvalidError,
  OpenAIRateLimitError
};

class ProviderManager {
  private readonly openAIProvider: AIProvider;
  private readonly deepseekProvider: AIProvider;

  constructor() {
    this.openAIProvider = new OpenAIProvider();
    this.deepseekProvider = new DeepSeekProvider();
  }

  private getSelectedProviderId(): "openai" | "deepseek" {
    const preferred = process.env.AI_PROVIDER?.trim().toLowerCase();
    if (preferred === "deepseek") return "deepseek";
    if (preferred === "openai") return "openai";

    // If no preference is set, use whichever supported key is configured.
    // This keeps a DeepSeek-only setup usable while preserving OpenAI as the
    // default when both keys are present.
    if (process.env.OPENAI_API_KEY?.trim()) return "openai";
    if (process.env.DEEPSEEK_API_KEY?.trim()) return "deepseek";
    return "openai";
  }

  public getProvider(): AIProvider {
    return this.getSelectedProviderId() === "deepseek" ? this.deepseekProvider : this.openAIProvider;
  }

  /**
   * Resolves the provider for a model reference. `custom:<configId>` points at a
   * user-supplied OpenAI-compatible provider (bring your own key).
   */
  public async getProviderForModel(model?: string): Promise<AIProvider> {
    if (model && model.startsWith("custom:")) {
      const configId = model.slice("custom:".length);
      try {
        const config = await db.aiProviderConfig.findFirst({ where: { id: configId, isActive: true } });
        if (config) {
          return new OpenAIProvider({
            apiKey: decryptSecret(config.apiKeyEncrypted),
            baseUrl: config.baseUrl,
            defaultModel: config.defaultModel,
            label: config.label,
          });
        }
      } catch (err) {
        console.error("[ProviderManager] Custom provider unavailable, falling back to default:", err);
      }
    }
    return this.getProvider();
  }

  public getDeepSeekProvider(): AIProvider {
    return this.deepseekProvider;
  }

  /** Exposed like the DeepSeek accessor so both providers stay reachable. */
  public getOpenAIProvider(): AIProvider {
    return this.openAIProvider;
  }

  public listProviders(): { id: string; name: string; available: boolean; active: boolean; capabilities: any }[] {
    const isOpenAIConfigured = Boolean(process.env.OPENAI_API_KEY?.trim());
    const isDeepSeekConfigured = Boolean(process.env.DEEPSEEK_API_KEY?.trim());
    const selectedProviderId = this.getSelectedProviderId();

    return [
      {
        id: this.openAIProvider.id,
        name: this.openAIProvider.name,
        available: isOpenAIConfigured,
        active: selectedProviderId === this.openAIProvider.id,
        capabilities: this.openAIProvider.getCapabilities(),
      },
      {
        id: this.deepseekProvider.id,
        name: this.deepseekProvider.name,
        available: isDeepSeekConfigured,
        active: selectedProviderId === this.deepseekProvider.id,
        capabilities: this.deepseekProvider.getCapabilities(),
      },
    ];
  }
}

export const providerManager = new ProviderManager();
export const getDefaultProvider = () => providerManager.getProvider();
export const getProvider = () => providerManager.getProvider();
