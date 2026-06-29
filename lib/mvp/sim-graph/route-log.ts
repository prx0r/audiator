import { appendSessionEvent } from '../../events/eventLog.ts';
import type { CustomerDecision, RouteEvent } from './types.ts';

export function appendRouteLog(params: { sessionId: string; decision: CustomerDecision; routeEvent: RouteEvent }): string {
  return appendSessionEvent({
    session_id: params.sessionId,
    event_type: 'customer_message',
    actor: 'customer',
    text: params.decision.customerResponseText,
    payload: { decision: params.decision, routeEvent: params.routeEvent },
  });
}
