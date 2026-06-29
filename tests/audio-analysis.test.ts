import { describe, it, after } from 'node:test';
import assert from 'node:assert';
import { analyzeAudio } from '../lib/audio/analyzer';
import {
  saveRecording,
  getRecordingStream,
  recordingExists,
  deleteRecording,
  listRecordings,
  generateRecordingId,
} from '../lib/audio/recorder';
import fs from 'fs';
import path from 'path';

function generatePcmSamples(durationMs: number, sampleRate = 16000, amplitude = 0): Int16Array {
  const numSamples = Math.floor(sampleRate * durationMs / 1000);
  const samples = new Int16Array(numSamples);
  for (let i = 0; i < numSamples; i++) {
    if (amplitude > 0) {
      const t = i / sampleRate;
      samples[i] = Math.round(32767 * amplitude * Math.sin(2 * Math.PI * 440 * t));
    } else {
      samples[i] = 0;
    }
  }
  return samples;
}

function wrapInWav(samples: Int16Array, sampleRate = 16000): Uint8Array {
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = samples.length * blockAlign;
  const fileSize = 44 + dataSize;

  const buffer = Buffer.alloc(fileSize);
  let offset = 0;

  const write = (str: string) => { buffer.write(str, offset); offset += str.length; };
  const writeU16 = (v: number) => { offset = buffer.writeUInt16LE(v, offset); };
  const writeU32 = (v: number) => { offset = buffer.writeUInt32LE(v, offset); };

  write('RIFF');
  writeU32(fileSize - 8);
  write('WAVE');
  write('fmt ');
  writeU32(16);
  writeU16(1);
  writeU16(numChannels);
  writeU32(sampleRate);
  writeU32(byteRate);
  writeU16(blockAlign);
  writeU16(bitsPerSample);
  write('data');
  writeU32(dataSize);

  for (let i = 0; i < samples.length; i++) {
    buffer.writeInt16LE(samples[i], offset);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

function generateToneWav(durationMs: number, sampleRate = 16000): Uint8Array {
  return wrapInWav(generatePcmSamples(durationMs, sampleRate, 0.5), sampleRate);
}

function generateSilenceWav(durationMs: number, sampleRate = 16000): Uint8Array {
  return wrapInWav(generatePcmSamples(durationMs, sampleRate, 0), sampleRate);
}

describe('Audio Analyzer', () => {

  it('analyzes a tone recording (speech-like)', async () => {
    const wav = generateToneWav(2000);
    const analysis = await analyzeAudio(wav);

    assert.ok(analysis.durationMs >= 1900 && analysis.durationMs <= 2100, `duration ${analysis.durationMs}ms should be ~2000ms`);
    assert.equal(analysis.sampleRate, 16000);
    assert.equal(analysis.channels, 1);
    assert.ok(analysis.talkRatio > 0.8, `talkRatio ${analysis.talkRatio} should be high for tone`);
    assert.ok(analysis.silenceRatio < 0.2, `silenceRatio ${analysis.silenceRatio} should be low for tone`);
    assert.ok(analysis.totalTalkMs > 1500, `talk time ${analysis.totalTalkMs}ms should be most of 2000ms`);
    assert.ok(analysis.avgRms > 0, 'avgRms should be > 0 for tone');
    assert.ok(analysis.peakRms > 0, 'peakRms should be > 0 for tone');
    assert.ok(analysis.segments.length >= 1, 'should have at least 1 segment');
  });

  it('analyzes a silent recording', async () => {
    const wav = generateSilenceWav(1000);
    const analysis = await analyzeAudio(wav);

    assert.ok(analysis.durationMs >= 900 && analysis.durationMs <= 1100);
    assert.ok(analysis.silenceRatio > 0.8, `silenceRatio ${analysis.silenceRatio} should be high for silence`);
    assert.ok(analysis.talkRatio < 0.2);
    assert.ok(analysis.avgRms < 0.01, 'avgRms should be ~0 for silence');
    assert.ok(analysis.peakRms < 0.01, 'peakRms should be ~0 for silence');
  });

  it('detects alternating speech and silence segments', async () => {
    const toneSamples = generatePcmSamples(500, 16000, 0.5);
    const silenceSamples = generatePcmSamples(300, 16000, 0);
    const combinedSamples = new Int16Array(toneSamples.length + silenceSamples.length + toneSamples.length);
    combinedSamples.set(toneSamples, 0);
    combinedSamples.set(silenceSamples, toneSamples.length);
    combinedSamples.set(toneSamples, toneSamples.length + silenceSamples.length);
    const wav = wrapInWav(combinedSamples);

    const analysis = await analyzeAudio(wav);

    assert.ok(analysis.durationMs >= 1000 && analysis.durationMs <= 1600, `duration ${analysis.durationMs}ms`);
    assert.ok(analysis.silenceSegments >= 1, `should detect at least 1 silence segment, got ${analysis.silenceSegments}`);
    assert.ok(analysis.segments.length >= 3, `should have alternating segments, got ${analysis.segments.length}`);
    assert.ok(analysis.longestSilenceMs >= 200, `longest silence should be ~300ms, got ${analysis.longestSilenceMs}ms`);
  });

  it('rejects empty audio data', async () => {
    await assert.rejects(
      () => analyzeAudio(new Uint8Array(0)),
    );
  });

});

describe('Audio Recorder', () => {

  const testSession = 'test-session-recorder';

  after(() => {
    const recordings = listRecordings(testSession);
    for (const r of recordings) {
      const fileName = r.fileName;
      const id = fileName.replace(`${testSession}-`, '').replace('.webm', '');
      deleteRecording(testSession, id);
    }
  });

  it('saves and retrieves a recording', () => {
    const audioData = Buffer.from('fake audio data');
    const info = saveRecording(audioData, testSession, 5000);

    assert.ok(info.id.length > 0, 'generated ID');
    assert.equal(info.sessionId, testSession);
    assert.equal(info.durationMs, 5000);
    assert.ok(info.sizeBytes > 0);
    assert.ok(fs.existsSync(info.filePath), 'file exists on disk');
    assert.ok(recordingExists(testSession, info.id), 'recordingExists returns true');
  });

  it('returns null stream for missing recording', () => {
    const stream = getRecordingStream(testSession, 'nonexistent');
    assert.equal(stream, null);
  });

  it('deletes a recording', () => {
    const audioData = Buffer.from('fake audio data');
    const info = saveRecording(audioData, testSession, 1000);

    assert.ok(recordingExists(testSession, info.id));

    const deleted = deleteRecording(testSession, info.id);
    assert.ok(deleted);
    assert.ok(!recordingExists(testSession, info.id));
  });

  it('returns false when deleting nonexistent recording', () => {
    const result = deleteRecording(testSession, 'nonexistent');
    assert.equal(result, false);
  });

  it('lists recordings for a session', () => {
    saveRecording(Buffer.from('data1'), testSession, 1000);
    saveRecording(Buffer.from('data2'), testSession, 2000);

    const list = listRecordings(testSession);
    assert.ok(list.length >= 2);
    assert.ok(list.every(r => r.sessionId === testSession));
    assert.ok(list.some(r => r.sizeBytes === 'data1'.length));
    assert.ok(list.some(r => r.sizeBytes === 'data2'.length));
  });

  it('returns empty list for unknown session', () => {
    const list = listRecordings('nonexistent-session');
    assert.deepEqual(list, []);
  });

});

describe('generateRecordingId', () => {

  it('generates unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateRecordingId());
    }
    assert.equal(ids.size, 100);
  });

});
