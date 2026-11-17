/**
 * Cyraops Voice Assistant Speech Adapters
 *
 * Requirements:
 * - STT and TTS are independent of the DeepSeek reasoning provider.
 * - Multi-language support: Hindi, Indian English, Hinglish code-switching.
 * - Clean abstractions supporting browser Web Speech API and server-side speech endpoints.
 * - Credentials kept strictly server-side.
 */

export interface SpeechRecognitionResult {
  transcript: string;
  isFinal: boolean;
  confidence: number;
  detectedLanguage?: string;
}

export interface SpeechSynthesisOptions {
  text: string;
  language?: string;
  voice?: string;
  rate?: number;
  pitch?: number;
}

export class SpeechAdapterService {
  /**
   * Evaluates language code and normalizes for Indian subcontinent context
   */
  static normalizeLanguage(inputLang?: string, browserLanguages: readonly string[] = []): string {
    let target = inputLang?.trim();
    if (!target || target.toLowerCase() === "auto") {
      target = browserLanguages.find((lang) => /^(hi|en)(-|$)/i.test(lang));
    }

    const normalized = (target || "en-IN").toLowerCase();
    if (normalized.startsWith("hi")) return "hi-IN";
    if (normalized === "en-us" || normalized.startsWith("en-us-")) return "en-US";
    if (normalized.startsWith("en")) return "en-IN";
    return "en-IN";
  }

  /**
   * Detects whether input text contains Hindi characters (Devanagari) or Hinglish keywords
   */
  static detectLanguageStyle(text: string): "hi" | "hinglish" | "en" {
    const devanagariRegex = /[\u0900-\u097F]/;
    if (devanagariRegex.test(text)) {
      return "hi";
    }

    const hinglishMarkers = [
      "karo", "karna", "dikhao", "bhejo", "batao", "hai", "hain", "kya", "mera", "mere",
      "meri", "aur", "chahiye", "kar do", "bata do", "dekho", "kaun", "kab", "kisko", "kaha"
    ];
    const lower = text.toLowerCase();
    const hasHinglish = hinglishMarkers.some((word) => new RegExp(`\\b${word}\\b`).test(lower));
    if (hasHinglish) {
      return "hinglish";
    }

    return "en";
  }
}

