import { getSessionEvents } from '../events/eventLog';

export interface SpeakerTurn {
  speaker: 'customer' | 'candidate';
  eventId: string;
  sequenceIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  responseLatencyMs: number | null;
  text: string;
}

export interface TurnTimeline {
  turns: SpeakerTurn[];
  totalCustomerTurns: number;
  totalCandidateTurns: number;
  avgCustomerTurnMs: number;
  avgCandidateTurnMs: number;
  avgResponseLatencyMs: number;
  maxResponseLatencyMs: number;
  minResponseLatencyMs: number;
  totalCustomerTalkMs: number;
  totalCandidateTalkMs: number;
  customerTalkRatio: number;
  candidateTalkRatio: number;
  callDurationMs: number;
  sentencesPerTurn: number;
}

export function buildTurnTimeline(sessionId: string): TurnTimeline {
  const events = getSessionEvents(sessionId);

  const messageEvents = events.filter(
    e => (e.event_type === 'candidate_message' || e.event_type === 'customer_message')
      && e.started_at_ms != null
  );

  const turns: SpeakerTurn[] = messageEvents.map((e, i) => {
    const prev = i > 0 ? messageEvents[i - 1] : null;
    const prevEndMs = prev?.ended_at_ms ?? prev?.started_at_ms ?? null;
    const responseLatencyMs = (prevEndMs != null && e.started_at_ms != null)
      ? Math.max(0, e.started_at_ms - prevEndMs)
      : null;

    return {
      speaker: e.event_type === 'customer_message' ? 'customer' : 'candidate',
      eventId: e.id,
      sequenceIndex: e.sequence_index,
      startMs: e.started_at_ms!,
      endMs: e.ended_at_ms ?? e.started_at_ms!,
      durationMs: Math.max(0, (e.ended_at_ms ?? e.started_at_ms!) - e.started_at_ms!),
      responseLatencyMs,
      text: e.text || '',
    };
  });

  const callStartMs = turns.length > 0 ? turns[0].startMs : 0;
  const callEndMs = turns.length > 0 ? turns[turns.length - 1].endMs : 0;

  const customerTurns = turns.filter(t => t.speaker === 'customer');
  const candidateTurns = turns.filter(t => t.speaker === 'candidate');

  const totalCustomerTalkMs = customerTurns.reduce((s, t) => s + t.durationMs, 0);
  const totalCandidateTalkMs = candidateTurns.reduce((s, t) => s + t.durationMs, 0);
  const totalTalkMs = totalCustomerTalkMs + totalCandidateTalkMs;

  const responseLatencies = turns
    .map(t => t.responseLatencyMs)
    .filter((v): v is number => v !== null);

  const totalSentences = turns.reduce((s, t) => {
    const count = t.text.split(/[.!?]+/).filter(Boolean).length;
    return s + Math.max(1, count);
  }, 0);

  return {
    turns,
    totalCustomerTurns: customerTurns.length,
    totalCandidateTurns: candidateTurns.length,
    avgCustomerTurnMs: customerTurns.length > 0
      ? Math.round(totalCustomerTalkMs / customerTurns.length)
      : 0,
    avgCandidateTurnMs: candidateTurns.length > 0
      ? Math.round(totalCandidateTalkMs / candidateTurns.length)
      : 0,
    avgResponseLatencyMs: responseLatencies.length > 0
      ? Math.round(responseLatencies.reduce((a, b) => a + b, 0) / responseLatencies.length)
      : 0,
    maxResponseLatencyMs: responseLatencies.length > 0
      ? Math.max(...responseLatencies)
      : 0,
    minResponseLatencyMs: responseLatencies.length > 0
      ? Math.min(...responseLatencies)
      : 0,
    totalCustomerTalkMs,
    totalCandidateTalkMs,
    customerTalkRatio: totalTalkMs > 0
      ? Math.round((totalCustomerTalkMs / totalTalkMs) * 1000) / 1000
      : 0,
    candidateTalkRatio: totalTalkMs > 0
      ? Math.round((totalCandidateTalkMs / totalTalkMs) * 1000) / 1000
      : 0,
    callDurationMs: Math.max(0, callEndMs - callStartMs),
    sentencesPerTurn: turns.length > 0
      ? Math.round((totalSentences / turns.length) * 10) / 10
      : 0,
  };
}

export function computeTimingGrade(avgLatencyMs: number): string {
  if (avgLatencyMs < 500) return 'very_fast';
  if (avgLatencyMs < 1500) return 'responsive';
  if (avgLatencyMs < 3000) return 'normal';
  if (avgLatencyMs < 6000) return 'hesitant';
  return 'very_slow';
}

export function computeTalkBalanceGrade(talkImbalance: number): string {
  if (talkImbalance < 0.1) return 'balanced';
  if (talkImbalance < 0.25) return 'slightly_imbalanced';
  if (talkImbalance < 0.4) return 'imbalanced';
  return 'very_imbalanced';
}
