import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export interface LiveKitConfig {
  url: string;
  apiKey: string;
  apiSecret: string;
}

let roomClient: RoomServiceClient | null = null;

function getConfig(): LiveKitConfig {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    throw new Error('LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET must be set');
  }
  return { url, apiKey, apiSecret };
}

function getRoomClient(): RoomServiceClient {
  if (roomClient) return roomClient;
  const config = getConfig();
  roomClient = new RoomServiceClient(config.url, config.apiKey, config.apiSecret);
  return roomClient;
}

export async function createVoiceRoom(sessionId: string, ttlSeconds: number = 3600): Promise<{ roomName: string }> {
  const client = getRoomClient();
  const roomName = `callcallum-${sessionId}`;
  try {
    await client.createRoom({ name: roomName, emptyTimeout: ttlSeconds, maxParticipants: 2 });
  } catch {
    const rooms = await client.listRooms([roomName]);
    if (rooms.length === 0) throw new Error('Failed to create LiveKit room');
  }
  return { roomName };
}

export async function deleteVoiceRoom(sessionId: string): Promise<void> {
  const client = getRoomClient();
  const roomName = `callcallum-${sessionId}`;
  try {
    await client.deleteRoom(roomName);
  } catch {
    // already deleted
  }
}

export async function createCandidateToken(sessionId: string, ttlSeconds: number = 3600): Promise<string> {
  const config = getConfig();
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `candidate-${sessionId}`,
    ttl: `${ttlSeconds}s`,
  });
  at.addGrant({ roomJoin: true, room: `callcallum-${sessionId}`, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

export async function createCustomerToken(sessionId: string, ttlSeconds: number = 3600): Promise<string> {
  const config = getConfig();
  const at = new AccessToken(config.apiKey, config.apiSecret, {
    identity: `customer-${sessionId}`,
    ttl: `${ttlSeconds}s`,
  });
  at.addGrant({ roomJoin: true, room: `callcallum-${sessionId}`, canPublish: true, canSubscribe: true });
  return at.toJwt();
}

export function available(): boolean {
  return !!(process.env.LIVEKIT_URL && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
}
