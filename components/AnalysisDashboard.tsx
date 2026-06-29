'use client';

import { MetricsPanel } from './MetricsPanel';
import { CallTranscript } from './CallTranscript';

interface AnalysisData {
  analysis: any;
  turnTimeline: any;
  diarization: any;
  recordingId?: string;
}

interface SessionData {
  id: string;
  status: string;
  messages: Array<{ role: string; text: string; timestamp: number }>;
}

export function AnalysisDashboard({ session, analysis }: { session: SessionData | null; analysis: AnalysisData | null }) {
  if (!session && !analysis) {
    return (
      <div className="text-center text-gray-500 py-12">
        <p className="text-lg">No call data yet.</p>
        <p className="text-sm mt-1">Start a call to see analysis here.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {analysis && (
        <MetricsPanel analysis={{
          analysis: analysis.analysis,
          turnTimeline: analysis.turnTimeline,
          diarization: analysis.diarization,
        }} />
      )}

      {session && session.messages && session.messages.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">Transcript</h3>
          <CallTranscript messages={session.messages.map((m: any) => ({
            role: m.role as 'customer' | 'candidate' | 'system',
            text: m.text,
            timestamp: m.timestamp,
          }))} />
        </div>
      )}
    </div>
  );
}
