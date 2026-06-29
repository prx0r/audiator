'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { Room, RoomEvent, RemoteTrack, Track } from 'livekit-client';

export interface LiveKitSession {
  sessionId: string;
  roomName: string;
  candidateToken: string;
  livekitUrl: string;
}

export function useLiveKit() {
  const [session, setSession] = useState<LiveKitSession | null>(null);
  const [connected, setConnected] = useState(false);
  const [candidateAudioTrack, setCandidateAudioTrack] = useState<RemoteTrack | null>(null);
  const roomRef = useRef<Room | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  const createRoom = useCallback(async () => {
    const res = await fetch('/api/livekit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create' }),
    });
    if (!res.ok) throw new Error('Failed to create LiveKit room');
    const data: LiveKitSession = await res.json();
    setSession(data);
    return data;
  }, []);

  const joinAsCandidate = useCallback(async (token: string, livekitUrl: string) => {
    const room = new Room({ adaptiveStream: true, dynacast: true });

    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (track.kind === Track.Kind.Audio && participant.identity?.startsWith('customer-')) {
        setCandidateAudioTrack(track);
      }
    });

    room.on(RoomEvent.Disconnected, () => {
      setConnected(false);
      setCandidateAudioTrack(null);
    });

    await room.connect(livekitUrl, token);
    roomRef.current = room;
    setConnected(true);
    return room;
  }, []);

  const startCall = useCallback(async () => {
    const data = await createRoom();
    await joinAsCandidate(data.candidateToken, data.livekitUrl);
    return data;
  }, [createRoom, joinAsCandidate]);

  const endCall = useCallback(async () => {
    if (roomRef.current) {
      roomRef.current.disconnect();
      roomRef.current = null;
    }
    setConnected(false);
    setCandidateAudioTrack(null);

    if (session?.sessionId) {
      await fetch('/api/livekit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'end', sessionId: session.sessionId }),
      });
    }
  }, [session]);

  useEffect(() => {
    if (candidateAudioTrack && audioElRef.current) {
      const el = audioElRef.current;
      el.srcObject = new MediaStream([candidateAudioTrack.mediaStreamTrack]);
      el.play().catch(() => {});
    }
  }, [candidateAudioTrack]);

  useEffect(() => {
    return () => {
      roomRef.current?.disconnect();
    };
  }, []);

  return {
    session,
    connected,
    candidateAudioTrack,
    audioElement: <audio ref={audioElRef} autoPlay />,
    startCall,
    endCall,
  };
}
