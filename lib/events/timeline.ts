import { SessionEvent, TimingMetrics, EvidenceTimelineEntry } from './types';

export function buildEvidenceTimeline(
  events: SessionEvent[],
): EvidenceTimelineEntry[] {
  if (events.length === 0) return [];

  const firstTs = events[0].started_at_ms || events[0].ended_at_ms || 0;

  return events.map(e => {
    const ts = e.started_at_ms || e.ended_at_ms || 0;
    const offset = ts - firstTs;
    const secs = Math.floor(offset / 1000);
    const mins = Math.floor(secs / 60);
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;

    return {
      sequence_index: e.sequence_index,
      event_type: e.event_type,
      actor: e.actor,
      formatted_time: formatted,
      text: e.text,
      timestamp_ms: e.started_at_ms || e.ended_at_ms,
      duration_ms: e.duration_ms,
    };
  });
}

export function calculateTimingMetrics(events: SessionEvent[]): TimingMetrics {
  const metrics: TimingMetrics = {
    total_duration_ms: null,
    time_to_first_candidate_response_ms: null,
  };

  if (events.length === 0) return metrics;

  const firstEvent = events[0];
  const startTs = firstEvent.started_at_ms || firstEvent.ended_at_ms || 0;
  const lastEvent = events[events.length - 1];

  const endTs = lastEvent.ended_at_ms || lastEvent.started_at_ms || startTs;
  if (endTs > startTs) {
    metrics.total_duration_ms = endTs - startTs;
  }

  const firstCandidateMsg = events.find(e => e.event_type === 'candidate_message');
  if (firstCandidateMsg && firstCandidateMsg.started_at_ms && startTs) {
    metrics.time_to_first_candidate_response_ms = firstCandidateMsg.started_at_ms - startTs;
  }

  return metrics;
}
