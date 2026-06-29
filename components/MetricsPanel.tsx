'use client';

interface AudioAnalysis {
  durationMs: number;
  silenceRatio: number;
  talkRatio: number;
  longestSilenceMs: number;
  silenceSegments: number;
  avgRms: number;
  peakRms: number;
  rmsVariance: number;
}

interface TurnTimeline {
  avgResponseLatencyMs: number;
  maxResponseLatencyMs: number;
  minResponseLatencyMs: number;
  totalCustomerTurns: number;
  totalCandidateTurns: number;
  customerTalkRatio: number;
  candidateTalkRatio: number;
  sentencesPerTurn: number;
}

interface AnalysisData {
  analysis?: AudioAnalysis;
  turnTimeline?: TurnTimeline;
  diarization?: {
    numSpeakers: number;
    speakerLabels: string[];
    perSpeakerMetrics: Record<string, { totalTalkMs: number; talkRatio: number; segmentCount: number }>;
  };
}

function timingGrade(ms: number): { label: string; color: string } {
  if (ms < 500) return { label: 'Very Fast', color: 'text-yellow-400' };
  if (ms < 1500) return { label: 'Responsive', color: 'text-green-400' };
  if (ms < 3000) return { label: 'Normal', color: 'text-blue-400' };
  if (ms < 6000) return { label: 'Hesitant', color: 'text-orange-400' };
  return { label: 'Very Slow', color: 'text-red-400' };
}

function bar(value: number, max: number = 1, label?: string) {
  const pct = Math.min(100, Math.round((value / max) * 100));
  return (
    <div className="flex items-center gap-2">
      {label && <span className="text-xs text-gray-400 w-24 shrink-0">{label}</span>}
      <div className="h-2 bg-gray-700 rounded-full flex-1 overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs text-gray-300 w-12 text-right">{typeof value === 'number' ? value.toFixed(1) : value}</span>
    </div>
  );
}

export function MetricsPanel({ analysis }: { analysis: AnalysisData | null }) {
  if (!analysis) {
    return (
      <div className="text-gray-500 text-sm p-4 border border-dashed border-gray-600 rounded-lg">
        No analysis data yet. Complete a call to see metrics.
      </div>
    );
  }

  const a = analysis.analysis;
  const t = analysis.turnTimeline;
  const d = analysis.diarization;

  return (
    <div className="space-y-6">
      {a && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Acoustic Analysis</h3>
          <div className="space-y-2">
            {bar(a.talkRatio, 1, 'Talk Ratio')}
            {bar(a.silenceRatio, 1, 'Silence Ratio')}
            {bar(a.longestSilenceMs / 10000, 1, 'Longest Pause')}
            {bar(a.avgRms, 0.5, 'Avg Loudness')}
            {bar(a.rmsVariance, 0.1, 'Loudness Variance')}
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3 text-xs text-gray-400">
            <div>Duration: {(a.durationMs / 1000).toFixed(1)}s</div>
            <div>Silence Segments: {a.silenceSegments}</div>
          </div>
        </div>
      )}

      {t && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Turn Timing</h3>
          <div className="space-y-2">
            {bar(t.avgResponseLatencyMs / 6000, 1, 'Avg Response')}
            {bar(t.candidateTalkRatio, 1, 'Your Talk %')}
          </div>
          <div className="text-xs text-gray-400 mt-2 space-y-1">
            {(() => {
              const grade = timingGrade(t.avgResponseLatencyMs);
              return <p>Response Speed: <span className={grade.color}>{grade.label}</span> ({t.avgResponseLatencyMs}ms)</p>;
            })()}
            <p>Max Pause: {t.maxResponseLatencyMs}ms</p>
            <p>Turns: {t.totalCustomerTurns + t.totalCandidateTurns}</p>
          </div>
        </div>
      )}

      {d && d.perSpeakerMetrics && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Speaker Diarization</h3>
          <div className="space-y-1 text-xs text-gray-400">
            {Object.entries(d.perSpeakerMetrics).map(([speaker, metrics]) => (
              <p key={speaker}>{speaker}: {(metrics.talkRatio * 100).toFixed(0)}% talk time, {metrics.segmentCount} segments</p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
