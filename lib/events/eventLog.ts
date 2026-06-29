import { getDb } from '../db.ts';
import type { SessionEvent, SessionEventType, SessionActor } from './types.ts';

export function getNextSequenceIndex(sessionId: string): number {
  const db = getDb();
  const row = db.prepare(
    'SELECT COALESCE(MAX(sequence_index), -1) as max_seq FROM session_events WHERE session_id = ?'
  ).get(sessionId) as { max_seq: number };
  return row.max_seq + 1;
}

export function appendSessionEvent(params: {
  session_id: string;
  event_type: SessionEventType;
  actor: SessionActor;
  text?: string | null;
  payload?: Record<string, unknown> | null;
  started_at_ms?: number | null;
  ended_at_ms?: number | null;
  duration_ms?: number | null;
}): string {
  const db = getDb();
  const id = 'evt-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  const seq = getNextSequenceIndex(params.session_id);

  db.prepare(`INSERT INTO session_events
    (id, session_id, sequence_index, event_type, actor, text, payload_json, started_at_ms, ended_at_ms, duration_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    params.session_id,
    seq,
    params.event_type,
    params.actor,
    params.text || null,
    params.payload ? JSON.stringify(params.payload) : null,
    params.started_at_ms ?? null,
    params.ended_at_ms ?? null,
    params.duration_ms ?? null,
  );

  return id;
}

export function getSessionEvents(sessionId: string): SessionEvent[] {
  const db = getDb();
  const rows = db.prepare(
    'SELECT * FROM session_events WHERE session_id = ? ORDER BY sequence_index ASC'
  ).all(sessionId) as any[];

  return rows.map(r => ({
    id: r.id,
    session_id: r.session_id,
    sequence_index: r.sequence_index,
    event_type: r.event_type as SessionEventType,
    actor: r.actor as SessionActor,
    text: r.text,
    payload_json: r.payload_json ? JSON.parse(r.payload_json) : null,
    started_at_ms: r.started_at_ms,
    ended_at_ms: r.ended_at_ms,
    duration_ms: r.duration_ms,
    created_at: r.created_at,
  }));
}

export function getSessionEventCount(sessionId: string): number {
  const db = getDb();
  const row = db.prepare('SELECT COUNT(*) as c FROM session_events WHERE session_id = ?').get(sessionId) as { c: number };
  return row.c;
}
