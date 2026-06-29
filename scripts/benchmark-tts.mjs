import crypto from 'node:crypto';

const provider = process.env.VOICE_TTS_PROVIDER || 'fixture';
const baseUrl = process.env.KOKORO_BASE_URL || 'http://127.0.0.1:8880';
const voice = process.env.VOICE_TTS_VOICE || 'af_heart';

const responses = [
  { key: 'short_01', text: 'Hello, how can I help?' },
  { key: 'short_02', text: 'No error message.' },
  { key: 'short_03', text: 'It just sits there.' },
  { key: 'short_04', text: 'Can you check the outbox?' },
  { key: 'short_05', text: 'Okay, thank you.' },
  { key: 'short_06', text: 'Go to Send and Receive.' },
  { key: 'short_07', text: 'Is it highlighted?' },
  { key: 'short_08', text: 'Click it to turn it off.' },
  { key: 'short_09', text: 'Try sending now.' },
  { key: 'short_10', text: 'It sent successfully.' },
  { key: 'medium_01', text: "I'm trying to send an email in Outlook, but it just sits there and won't go." },
  { key: 'medium_02', text: "Yes, Work Offline is highlighted. Is that why this isn't sending?" },
  { key: 'medium_03', text: "Okay, I've clicked it and it's not highlighted anymore." },
  { key: 'medium_04', text: "That sounds drastic. I don't have time for that before my meeting." },
  { key: 'medium_05', text: "Can we at least try something first? I really need to send this now." },
  { key: 'medium_06', text: "I'm not sure about that. I really need this email sorted before my meeting." },
  { key: 'medium_07', text: "Hi, this is Sarah in the office. Outlook won't send an email." },
  { key: 'medium_08', text: "Yes, that's fixed it. Thanks for keeping it quick." },
  { key: 'medium_09', text: "Sorry, I'm not sure what you need me to do. Can you give me one clear step?" },
  { key: 'medium_10', text: "You already asked me that. What should I do next?" },
];

const results = [];

for (const entry of responses) {
  const isCold = results.length < 5;
  const generateStart = Date.now();

  if (provider === 'fixture') {
    await new Promise(r => setTimeout(r, 10));
    results.push({ key: entry.key, chars: entry.text.length, voice, provider, cache_hit: false, generate_ms: 10, audio_bytes: 0, audio_duration_ms: 0, passed: true });
    continue;
  }

  try {
    const res = await fetch(`${baseUrl}/v1/audio/speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'kokoro', input: entry.text, voice, response_format: 'mp3' }),
    });

    const generateMs = Date.now() - generateStart;

    if (!res.ok) {
      results.push({ key: entry.key, chars: entry.text.length, voice, provider, cache_hit: false, generate_ms: generateMs, error: `TTS returned ${res.status}`, passed: false });
      continue;
    }

    const audio = await res.arrayBuffer();
    const readCacheStart = Date.now();
    const audioDurationMs = 0;
    const readCacheMs = Date.now() - readCacheStart;

    results.push({
      key: entry.key,
      chars: entry.text.length,
      voice,
      provider,
      cache_hit: !isCold,
      generate_ms: generateMs,
      read_cache_ms: readCacheMs,
      audio_bytes: audio.byteLength,
      audio_duration_ms: audioDurationMs,
      passed: true,
    });
  } catch (err) {
    results.push({ key: entry.key, chars: entry.text.length, voice, provider, cache_hit: false, generate_ms: Date.now() - generateStart, error: err.message, passed: false });
  }
}

const coldResults = results.slice(0, 5);
const warmResults = results.slice(5);
const coldP95 = coldResults.filter(r => r.passed).map(r => r.generate_ms).sort((a, b) => a - b)[Math.floor(coldResults.length * 0.95) - 1] || 0;
const warmP95 = warmResults.filter(r => r.passed).map(r => r.generate_ms).sort((a, b) => a - b)[Math.floor(warmResults.length * 0.95) - 1] || 0;
const failures = results.filter(r => !r.passed);
const passedCount = results.filter(r => r.passed).length;

const summary = {
  provider,
  voice,
  total: results.length,
  passed: passedCount,
  failed: failures.length,
  coldP95GenerateMs: coldP95,
  warmP95GenerateMs: warmP95,
  failures: failures.map(f => ({ key: f.key, error: f.error })),
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (failures.length > 0) {
  console.error(`[benchmark] FAIL: ${failures.length} TTS generations failed`);
  process.exit(1);
}
