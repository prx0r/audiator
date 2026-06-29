export type SessionEventType =
  | 'assessment_started'
  | 'customer_message'
  | 'candidate_message'
  | 'candidate_audio_started'
  | 'candidate_audio_ended'
  | 'transcript_partial'
  | 'transcript_final'
  | 'red_flag_triggered'
  | 'assessment_completed';

export type SessionActor = 'candidate' | 'customer' | 'system';

export interface SessionEvent {
  id: string;
  session_id: string;
  sequence_index: number;
  event_type: SessionEventType;
  actor: SessionActor;
  text: string | null;
  started_at_ms: number | null;
  ended_at_ms: number | null;
  duration_ms: number | null;
  payload_json: Record<string, unknown> | null;
  created_at: string;
}

export interface TimingMetrics {
  total_duration_ms: number | null;
  time_to_first_candidate_response_ms: number | null;
}

export interface EvidenceTimelineEntry {
  sequence_index: number;
  event_type: string;
  actor: string;
  formatted_time: string;
  text: string | null;
  timestamp_ms: number | null;
  duration_ms: number | null;
}
