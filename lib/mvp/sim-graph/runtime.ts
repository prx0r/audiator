import { appendSessionEvent } from '../../events/eventLog';
import { getSessionEvents } from '../../events/eventLog';
import { getAiCustomerResponse } from './ai-customer';
import { defaultPersona, getPersona } from './customer-personas';
import type { CustomerPersona } from './customer-personas';
import type { CustomerDecision, RouteEvent } from './types';

const TURNS_KEY = '__prior_facts';

function loadPriorFacts(events: any[]): string[] {
  for (const e of events) {
    if (e.payload_json?.[TURNS_KEY]) {
      return e.payload_json[TURNS_KEY] as string[];
    }
  }
  return [];
}

export async function runScenarioTurn(params: {
  candidateText: string;
  persona?: CustomerPersona;
  history?: { role: 'customer' | 'candidate'; text: string }[];
  priorFacts?: string[];
}): Promise<{ decision: CustomerDecision; routeEvent: RouteEvent }> {
  const persona = params.persona ?? defaultPersona();
  const history = params.history ?? [];
  const priorFacts = params.priorFacts ?? [];

  const result = await getAiCustomerResponse(persona, history, params.candidateText, priorFacts);

  const decision: CustomerDecision = {
    primaryIntent: 'ai_customer',
    customerResponseText: result?.reply ?? "I'm sorry, can you repeat that?",
    evidenceTags: result?.evidenceTags ?? [],
    scoreSignals: (result?.scoreSignals ?? {}) as any,
    issueResolved: result?.issueResolved ?? false,
  };

  const routeEvent: RouteEvent = {
    turnId: `turn_${String(history.length + 1).padStart(3, '0')}`,
    candidateText: params.candidateText,
    customerResponseText: decision.customerResponseText,
    evidenceTags: decision.evidenceTags,
    scoreSignals: decision.scoreSignals,
    createdAt: new Date().toISOString(),
  };

  return { decision, routeEvent };
}

export async function runScenarioTurnForSession(params: {
  sessionId: string;
  candidateText: string;
  history?: { role: 'customer' | 'candidate'; text: string }[];
}): Promise<{ decision: CustomerDecision; routeEvent: RouteEvent }> {
  const events = getSessionEvents(params.sessionId);
  const priorFacts = loadPriorFacts(events);

  const result = await runScenarioTurn({
    candidateText: params.candidateText,
    history: params.history,
    priorFacts,
  });

  const eventPayload: Record<string, unknown> = {
    routeEvent: result.routeEvent,
    decision: result.decision,
  };
  if (priorFacts.length > 0) {
    eventPayload[TURNS_KEY] = priorFacts;
  }

  appendSessionEvent({
    session_id: params.sessionId,
    event_type: 'candidate_message',
    actor: 'candidate',
    text: params.candidateText,
    payload: null,
  });
  appendSessionEvent({
    session_id: params.sessionId,
    event_type: 'customer_message',
    actor: 'customer',
    text: result.decision.customerResponseText,
    payload: eventPayload,
  });

  return result;
}
