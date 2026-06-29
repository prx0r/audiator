import { Room, RoomEvent, Track, RemoteTrackPublication, LocalAudioTrack } from 'livekit-client';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const LIVEKIT_URL = process.env.LIVEKIT_URL;
const LIVEKIT_TOKEN = process.env.CUSTOMER_LIVEKIT_TOKEN;
const SESSION_ID = process.env.SESSION_ID;
const NEXTJS_URL = process.env.NEXTJS_URL || 'http://127.0.0.1:3001';

if (!LIVEKIT_URL || !LIVEKIT_TOKEN || !SESSION_ID) {
  console.error('[worker] Missing LIVEKIT_URL, CUSTOMER_LIVEKIT_TOKEN, or SESSION_ID');
  process.exit(1);
}

function silenceBuffer(durationMs = 180) {
  const sampleRate = 16000;
  const samples = Math.floor(sampleRate * durationMs / 1000);
  const dataSize = samples * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;
  const write = (s) => { buffer.write(s, offset); offset += s.length; };
  const u16 = (n) => { offset = buffer.writeUInt16LE(n, offset); };
  const u32 = (n) => { offset = buffer.writeUInt32LE(n, offset); };
  write('RIFF'); u32(36 + dataSize); write('WAVE'); write('fmt '); u32(16); u16(1); u16(1); u32(sampleRate); u32(sampleRate * 2); u16(2); u16(16); write('data'); u32(dataSize);
  return buffer;
}

const audioCache = new Map();

async function getCustomerAudio(text) {
  const cached = audioCache.get(text);
  if (cached) return cached;

  try {
    const res = await fetch(`${NEXTJS_URL}/api/tts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`TTS returned ${res.status}`);
    const blob = await res.blob();
    const buffer = Buffer.from(await blob.arrayBuffer());
    audioCache.set(text, buffer);
    return buffer;
  } catch {
    return silenceBuffer();
  }
}

async function postRouteEvent(event) {
  try {
    await fetch(`${NEXTJS_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: event.candidateText,
        sessionId: SESSION_ID,
      }),
    });
  } catch (err) {
    console.error('[worker] Failed to post route event:', err.message);
  }
}

async function readAudioTrack(track, room) {
  const mediaStream = new MediaStream([track.mediaStreamTrack]);
  const mediaRecorder = new MediaRecorder(mediaStream, { mimeType: 'audio/webm;codecs=opus' });
  const chunks = [];

  return new Promise((resolve) => {
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm;codecs=opus' });
      const arrayBuffer = await blob.arrayBuffer();
      resolve(Buffer.from(arrayBuffer));
    };
    mediaRecorder.start();
    setTimeout(() => {
      if (mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, 10000);
  });
}

async function main() {
  console.log(`[worker] Connecting to ${LIVEKIT_URL} as customer...`);
  const room = new Room({ adaptiveStream: true, dynacast: true });

  room.on(RoomEvent.TrackSubscribed, async (track, publication, participant) => {
    console.log(`[worker] Track subscribed from ${participant.identity}: ${track.kind}`);
    if (track.kind === Track.Kind.Audio && participant.identity?.startsWith('candidate-')) {
      console.log(`[worker] Processing candidate audio...`);
      const audioBuffer = await readAudioTrack(track, room);

      const base64Audio = audioBuffer.toString('base64');
      const sttRes = await fetch(`${NEXTJS_URL}/api/stt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioBase64: base64Audio,
          mimeType: 'audio/webm;codecs=opus',
          durationMs: 0,
        }),
      });

      if (!sttRes.ok) {
        console.error(`[worker] STT failed: ${sttRes.status}`);
        return;
      }

      const sttData = await sttRes.json();
      const transcript = sttData.text?.trim();
      if (!transcript) {
        console.log(`[worker] Empty transcript`);
        return;
      }
      console.log(`[worker] Transcript: "${transcript}"`);

      const chatRes = await fetch(`${NEXTJS_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: transcript, sessionId: SESSION_ID }),
      });
      if (!chatRes.ok) {
        console.error(`[worker] Scenario turn failed: ${chatRes.status}`);
        return;
      }

      const chatData = await chatRes.json();
      const reply = chatData.reply;
      console.log(`[worker] Reply: "${reply}"`);

      const audio = await getCustomerAudio(reply);
      console.log(`[worker] Publishing customer audio (${audio.length} bytes)...`);

      await room.localParticipant.publishTrack(
        new LocalAudioTrack(
          new MediaStreamTrack(),
          { source: 'microphone' }
        ),
        { name: 'customer-audio' }
      );
    }
  });

  await room.connect(LIVEKIT_URL, LIVEKIT_TOKEN);
  console.log(`[worker] Connected as customer, session=${SESSION_ID}`);

  const res = await fetch(`${NEXTJS_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: '__opening__', sessionId: SESSION_ID }),
  });
  if (res.ok) {
    const data = await res.json();
    const openingAudio = await getCustomerAudio(data.reply || "Hi, this is Sarah in the office. Outlook won't send an email and I need it gone before my meeting.");
    console.log(`[worker] Publishing opening line (${openingAudio.length} bytes)...`);
  }

  process.on('SIGINT', () => { room.disconnect(); process.exit(0); });
  process.on('SIGTERM', () => { room.disconnect(); process.exit(0); });
}

main().catch((err) => {
  console.error('[worker] Fatal:', err.message);
  process.exit(1);
});
