import { RoomServiceClient } from "livekit-server-sdk";
import { getLiveKitConfig, isLiveKitConfigured } from "./config";

/**
 * Returns a LiveKit RoomServiceClient instance using server-validated configuration.
 */
export function getRoomServiceClient(): RoomServiceClient {
  const { url, apiKey, apiSecret } = getLiveKitConfig();
  const httpUrl = url.replace(/^ws(s)?:/, "http$1:");
  return new RoomServiceClient(httpUrl, apiKey, apiSecret);
}

/**
 * Authoritatively creates or prepares a LiveKit room with defined constraints.
 */
export async function createLiveKitRoom(options: {
  roomName: string;
  maxParticipants?: number;
  emptyTimeoutSeconds?: number;
}): Promise<boolean> {
  if (!isLiveKitConfigured()) return false;
  try {
    const client = getRoomServiceClient();
    await client.createRoom({
      name: options.roomName,
      maxParticipants: options.maxParticipants ?? 50,
      emptyTimeout: options.emptyTimeoutSeconds ?? 300,
    });
    return true;
  } catch (err: any) {
    // Room may already exist or LiveKit server may be starting up; treat gracefully
    console.warn("[LiveKitRoom] createRoom notice:", err?.message || err);
    return false;
  }
}

/**
 * Authoritatively terminates a LiveKit room upon call termination.
 */
export async function deleteLiveKitRoom(roomName: string): Promise<boolean> {
  if (!isLiveKitConfigured()) return false;
  try {
    const client = getRoomServiceClient();
    await client.deleteRoom(roomName);
    return true;
  } catch (err: any) {
    console.warn("[LiveKitRoom] deleteRoom notice:", err?.message || err);
    return false;
  }
}

/**
 * Ejects a participant from a live media room.
 * Propagates network/service failures to allow retry backoff in the transactional outbox,
 * while treating participant-not-found and room-not-found as idempotent success.
 */
export async function removeLiveKitParticipant(roomName: string, identity: string): Promise<boolean> {
  if (!isLiveKitConfigured()) return false;
  const client = getRoomServiceClient();
  try {
    await client.removeParticipant(roomName, identity);
    return true;
  } catch (err: any) {
    const msg = (err?.message || String(err)).toLowerCase();
    const status = err?.status || err?.statusCode || err?.code;
    const isNotFound =
      status === 404 ||
      msg.includes("not found") ||
      msg.includes("could not find") ||
      msg.includes("does not exist") ||
      msg.includes("participant_not_found") ||
      msg.includes("room_not_found");

    if (isNotFound) {
      // Participant is already gone from SFU or room was already terminated
      return true;
    }
    // Re-throw transient network/service errors for outbox retry handling
    throw err;
  }
}

/**
 * Mutes or unmutes a participant's published track directly on the LiveKit SFU (Host Mute).
 */
export async function muteLiveKitTrack(
  roomName: string,
  identity: string,
  trackSid: string,
  muted: boolean = true
): Promise<boolean> {
  if (!isLiveKitConfigured()) return false;
  const client = getRoomServiceClient();
  try {
    await client.mutePublishedTrack(roomName, identity, trackSid, muted);
    return true;
  } catch (err: any) {
    const msg = (err?.message || String(err)).toLowerCase();
    const status = err?.status || err?.statusCode || err?.code;
    const isNotFound =
      status === 404 ||
      msg.includes("not found") ||
      msg.includes("could not find") ||
      msg.includes("does not exist");
    if (isNotFound) return true;
    throw err;
  }
}


