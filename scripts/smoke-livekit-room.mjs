const required = ['LIVEKIT_URL', 'LIVEKIT_API_KEY', 'LIVEKIT_API_SECRET'];
const missing = required.filter((key) => !process.env[key]);

if (missing.length) {
  console.log(JSON.stringify({ skipped: true, reason: `Missing ${missing.join(', ')}` }, null, 2));
  process.exit(0);
}

const livekitUrl = process.env.LIVEKIT_URL;
const { RoomServiceClient, AccessToken } = await import('livekit-server-sdk');
const { Room, RoomEvent, Track } = await import('livekit-client');

const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

const roomClient = new RoomServiceClient(livekitUrl, apiKey, apiSecret);
const roomName = `smoke-test-${Date.now().toString(36)}`;

console.log(`[smoke] Creating room: ${roomName}`);

try {
  await roomClient.createRoom({ name: roomName, emptyTimeout: 120, maxParticipants: 2 });
  console.log(`[smoke] Room created: ${roomName}`);

  const candidateAt = new AccessToken(apiKey, apiSecret, { identity: `candidate-${roomName}`, ttl: '600s' });
  candidateAt.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const candidateToken = await candidateAt.toJwt();
  console.log(`[smoke] Candidate token generated`);

  const customerAt = new AccessToken(apiKey, apiSecret, { identity: `customer-${roomName}`, ttl: '600s' });
  customerAt.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true });
  const customerToken = await customerAt.toJwt();
  console.log(`[smoke] Customer token generated`);

  console.log(`[smoke] Joining candidate room...`);
  const candidateRoom = new Room();
  await candidateRoom.connect(livekitUrl, candidateToken);
  console.log(`[smoke] Candidate joined`);

  console.log(`[smoke] Joining customer room...`);
  const customerRoom = new Room();
  await customerRoom.connect(livekitUrl, customerToken);
  console.log(`[smoke] Customer joined`);

  customerRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log(`[smoke] Customer received track from ${participant.identity}: ${track.kind}`);
  });

  candidateRoom.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
    console.log(`[smoke] Candidate received track from ${participant.identity}: ${track.kind}`);
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  candidateRoom.disconnect();
  customerRoom.disconnect();
  console.log(`[smoke] Rooms disconnected`);

  await roomClient.deleteRoom(roomName);
  console.log(`[smoke] Room deleted`);

  console.log(JSON.stringify({ passed: true, roomName }, null, 2));
  process.exit(0);
} catch (err) {
  console.error(`[smoke] Failed:`, err.message);
  try { await roomClient.deleteRoom(roomName); } catch {}
  console.log(JSON.stringify({ passed: false, error: err.message }, null, 2));
  process.exit(1);
}
