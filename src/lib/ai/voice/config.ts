/**
 * Cyraops AI Voice Assistant Central Configuration Layer
 *
 * Requirements:
 * - AI reasoning provider: DeepSeek ONLY.
 * - Active model: DeepSeek V4 Flash (`deepseek-chat`).
 * - Configurable model-switching architecture supporting future DeepSeek models (e.g. V4 Pro / `deepseek-reasoner`).
 * - Central server-side configuration, no scattered hardcoding.
 * - Independent STT and TTS configuration.
 * - No silent fallback to OpenAI or Gemini.
 */

export interface VoiceModelOption {
  id: string;
  name: string;
  description: string;
  recommended: boolean;
  active: boolean;
  maxTokens: number;
  temperature: number;
}

export interface VoiceAssistantConfig {
  aiProvider: "deepseek";
  activeModel: string;
  supportedModels: VoiceModelOption[];
  speech: {
    // Speech runs entirely in the browser via the Web Speech API. Server-side
    // STT/TTS is not implemented, so no other value is accepted here.
    sttProvider: "browser-web-speech";
    ttsProvider: "browser-speech-synthesis";
    supportedLanguages: Array<{ code: string; label: string }>;
    defaultLanguage: string;
    vadSilenceThresholdMs: number;
    vadMinSpeechDurationMs: number;
    vadEnergyThreshold: number;
    bargeInEnabled: boolean;
  };
  audioAnalysis: {
    fftSize: number;
    smoothingTimeConstant: number;
    minDecibels: number;
    maxDecibels: number;
  };
}

// Officially supported DeepSeek models for Cyraops CRM Voice.
// The legacy `deepseek-chat` / `deepseek-reasoner` aliases were retired by
// DeepSeek on 2026-07-24, so they must not be offered as selectable models.
export const DEEPSEEK_VOICE_MODELS: VoiceModelOption[] = [
  {
    id: "deepseek-flash",
    name: "DeepSeek V4 Flash",
    description: "Official DeepSeek V4 Flash model for fast, low-latency conversational reasoning and full CRM tool execution. Active default.",
    recommended: true,
    active: true,
    maxTokens: 4096,
    temperature: 0.3,
  },
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    description: "Official DeepSeek V4 Pro reasoning model for complex enterprise analysis. Configurable option.",
    recommended: false,
    active: false,
    maxTokens: 8192,
    temperature: 0.1,
  },
];

// Active model state (server-side in-memory with env override, defaulting to deepseek-flash)
let currentActiveModel = process.env.DEEPSEEK_VOICE_MODEL?.trim() || "deepseek-flash";

// Validate that active model is a supported DeepSeek model
if (!DEEPSEEK_VOICE_MODELS.some((m) => m.id === currentActiveModel)) {
  currentActiveModel = "deepseek-flash";
}

export function getVoiceConfig(): VoiceAssistantConfig {
  const models = DEEPSEEK_VOICE_MODELS.map((m) => ({
    ...m,
    active: m.id === currentActiveModel,
  }));

  const vadSilence = parseInt(process.env.VOICE_VAD_THRESHOLD || "1400", 10);

  return {
    aiProvider: "deepseek",
    activeModel: currentActiveModel,
    supportedModels: models,
    speech: {
      sttProvider: "browser-web-speech",
      ttsProvider: "browser-speech-synthesis",
      supportedLanguages: [
        { code: "auto", label: "Auto-detect (Hindi / Hinglish / English)" },
        { code: "hi-IN", label: "Hindi (हिन्दी)" },
        { code: "en-IN", label: "Indian English" },
        { code: "en-US", label: "English (US)" },
      ],
      defaultLanguage: "auto",
      vadSilenceThresholdMs: isNaN(vadSilence) ? 1400 : vadSilence,
      vadMinSpeechDurationMs: 350,
      vadEnergyThreshold: 0.025,
      bargeInEnabled: true,
    },
    audioAnalysis: {
      fftSize: 256,
      smoothingTimeConstant: 0.8,
      minDecibels: -90,
      maxDecibels: -10,
    },
  };
}

export function setActiveVoiceModel(modelId: string): { success: boolean; activeModel: string; message: string } {
  const target = DEEPSEEK_VOICE_MODELS.find((m) => m.id === modelId);
  if (!target) {
    return {
      success: false,
      activeModel: currentActiveModel,
      message: `Model "${modelId}" is not a supported DeepSeek model. Supported models: ${DEEPSEEK_VOICE_MODELS.map((m) => m.id).join(", ")}.`,
    };
  }

  currentActiveModel = target.id;
  return {
    success: true,
    activeModel: currentActiveModel,
    message: `Active voice reasoning model set to ${target.name} (${target.id}).`,
  };
}

export function getActiveVoiceModel(): string {
  return currentActiveModel;
}

