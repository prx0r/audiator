import path from 'path';
import fs from 'fs';

const MODELS_DIR = path.resolve(process.cwd(), 'data', 'models');

export interface SpeakerSegment {
  startMs: number;
  endMs: number;
  speaker: string;
  confidence: number;
}

export interface DiarizationResult {
  segments: SpeakerSegment[];
  numSpeakers: number;
  speakerLabels: string[];
  perSpeakerMetrics: Record<string, {
    totalTalkMs: number;
    talkRatio: number;
    segmentCount: number;
  }>;
}

interface SherpaSegment {
  start: number;
  end: number;
  speaker: string;
}

function getModelPaths(): { segmentation: string; embedding: string } | null {
  const segDir = path.join(MODELS_DIR, 'sherpa-onnx-pyannote-segmentation-3-0');
  const segModel = path.join(segDir, 'model.onnx');
  const embModel = path.join(MODELS_DIR, '3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx');

  if (!fs.existsSync(segModel) || !fs.existsSync(embModel)) {
    return null;
  }
  return { segmentation: segModel, embedding: embModel };
}

let diarizerInstance: any = null;
let diarizerSampleRate = 16000;

function getOrCreateDiarizer(): { instance: any; sampleRate: number } | null {
  if (diarizerInstance) {
    return { instance: diarizerInstance, sampleRate: diarizerSampleRate };
  }

  const modelPaths = getModelPaths();
  if (!modelPaths) {
    return null;
  }

  try {
    const sherpa = require('sherpa-onnx-node');
    const config = {
      segmentation: {
        pyannote: {
          model: modelPaths.segmentation,
        },
      },
      embedding: {
        model: modelPaths.embedding,
      },
      clustering: {
        numClusters: -1,
        threshold: 0.5,
      },
      minDurationOn: 0.2,
      minDurationOff: 0.5,
    };

    diarizerInstance = new sherpa.OfflineSpeakerDiarization(config);
    diarizerSampleRate = diarizerInstance.sampleRate;
    return { instance: diarizerInstance, sampleRate: diarizerSampleRate };
  } catch (err) {
    console.warn('[Diarizer] Failed to initialize sherpa-onnx:', err);
    return null;
  }
}

export function diarizationAvailable(): boolean {
  return getModelPaths() !== null;
}

export async function runDiarization(
  audioData: Uint8Array,
  sampleRate: number,
): Promise<DiarizationResult | null> {
  const diarizer = getOrCreateDiarizer();
  if (!diarizer) {
    return null;
  }

  try {
    const sherpa = require('sherpa-onnx-node');

    let samples: Float32Array;

    if (sampleRate === diarizer.sampleRate) {
      const pcm16 = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.byteLength / 2);
      samples = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        samples[i] = pcm16[i] / 32768;
      }
    } else {
      const resampler = new sherpa.LinearResampler(sampleRate, diarizer.sampleRate, 1);
      const pcm16 = new Int16Array(audioData.buffer, audioData.byteOffset, audioData.byteLength / 2);
      const floatIn = new Float32Array(pcm16.length);
      for (let i = 0; i < pcm16.length; i++) {
        floatIn[i] = pcm16[i] / 32768;
      }
      samples = resampler.resample(floatIn, 1) as Float32Array;
    }

    const rawSegments: SherpaSegment[] = diarizer.instance.process(samples);

    if (!rawSegments || rawSegments.length === 0) {
      return {
        segments: [],
        numSpeakers: 0,
        speakerLabels: [],
        perSpeakerMetrics: {},
      };
    }

    const uniqueSpeakers = [...new Set(rawSegments.map(s => s.speaker))].sort();

    const labeledSegments: SpeakerSegment[] = rawSegments.map(s => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      speaker: s.speaker,
      confidence: 1.0,
    }));

    const speakerLabels: Record<string, string> = {};
    uniqueSpeakers.forEach((sp, i) => {
      speakerLabels[sp] = i === 0 ? 'customer' : 'candidate';
    });

    const segments = labeledSegments.map(s => ({
      ...s,
      speaker: speakerLabels[s.speaker] || s.speaker,
    }));

    const perSpeakerMetrics: Record<string, { totalTalkMs: number; talkRatio: number; segmentCount: number }> = {};
    const totalDurationMs = segments.length > 0
      ? segments[segments.length - 1].endMs - segments[0].startMs
      : 0;

    for (const sp of uniqueSpeakers) {
      const label = speakerLabels[sp] || sp;
      const spSegments = segments.filter(s => s.speaker === label);
      const totalTalkMs = spSegments.reduce((sum, s) => sum + (s.endMs - s.startMs), 0);
      perSpeakerMetrics[label] = {
        totalTalkMs,
        talkRatio: totalDurationMs > 0 ? Math.round((totalTalkMs / totalDurationMs) * 1000) / 1000 : 0,
        segmentCount: spSegments.length,
      };
    }

    return {
      segments,
      numSpeakers: uniqueSpeakers.length,
      speakerLabels: uniqueSpeakers.map(sp => speakerLabels[sp] || sp),
      perSpeakerMetrics,
    };
  } catch (err) {
    console.warn('[Diarizer] Processing failed:', err);
    return null;
  }
}
