'use client';

import { useEffect, useState } from 'react';
import { AnalysisDashboard } from '@/components/AnalysisDashboard';
import { MetricsPanel } from '@/components/MetricsPanel';
import { CallTranscript } from '@/components/CallTranscript';

export default function AnalysisPage({ params }: { params: { id: string } }) {
  const [sessionData, setSessionData] = useState<any>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/session?id=${params.id}`);
        if (!res.ok) throw new Error('Session not found');
        const data = await res.json();
        setSessionData(data.session);

        if (data.recording?.analysis_json) {
          setAnalysisData(JSON.parse(data.recording.analysis_json));
        }

        const events = data.events || [];
        const messages = events
          .filter((e: any) => e.event_type === 'customer_message' || e.event_type === 'candidate_message')
          .map((e: any) => ({
            role: e.actor as 'customer' | 'candidate',
            text: e.text || '',
            timestamp: e.started_at_ms || 0,
          }));
        if (data.session) {
          setSessionData((prev: any) => ({ ...prev, messages }));
        }
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.id]);

  if (loading) return <div className="text-gray-400 text-center py-12">Loading analysis...</div>;
  if (error) return <div className="text-red-400 text-center py-12">{error}</div>;
  if (!sessionData) return <div className="text-gray-500 text-center py-12">Session not found</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Call Analysis</h2>
        <p className="text-sm text-gray-400">Session: {sessionData.id}</p>
        <p className="text-sm text-gray-400">Status: {sessionData.status}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Metrics</h3>
          <MetricsPanel analysis={{
            analysis: analysisData,
            turnTimeline: analysisData?.turnTimeline,
            diarization: analysisData?.diarization,
          }} />
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Transcript</h3>
          <CallTranscript messages={sessionData.messages || []} />
        </div>
      </div>
    </div>
  );
}
