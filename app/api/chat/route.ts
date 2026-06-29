import { NextRequest, NextResponse } from 'next/server';
import { initTables } from '@/lib/db';
import { runScenarioTurn, runScenarioTurnForSession } from '@/lib/mvp/sim-graph/runtime';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const message = String(body.message ?? '').trim();
    const sessionId = body.sessionId ? String(body.sessionId) : '';
    const history: { role: 'customer' | 'candidate'; text: string }[] = body.history ?? [];

    if (!message) return NextResponse.json({ error: 'Missing message' }, { status: 400 });

    initTables();

    const result = await (sessionId
      ? runScenarioTurnForSession({ sessionId, candidateText: message, history })
      : runScenarioTurn({ candidateText: message, history }));

    return NextResponse.json({
      reply: result.decision.customerResponseText,
      decision: result.decision,
      routeEvent: result.routeEvent,
    });
  } catch (err: any) {
    console.error('[Chat] error:', err.message);
    return NextResponse.json({ error: err.message }, { status: 502 });
  }
}
