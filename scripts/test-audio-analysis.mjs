import decodeAudio from 'audio-decode';
import fs from 'fs';
import path from 'path';

const SAMPLE_RATE = 16000;
const RECORDINGS_DIR = path.resolve(process.cwd(), 'data', 'recordings');

function generatePcmSamples(durationMs, amplitude = 0, freq = 440) {
  const numSamples = Math.floor(SAMPLE_RATE * durationMs / 1000);
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    if (amplitude > 0) {
      const t = i / SAMPLE_RATE;
      samples[i] = Math.round(32767 * amplitude * Math.sin(2 * Math.PI * freq * t));
    } else {
      samples[i] = 0;
    }
  }
  return samples;
}

function wrapInWav(samples) {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = SAMPLE_RATE * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;
  const w = (s) => { buffer.write(s, offset); offset += s.length; };
  const w16 = (v) => { offset = buffer.writeUInt16LE(v, offset); };
  const w32 = (v) => { offset = buffer.writeUInt32LE(v, offset); };

  w('RIFF'); w32(fileSize - 8); w('WAVE');
  w('fmt '); w32(16); w16(1); w16(numChannels);
  w32(SAMPLE_RATE); w32(byteRate); w16(blockAlign); w16(bitsPerSample);
  w('data'); w32(dataSize);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], offset);
    offset += 2;
  }
  return new Uint8Array(buffer);
}

const turns = [
  { speaker: 'ai', durationMs: 2500, amplitude: 0.3, freq: 300 },
  { speaker: 'pause', durationMs: 400, amplitude: 0, freq: 0 },
  { speaker: 'candidate', durationMs: 1800, amplitude: 0.35, freq: 500 },
  { speaker: 'pause', durationMs: 200, amplitude: 0, freq: 0 },
  { speaker: 'ai', durationMs: 3500, amplitude: 0.3, freq: 300 },
  { speaker: 'pause', durationMs: 800, amplitude: 0, freq: 0 },
  { speaker: 'candidate', durationMs: 2200, amplitude: 0.35, freq: 500 },
  { speaker: 'pause', durationMs: 150, amplitude: 0, freq: 0 },
  { speaker: 'ai', durationMs: 2800, amplitude: 0.3, freq: 300 },
  { speaker: 'pause', durationMs: 1200, amplitude: 0, freq: 0 },
  { speaker: 'candidate', durationMs: 1500, amplitude: 0.3, freq: 500 },
  { speaker: 'pause', durationMs: 300, amplitude: 0, freq: 0 },
  { speaker: 'ai', durationMs: 2000, amplitude: 0.35, freq: 300 },
  { speaker: 'pause', durationMs: 100, amplitude: 0, freq: 0 },
  { speaker: 'candidate', durationMs: 3000, amplitude: 0.4, freq: 500 },
  { speaker: 'pause', durationMs: 500, amplitude: 0, freq: 0 },
  { speaker: 'ai', durationMs: 2000, amplitude: 0.25, freq: 300 },
  { speaker: 'pause', durationMs: 600, amplitude: 0, freq: 0 },
  { speaker: 'candidate', durationMs: 1500, amplitude: 0.35, freq: 500 },
  { speaker: 'pause', durationMs: 50, amplitude: 0, freq: 0 },
  { speaker: 'ai', durationMs: 1000, amplitude: 0.25, freq: 300 },
];

let totalSamples = turns.reduce((sum, t) => sum + Math.floor(SAMPLE_RATE * t.durationMs / 1000), 0);
const combined = new Int16Array(totalSamples);
let offset2 = 0;

const turnLog = [];
for (const t of turns) {
  const samples = generatePcmSamples(t.durationMs, t.amplitude, t.freq);
  combined.set(samples, offset2);
  turnLog.push({
    speaker: t.speaker,
    startMs: Math.round((offset2 / SAMPLE_RATE) * 1000),
    endMs: Math.round(((offset2 + samples.length) / SAMPLE_RATE) * 1000),
    durationMs: t.durationMs,
  });
  offset2 += samples.length;
}

const wav = wrapInWav(combined);
const totalDurationMs = Math.round((totalSamples / SAMPLE_RATE) * 1000);

fs.mkdirSync(RECORDINGS_DIR, { recursive: true });
const outPath = path.join(RECORDINGS_DIR, `simulated-call-${Date.now()}.wav`);
fs.writeFileSync(outPath, Buffer.from(wav));
console.log(`\nSaved simulated call to: ${outPath}`);
console.log(`Duration: ${totalDurationMs}ms (${(totalDurationMs / 1000).toFixed(1)}s)`);

async function main() {
  const { analyzeAudio } = await import('../lib/audio/analyzer.ts');

  console.log('\n=== SIMULATED CALL METRICS ===\n');

  const analysis = await analyzeAudio(wav);
  console.log(`Duration:        ${analysis.durationMs}ms`);
  console.log(`Silence ratio:   ${(analysis.silenceRatio * 100).toFixed(1)}%`);
  console.log(`Talk ratio:      ${(analysis.talkRatio * 100).toFixed(1)}%`);
  console.log(`Longest silence: ${analysis.longestSilenceMs}ms`);
  console.log(`Silence segs:    ${analysis.silenceSegments} (estimated turns)`);
  console.log(`Avg RMS:         ${analysis.avgRms.toFixed(3)}`);
  console.log(`Peak RMS:        ${analysis.peakRms.toFixed(3)}`);
  console.log(`RMS variance:    ${analysis.rmsVariance.toFixed(3)}`);
  console.log(`\nSegments detected: ${analysis.segments.length}`);
  console.log('  TYPE      START    END      DURATION  RMS');
  analysis.segments.forEach(s => {
    const d = s.endMs - s.startMs;
    console.log(`  ${s.type.padEnd(8)} ${String(s.startMs).padStart(6)} ${String(s.endMs).padStart(6)} ${String(d).padStart(6)}ms ${s.rms.toFixed(3)}`);
  });

  console.log('\n=== GROUND TRUTH vs ANALYSIS ===\n');

  const aiTalkMs = turnLog.filter(t => t.speaker === 'ai').reduce((s, t) => s + t.durationMs, 0);
  const candidateTalkMs = turnLog.filter(t => t.speaker === 'candidate').reduce((s, t) => s + t.durationMs, 0);
  const pauseMs = turnLog.filter(t => t.speaker === 'pause').reduce((s, t) => s + t.durationMs, 0);
  const totalMs = totalDurationMs;

  console.log('GROUND TRUTH (from turn simulation):');
  console.log(`  AI talk:        ${aiTalkMs}ms (${(aiTalkMs/totalMs*100).toFixed(1)}%)`);
  console.log(`  Candidate talk: ${candidateTalkMs}ms (${(candidateTalkMs/totalMs*100).toFixed(1)}%)`);
  console.log(`  Silence/pause:  ${pauseMs}ms (${(pauseMs/totalMs*100).toFixed(1)}%)`);

  console.log('\nANALYSIS RESULT:');
  console.log(`  Talk ratio:     ${(analysis.talkRatio * 100).toFixed(1)}%`);
  console.log(`  Silence ratio:  ${(analysis.silenceRatio * 100).toFixed(1)}%`);
  console.log(`  Silence segs:   ${analysis.silenceSegments}`);

  if (Math.abs(pauseMs/totalMs - analysis.silenceRatio) < 0.15) {
    console.log('\n\u2705 ANALYSIS MATCHES GROUND TRUTH (within tolerance)');
  } else {
    console.log(`\n\u26a0\ufe0f  ANALYSIS DEVIATES: expected silence ${(pauseMs/totalMs*100).toFixed(1)}%, got ${(analysis.silenceRatio*100).toFixed(1)}%`);
  }

  console.log('\n=== WHAT SPEAKER DIARIZATION WOULD ADD ===\n');
  console.log('Current VAD detects speech/silence but cannot tell WHO is speaking.');
  console.log('With sherpa-onnx-node speaker diarization:');
  console.log('  \u2192 Each segment labeled "ai" or "candidate"');
  console.log('  \u2192 Per-speaker talk ratio (not just combined)');
  console.log('  \u2192 Interruption detection (overlapping speech)');
  console.log('  \u2192 Separate acoustic profiles per speaker');
}

main().catch(e => { console.error(e); process.exit(1); });
