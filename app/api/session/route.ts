import { NextRequest, NextResponse } from 'next/server';
import { getDb, initTables } from '@/lib/db';
import crypto from 'crypto';

export async function POST(req: NextRequest) {
  try {
    initTables();
    const db = getDb();
    const id = crypto.randomUUID();

    db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run(id, 'active');

    return NextResponse.json({ id, status: 'active' });
  } catch (err: any) {
    console.error('[Session] Create error:', err.message);
    return NextResponse.json({ error: 'Failed to create session' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json();
    const { id, status } = body;

    if (!id) return NextResponse.json({ error: 'Missing session id' }, { status: 400 });

    const db = getDb();
    db.prepare('UPDATE sessions SET status = ?, ended_at = datetime(\'now\') WHERE id = ?')
      .run(status || 'completed', id);

    return NextResponse.json({ id, status: status || 'completed' });
  } catch (err: any) {
    console.error('[Session] Update error:', err.message);
    return NextResponse.json({ error: 'Failed to update session' }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');

    if (!id) return NextResponse.json({ error: 'Missing session id' }, { status: 400 });

    const db = getDb();
    const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id);

    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const events = db.prepare('SELECT * FROM session_events WHERE session_id = ? ORDER BY sequence_index ASC').all(id);
    const recording = db.prepare('SELECT * FROM recordings WHERE session_id = ? ORDER BY created_at DESC LIMIT 1').get(id);

    return NextResponse.json({ session, events, recording });
  } catch (err: any) {
    console.error('[Session] Get error:', err.message);
    return NextResponse.json({ error: 'Failed to get session' }, { status: 500 });
  }
}
