'use client';

import { useEffect, useState } from 'react';
import { MetricsPanel } from '@/components/MetricsPanel';
import { CallTranscript } from '@/components/CallTranscript';

interface RouteEvent {
  turnId: string;
  candidateText: string;
  customerResponseText: string;
  evidenceTags: string[];
  scoreSignals: Record<string, number>;
  createdAt: string;
}

interface Assessment {
  rating: string;
  score: number;
  dimensions: {
    technical: { score: number; feedback: string };
    communication: { score: number; feedback: string };
    callControl: { score: number; feedback: string };
    professionalism: { score: number; feedback: string };
  };
  strengths: string[];
  improvements: string[];
  narrative: string;
}

interface SessionData {
  id: string;
  status: string;
  messages: Array<{ role: 'customer' | 'candidate' | 'system'; text: string; timestamp: number }>;
  routeEvents: RouteEvent[];
  assessment?: Assessment | null;
}

function getRatingColor(rating: string) {
  switch (rating) {
    case 'EXCELLENT': return 'text-green-400 bg-green-900/30';
    case 'GOOD': return 'text-blue-400 bg-blue-900/30';
    case 'FAIR': return 'text-yellow-400 bg-yellow-900/30';
    case 'POOR': return 'text-orange-400 bg-orange-900/30';
    case 'FAIL': return 'text-red-400 bg-red-900/30';
    default: return 'text-gray-400 bg-gray-800';
  }
}

export default function AnalysisPage({ params }: { params: { id: string } }) {
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [analysisData, setAnalysisData] = useState<any>(null);
  const [mp3Url, setMp3Url] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/session?id=${params.id}`);
        if (!res.ok) throw new Error('Session not found');
        const data = await res.json();

        if (data.mp3Url) setMp3Url(data.mp3Url);

        let assessment: Assessment | null = null;
        if (data.recording?.analysis_json) {
          const analysis = typeof data.recording.analysis_json === 'string'
            ? JSON.parse(data.recording.analysis_json)
            : data.recording.analysis_json;
          setAnalysisData(analysis);
          if (analysis.assessment) {
            assessment = analysis.assessment;
          }
        }

        const events = data.events || [];
        const routeEvents: RouteEvent[] = [];
        const rawMessages: Array<{ role: 'customer' | 'candidate'; text: string; timestamp: number }> = events
          .filter((e: any) => e.event_type === 'customer_message' || e.event_type === 'candidate_message')
          .map((e: any) => {
            const re = e.payload_json?.routeEvent as RouteEvent | undefined;
            if (re) routeEvents.push(re);
            return {
              role: e.actor as 'customer' | 'candidate',
              text: e.text || '',
              timestamp: e.started_at_ms || 0,
            };
          });

        setSessionData({
          id: data.session.id || '',
          status: data.session.status || '',
          messages: rawMessages,
          routeEvents,
          assessment,
        });
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

  const routeEvents = sessionData.routeEvents || [];
  const assessment = sessionData.assessment;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-white">Call Analysis</h2>
        <p className="text-sm text-gray-400">Session: {sessionData.id.slice(0, 8)}...</p>
        <p className="text-sm text-gray-400">Status: {sessionData.status} | Turns: {routeEvents.length}</p>
      </div>

      {mp3Url && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Call Recording</h3>
          <audio controls className="w-full" src={mp3Url}>
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {assessment && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-white">LLM Assessment</h3>
            <div className={`px-3 py-1 rounded-lg text-sm font-bold ${getRatingColor(assessment.rating)}`}>
              {assessment.rating} ({assessment.score}/100)
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {(['technical', 'communication', 'callControl', 'professionalism'] as const).map(dim => {
              const d = assessment.dimensions[dim];
              const barColor = d.score >= 8 ? 'bg-green-500' : d.score >= 5 ? 'bg-yellow-500' : 'bg-red-500';
              return (
                <div key={dim} className="bg-gray-800/50 rounded-lg p-3">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-200 capitalize">{dim}</span>
                    <span className="text-xs font-mono text-gray-400">{d.score}/10</span>
                  </div>
                  <div className="h-1.5 bg-gray-700 rounded-full mb-2">
                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${d.score * 10}%` }} />
                  </div>
                  <p className="text-xs text-gray-400 leading-relaxed">{d.feedback}</p>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            {assessment.strengths.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-green-400 mb-2">Strengths</h4>
                <ul className="space-y-1">
                  {assessment.strengths.map((s, i) => (
                    <li key={i} className="text-xs text-gray-300 flex gap-2">
                      <span className="text-green-500 shrink-0">+</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {assessment.improvements.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-orange-400 mb-2">Improvements</h4>
                <ul className="space-y-1">
                  {assessment.improvements.map((s, i) => (
                    <li key={i} className="text-xs text-gray-300 flex gap-2">
                      <span className="text-orange-500 shrink-0">→</span>
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="bg-gray-800/30 rounded-lg p-4 border-l-2 border-blue-500">
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-line">{assessment.narrative}</p>
          </div>
        </div>
      )}

      {routeEvents.length > 0 && (
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Route Path</h3>
          <div className="space-y-1">
            {routeEvents.map((ev, i) => (
              <div key={ev.turnId} className="flex items-start gap-3 py-1.5 border-b border-gray-700/50 last:border-0">
                <span className="text-[10px] text-gray-500 w-8 shrink-0 pt-0.5">#{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium text-blue-300">Turn {i + 1}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate" title={ev.candidateText}>
                    &ldquo;{ev.candidateText}&rdquo;
                  </p>
                  {ev.evidenceTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {ev.evidenceTags.map((tag) => (
                        <span key={tag} className="text-[9px] bg-gray-700 text-gray-300 px-1 py-0.5 rounded">{tag}</span>
                      ))}
                    </div>
                  )}

                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Acoustic & Turn Metrics</h3>
          {!analysisData ? (
            <div className="border border-dashed border-gray-600 rounded-lg p-6 text-center">
              <p className="text-sm text-gray-400 mb-2">No audio recording available</p>
              <p className="text-xs text-gray-500">Audio analysis (openSMILE prosody, MP3 playback) requires using the mic during the call. Text-only calls don't produce audio data.</p>
            </div>
          ) : (
            <MetricsPanel analysis={{
              analysis: analysisData,
              turnTimeline: analysisData?.turnTimeline,
              diarization: analysisData?.diarization,
              opensmile: analysisData?.opensmile,
            }} />
          )}
        </div>

        <div className="bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-gray-300 mb-4">Transcript</h3>
          <CallTranscript messages={sessionData.messages || []} />
        </div>
      </div>
    </div>
  );
}
