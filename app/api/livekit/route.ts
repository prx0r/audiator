import { NextRequest, NextResponse } from 'next/server';
import { initTables } from '@/lib/db';
import { createVoiceRoom, createCandidateToken, createCustomerToken, deleteVoiceRoom } from '@/lib/mvp/voice/livekit-room';
import { getDb } from '@/lib/db';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    initTables();
    const body = await req.json();
    const action = String(body.action ?? '');

    if (action === 'create') {
      const db = getDb();
      const sessionId = body.sessionId ?? crypto.randomUUID();

      await createVoiceRoom(sessionId);
      const candidateToken = await createCandidateToken(sessionId);
      const customerToken = await createCustomerToken(sessionId);

      db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run(sessionId, 'active');

      return NextResponse.json({
        sessionId,
        roomName: `callcallum-${sessionId}`,
        candidateToken,
        customerToken,
        livekitUrl: process.env.LIVEKIT_URL,
      });
    }

    if (action === 'end') {
      const sessionId = String(body.sessionId ?? '');
      if (!sessionId) return NextResponse.json({ error: 'Missing sessionId' }, { status: 400 });

      await deleteVoiceRoom(sessionId);

      const db = getDb();
      db.prepare('UPDATE sessions SET status = ?, ended_at = datetime(\'now\') WHERE id = ?').run('completed', sessionId);

      return NextResponse.json({ sessionId, status: 'completed' });
    }

    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (err: any) {
    console.error('[LiveKit] error:', err.message);
    return NextResponse.json({ error: 'LiveKit operation failed', detail: err.message }, { status: 502 });
  }
}
