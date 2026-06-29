import decodeAudio from 'audio-decode';

export interface AudioSegment {
  startMs: number;
  endMs: number;
  type: 'speech' | 'silence';
  rms: number;
}

export interface AudioAnalysis {
  durationMs: number;
  sampleRate: number;
  channels: number;
  totalSilenceMs: number;
  silenceRatio: number;
  longestSilenceMs: number;
  silenceSegments: number;
  totalTalkMs: number;
  talkRatio: number;
  avgRms: number;
  peakRms: number;
  rmsVariance: number;
  segments: AudioSegment[];
}

const WINDOW_MS = 30;
const SILENCE_THRESHOLD = 0.02;
const MIN_SILENCE_MS = 100;
const MIN_TALK_MS = 50;

function computeRms(samples: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

type DecodedAudio = {
  channelData: Float32Array[];
  sampleRate: number;
};

export async function analyzeAudio(audioData: Uint8Array): Promise<AudioAnalysis> {
  const decoded = await decodeAudio(audioData.buffer as ArrayBuffer) as unknown as DecodedAudio;
  const sampleRate = decoded.sampleRate;
  const channels = decoded.channelData.length;
  const channelData = decoded.channelData[0];
  const totalSamples = channelData.length;
  const windowSamples = Math.floor(sampleRate * WINDOW_MS / 1000);
  const totalDurationMs = (totalSamples / sampleRate) * 1000;

  const segments: AudioSegment[] = [];
  let currentType: 'speech' | 'silence' | null = null;
  let currentStartMs = 0;
  let currentRmsSum = 0;
  let currentRmsCount = 0;
  let allRmsValues: number[] = [];

  const pos = (sampleIndex: number) => (sampleIndex / sampleRate) * 1000;

  for (let i = 0; i < totalSamples; i += windowSamples) {
    const end = Math.min(i + windowSamples, totalSamples);
    const frame = channelData.slice(i, end);
    const rms = computeRms(frame);
    const type = rms >= SILENCE_THRESHOLD ? 'speech' : 'silence';
    allRmsValues.push(rms);

    if (currentType === null) {
      currentType = type;
      currentStartMs = pos(i);
      currentRmsSum = rms;
      currentRmsCount = 1;
    } else if (type !== currentType) {
      const segmentStartMs = currentStartMs;
      const segmentEndMs = pos(i);
      const segmentDurationMs = segmentEndMs - segmentStartMs;
      const minDurationMs = currentType === 'silence' ? MIN_SILENCE_MS : MIN_TALK_MS;

      if (segmentDurationMs >= minDurationMs) {
        segments.push({
          startMs: Math.round(segmentStartMs),
          endMs: Math.round(segmentEndMs),
          type: currentType,
          rms: Math.round((currentRmsSum / currentRmsCount) * 1000) / 1000,
        });
        currentType = type;
        currentStartMs = pos(i);
        currentRmsSum = 0;
        currentRmsCount = 0;
      }
      currentRmsSum += rms;
      currentRmsCount++;
    } else {
      currentRmsSum += rms;
      currentRmsCount++;
    }
  }

  if (currentType !== null) {
    segments.push({
      startMs: Math.round(currentStartMs),
      endMs: Math.round(totalDurationMs),
      type: currentType,
      rms: Math.round((currentRmsSum / currentRmsCount) * 1000) / 1000,
    });
  }

  let totalSilenceMs = 0;
  let longestSilenceMs = 0;
  let silenceSegmentCount = 0;
  let totalTalkMs = 0;

  for (const seg of segments) {
    const dur = seg.endMs - seg.startMs;
    if (seg.type === 'silence') {
      totalSilenceMs += dur;
      longestSilenceMs = Math.max(longestSilenceMs, dur);
      silenceSegmentCount++;
    } else {
      totalTalkMs += dur;
    }
  }

  const avgRms = allRmsValues.length > 0
    ? allRmsValues.reduce((a, b) => a + b, 0) / allRmsValues.length
    : 0;
  const peakRms = allRmsValues.length > 0
    ? Math.max(...allRmsValues)
    : 0;
  const rmsVariance = allRmsValues.length > 0
    ? allRmsValues.reduce((sum, v) => sum + (v - avgRms) ** 2, 0) / allRmsValues.length
    : 0;

  return {
    durationMs: Math.round(totalDurationMs),
    sampleRate,
    channels,
    totalSilenceMs: Math.round(totalSilenceMs),
    silenceRatio: totalDurationMs > 0 ? Math.round((totalSilenceMs / totalDurationMs) * 1000) / 1000 : 0,
    longestSilenceMs: Math.round(longestSilenceMs),
    silenceSegments: silenceSegmentCount,
    totalTalkMs: Math.round(totalTalkMs),
    talkRatio: totalDurationMs > 0 ? Math.round((totalTalkMs / totalDurationMs) * 1000) / 1000 : 0,
    avgRms: Math.round(avgRms * 1000) / 1000,
    peakRms: Math.round(peakRms * 1000) / 1000,
    rmsVariance: Math.round(rmsVariance * 1000) / 1000,
    segments,
  };
}
