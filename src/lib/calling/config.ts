/**
 * LiveKit Server Configuration Module
 * Strictly server-side only. Never expose API secrets to the client.
 */

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

/**
 * Returns validated LiveKit credentials from the server environment.
 * Throws an explicit error if any required configuration is missing.
 */
export function getLiveKitConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!url || !apiKey || !apiSecret) {
    throw new Error(
      "LiveKit configuration missing: Ensure LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET are set in server environment variables."
    );
  }

  return { url, apiKey, apiSecret };
}

/**
 * Returns true if all required LiveKit configuration variables are present.
 */
export function isLiveKitConfigured(): boolean {
  return Boolean(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}

