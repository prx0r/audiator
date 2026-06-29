import fs from 'node:fs';
import path from 'node:path';

const provider = process.env.VOICE_STT_PROVIDER || 'fixture';
const fixtureDir = path.resolve(process.cwd(), 'tests/fixtures/stt/outlook-work-offline');
const manifestPath = path.join(fixtureDir, 'manifest.json');

if (!fs.existsSync(manifestPath)) {
  console.log(JSON.stringify({ skipped: true, reason: `Missing ${manifestPath}` }, null, 2));
  process.exit(0);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const results = [];

for (const entry of manifest) {
  const wavPath = path.join(fixtureDir, entry.file);
  if (!fs.existsSync(wavPath)) {
    results.push({ file: entry.file, expectedIntent: entry.expectedIntent, error: 'fixture_not_found', passed: 'skipped' });
    continue;
  }

  const audioBuffer = fs.readFileSync(wavPath);
  const base64Audio = audioBuffer.toString('base64');
  const start = Date.now();

  try {
    const res = await fetch('http://127.0.0.1:3001/api/stt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audioBase64: base64Audio, mimeType: 'audio/wav', durationMs: 0 }),
    });

    const sttMs = Date.now() - start;
    if (!res.ok) {
      results.push({ file: entry.file, expectedIntent: entry.expectedIntent, error: `STT returned ${res.status}`, passed: false, sttMs });
      continue;
    }

    const data = await res.json();
    const normalized = data.text?.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim() || '';
    const expected = entry.expectedText.toLowerCase();
    const intentCorrect = entry.expectedIntent === (data.matchedIntent || '?');
    const wordErrorHint = normalized !== expected ? `got "${normalized}"` : undefined;

    results.push({
      file: entry.file,
      transcript: data.text,
      expectedText: entry.expectedText,
      expectedIntent: entry.expectedIntent,
      matchedIntent: data.matchedIntent || '?',
      intentCorrect,
      wordErrorHint,
      sttMs,
      totalMs: Date.now() - start,
      passed: intentCorrect,
    });
  } catch (err) {
    results.push({ file: entry.file, expectedIntent: entry.expectedIntent, error: err.message, passed: false });
  }
}

const passed = results.filter(r => r.passed === true).length;
const total = results.length;
const accuracy = total > 0 ? Math.round((passed / total) * 100) : 0;
const p95SttMs = (() => {
  const sorted = results.filter(r => r.sttMs != null).map(r => r.sttMs).sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[idx] || 0;
})();

const summary = {
  provider,
  totalFixtures: total,
  passed,
  failed: total - passed,
  intentAccuracy: accuracy,
  p95SttMs,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (accuracy < 75) {
  console.error(`[benchmark] FAIL: intent accuracy ${accuracy}% < 75% threshold`);
  process.exit(1);
}
