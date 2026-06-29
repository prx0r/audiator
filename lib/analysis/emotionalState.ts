import { getSessionEvents } from '../events/eventLog';

export type EmotionalState = 'neutral' | 'frustrated' | 'reassured' | 'angry' | 'anxious' | 'panicked' | 'relieved';

export interface EmotionalTransition {
  fromState: EmotionalState;
  toState: EmotionalState;
  triggeredBy: string;
  timestampMs: number;
  eventId: string;
}

export interface EmotionalTrajectory {
  initialState: EmotionalState;
  finalState: EmotionalState;
  transitions: EmotionalTransition[];
  netOutcome: 'de-escalated' | 'escalated' | 'stable' | 'mixed';
  deEscalationScore: number;
  summary: string;
}

export function buildEmotionalTrajectory(sessionId: string): EmotionalTrajectory | null {
  const events = getSessionEvents(sessionId);

  const moodChanges = events
    .filter(e => e.payload_json && typeof e.payload_json === 'object' && 'from' in e.payload_json && 'to' in e.payload_json)
    .map(e => {
      const payload = e.payload_json as Record<string, unknown> || {};
      return {
        fromState: (payload.from as EmotionalState) || 'neutral',
        toState: (payload.to as EmotionalState) || 'neutral',
        triggeredBy: (payload.reason as string) || e.text || 'unknown',
        timestampMs: e.started_at_ms || 0,
        eventId: e.id,
      };
    })
    .sort((a, b) => a.timestampMs - b.timestampMs);

  if (moodChanges.length === 0) return null;

  const initialState = moodChanges[0].fromState;
  const finalState = moodChanges[moodChanges.length - 1].toState;

  const moodValue: Record<string, number> = {
    panicked: 1,
    angry: 2,
    frustrated: 3,
    anxious: 3,
    neutral: 4,
    reassured: 5,
    relieved: 6,
  };

  const startVal = moodValue[initialState] || 4;
  const endVal = moodValue[finalState] || 4;

  let netOutcome: 'de-escalated' | 'escalated' | 'stable' | 'mixed';
  if (endVal > startVal + 1) netOutcome = 'de-escalated';
  else if (endVal < startVal - 1) netOutcome = 'escalated';
  else if (endVal === startVal) netOutcome = 'stable';
  else netOutcome = 'mixed';

  const deEscalationScore = Math.round(((endVal - 1) / 5) * 100);

  let summary = `Caller started ${initialState}, ended ${finalState}. `;
  if (netOutcome === 'de-escalated') summary += 'Candidate successfully de-escalated the caller.';
  else if (netOutcome === 'escalated') summary += 'Candidate escalated the situation.';
  else summary += 'Caller emotional state remained stable.';

  return {
    initialState,
    finalState,
    transitions: moodChanges.map(m => ({
      fromState: (m.fromState || 'neutral') as EmotionalState,
      toState: (m.toState || 'neutral') as EmotionalState,
      triggeredBy: m.triggeredBy,
      timestampMs: m.timestampMs,
      eventId: m.eventId,
    })),
    netOutcome,
    deEscalationScore,
    summary,
  };
}

export function buildEmotionalEvidence(trajectory: EmotionalTrajectory): Record<string, { status: string; evidence: string[]; explanation: string }> {
  const evidence: Record<string, { status: string; evidence: string[]; explanation: string }> = {};

  const escalatedMoods: EmotionalState[] = ['angry', 'panicked'];
  const deescalatedMoods: EmotionalState[] = ['reassured', 'relieved'];
  const midMoods: EmotionalState[] = ['frustrated', 'anxious'];

  const startedBad = midMoods.includes(trajectory.initialState) || escalatedMoods.includes(trajectory.initialState);
  const endedGood = midMoods.includes(trajectory.finalState) || deescalatedMoods.includes(trajectory.finalState);

  if (startedBad && endedGood) {
    evidence['emotional_de_escalation'] = {
      status: 'pass',
      evidence: [`Caller went from ${trajectory.initialState} to ${trajectory.finalState}`],
      explanation: 'Candidate successfully de-escalated the caller through effective communication.',
    };
  } else if (escalatedMoods.includes(trajectory.initialState) && escalatedMoods.includes(trajectory.finalState)) {
    evidence['emotional_de_escalation'] = {
      status: 'fail',
      evidence: [`Caller remained ${trajectory.finalState} throughout the call`],
      explanation: 'Candidate failed to de-escalate the caller.',
    };
  } else if (trajectory.finalState !== trajectory.initialState && trajectory.netOutcome === 'escalated') {
    evidence['emotional_escalation'] = {
      status: 'fail',
      evidence: [`Caller escalated from ${trajectory.initialState} to ${trajectory.finalState}`],
      explanation: 'Candidate\'s handling caused the caller to become more distressed.',
    };
  }

  const empathyTransitions = trajectory.transitions.filter(
    t => t.toState === 'reassured' || t.toState === 'relieved'
  );
  if (empathyTransitions.length > 0) {
    evidence['emotional_empathy_shown'] = {
      status: 'pass',
      evidence: empathyTransitions.map(t => `Caller moved to ${t.toState} after: ${t.triggeredBy}`),
      explanation: 'Candidate demonstrated empathy, improving caller emotional state.',
    };
  }

  return evidence;
}
