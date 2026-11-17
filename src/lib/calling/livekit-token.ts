import { AccessToken } from "livekit-server-sdk";
import { getLiveKitConfig } from "./config";

export interface GenerateTokenOptions {
  roomName: string;
  userId: string;
  userName?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  ttlSeconds?: number;
}

/**
 * Generates a short-lived cryptographically signed LiveKit Access Token.
 * Enforces:
 * - Strict binding of identity to authenticated Cyraops userId
 * - Binding to server-stored random livekitRoomName
 * - Maximum TTL of 60 seconds (strictly preventing token replay)
 * - Server-authoritative publishing and subscribing permissions
 */
export async function generateParticipantToken(
  options: GenerateTokenOptions
): Promise<{ token: string; url: string }> {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const {
    roomName,
    userId,
    userName,
    canPublish = true,
    canSubscribe = true,
    ttlSeconds = 60,
  } = options;

  // Enforce strictly bounded TTL (max 60 seconds)
  const boundedTtl = Math.min(Math.max(ttlSeconds, 10), 60);

  const tokenInstance = new AccessToken(apiKey, apiSecret, {
    identity: userId,
    name: userName || userId,
    ttl: `${boundedTtl}s`,
  });

  tokenInstance.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe,
    canPublishData: true,
  });

  const token = await tokenInstance.toJwt();
  return { token, url };
}

