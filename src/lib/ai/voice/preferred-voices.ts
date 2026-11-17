/**
 * Choosing a voice that does not sound like a robot.
 *
 * Browsers expose a long list of installed voices mixing 2005-era formant
 * synthesizers with modern neural ones, and the good ones are not first in the
 * list. Rather than showing that catalogue to a person, this reduces it to the
 * two things they actually want to choose between — a female voice and a male
 * voice — and picks the most natural of each.
 */

export interface VoiceLike {
  name: string;
  lang: string;
}

export type VoiceGender = "female" | "male";

/**
 * Names of installed voices, by the gender they present. Covers macOS, Windows,
 * Chrome's Google voices and the common eSpeak fallbacks. Unknown names fall back
 * to the explicit "female"/"male" markers some vendors put in the name.
 */
const FEMALE_NAMES = [
  "ava", "allison", "samantha", "susan", "serena", "karen", "moira", "tessa", "fiona",
  "victoria", "veena", "isha", "neerja", "heera", "kalpana", "swara", "zoe", "nicky",
  "kathy", "princess", "agnes", "vicki", "zira", "hazel", "eva", "linda", "mary",
];

const MALE_NAMES = [
  "alex", "tom", "daniel", "fred", "evan", "rishi", "prabhat", "ravi", "arjun",
  "aaron", "arthur", "gordon", "lee", "oliver", "russell", "david", "mark",
  "george", "james", "ryan", "nathan", "guy", "eric", "steffan", "hemant",
];

/** Voice families that sound human, best first. */
function qualityTier(name: string): number {
  if (/premium|enhanced|neural|natural|siri|wavenet/i.test(name)) return 0;
  if (/google/i.test(name)) return 1;
  if (/microsoft/i.test(name)) return 2;
  return 3;
}

function languageTier(lang: string): number {
  if (/^en-IN/i.test(lang)) return 0;
  if (/^hi/i.test(lang)) return 1;
  if (/^en/i.test(lang)) return 2;
  return 3;
}

/** The gender a voice presents, or null when it cannot be told. */
export function voiceGender(voice: VoiceLike): VoiceGender | null {
  const name = voice.name.toLowerCase();
  if (/\bfemale\b/.test(name)) return "female";
  if (/\bmale\b/.test(name)) return "male";
  const words = name.replace(/[()]/g, " ").split(/[\s_.-]+/).filter(Boolean);
  if (words.some((word) => FEMALE_NAMES.includes(word))) return "female";
  if (words.some((word) => MALE_NAMES.includes(word))) return "male";
  return null;
}

/**
 * The most natural voice of the requested gender.
 *
 * Quality outranks accent on purpose: a premium voice with a neutral accent
 * sounds like a person, which is what was asked for, where a robotic voice with
 * a local accent does not. Language only breaks ties.
 */
export function pickVoice(voices: readonly VoiceLike[], gender: VoiceGender): VoiceLike | null {
  const matching = voices.filter((voice) => voiceGender(voice) === gender);
  if (!matching.length) return null;
  return [...matching].sort((a, b) => {
    const quality = qualityTier(a.name) - qualityTier(b.name);
    if (quality !== 0) return quality;
    const language = languageTier(a.lang) - languageTier(b.lang);
    if (language !== 0) return language;
    return a.name.localeCompare(b.name);
  })[0];
}

/** Which of the two choices this list can actually offer. */
export function availableGenders(voices: readonly VoiceLike[]): VoiceGender[] {
  const genders: VoiceGender[] = [];
  if (pickVoice(voices, "female")) genders.push("female");
  if (pickVoice(voices, "male")) genders.push("male");
  return genders;
}
