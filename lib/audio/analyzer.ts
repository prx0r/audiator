import decodeAudio from 'audio-decode';
import fs from 'fs';

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

function runRmsAnalysis(channelData: Float32Array, sampleRate: number): AudioAnalysis {
  const totalSamples = channelData.length;
  const windowSamples = Math.floor(sampleRate * WINDOW_MS / 1000);
  const totalDurationMs = totalSamples > 0 ? (totalSamples / sampleRate) * 1000 : 0;

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
    channels: 1,
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

export function parseWav(buffer: Buffer): DecodedAudio {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const numChannels = view.getUint16(22, true);

  let dataOffset = 44;
  let dataSize = view.getUint32(40, true);
  if (buffer.slice(36, 40).toString() !== 'data') {
    let pos = 12;
    while (pos < buffer.length - 8) {
      const chunkSize = view.getUint32(pos + 4, true);
      if (buffer.slice(pos, pos + 4).toString() === 'data') {
        dataOffset = pos + 8;
        dataSize = chunkSize;
        break;
      }
      pos += 8 + chunkSize;
    }
  }

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const samplesPerChannel = Math.floor(totalSamples / numChannels);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(new Float32Array(samplesPerChannel));
  }

  for (let i = 0; i < totalSamples; i++) {
    const byteOffset = dataOffset + i * bytesPerSample;
    let sample: number;
    if (bitsPerSample === 16) {
      sample = view.getInt16(byteOffset, true) / 32768;
    } else if (bitsPerSample === 32) {
      sample = view.getInt32(byteOffset, true) / 2147483648;
    } else if (bitsPerSample === 8) {
      sample = (view.getUint8(byteOffset) - 128) / 128;
    } else if (bitsPerSample === 24) {
      const val = view.getUint8(byteOffset) | (view.getUint8(byteOffset + 1) << 8) | (view.getUint8(byteOffset + 2) << 16);
      sample = (val >> 7) & 1 ? (val | 0xff000000) / 8388608 : val / 8388608;
    } else {
      sample = 0;
    }
    const ch = i % numChannels;
    const idx = Math.floor(i / numChannels);
    channelData[ch][idx] = sample;
  }

  return { channelData, sampleRate };
}

export async function analyzeAudio(audioData: Uint8Array): Promise<AudioAnalysis> {
  const decoded = await decodeAudio(audioData.buffer as ArrayBuffer) as unknown as DecodedAudio;
  return runRmsAnalysis(decoded.channelData[0], decoded.sampleRate);
}

export async function analyzeWavFile(wavPath: string): Promise<AudioAnalysis> {
  const buffer = fs.readFileSync(wavPath);
  const decoded = await decodeAudio(buffer.buffer as ArrayBuffer) as unknown as DecodedAudio;
  return runRmsAnalysis(decoded.channelData[0], decoded.sampleRate);
}
