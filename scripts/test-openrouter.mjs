/**
 * Quick test to verify OpenRouter API connectivity for STT + TTS.
 * Usage: OPENROUTER_API_KEY=sk-xxx node scripts/test-openrouter.mjs
 */

const API_KEY = process.env.OPENROUTER_API_KEY;

if (!API_KEY) {
  console.error('Error: OPENROUTER_API_KEY environment variable is required');
  console.error('Usage: OPENROUTER_API_KEY=sk-xxx node scripts/test-openrouter.mjs');
  process.exit(1);
}

async function testTTS() {
  console.log('\n\u23f3  Testing OpenRouter TTS (Kokoro-82m)...');

  const response = await fetch('https://openrouter.ai/api/v1/audio/speech', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'hexgrad/kokoro-82m',
      input: 'Hello, this is a test of the audiator TTS engine. The quick brown fox jumps over the lazy dog.',
      voice: 'af_heart',
      response_format: 'mp3',
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TTS failed (${response.status}): ${text}`);
  }

  const audio = await response.arrayBuffer();
  console.log(`\u2705  TTS works! Received ${(audio.byteLength / 1024).toFixed(1)}KB of MP3 audio`);
}

async function testChat() {
  console.log('\n\u23f3  Testing OpenRouter Chat (GPT-4o-mini)...');

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'openai/gpt-4o-mini',
      messages: [
        { role: 'system', content: 'You are a customer calling IT support. Respond in one sentence.' },
        { role: 'user', content: 'Hi, my computer is not working.' },
      ],
      max_tokens: 50,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Chat failed (${response.status}): ${text}`);
  }

  const data = await response.json();
  const reply = data.choices?.[0]?.message?.content || '';
  console.log(`\u2705  Chat works! Response: "${reply}"`);
}

async function main() {
  console.log('=== OpenRouter Connectivity Test ===\n');

  try {
    await testTTS();
  } catch (err) {
    console.error(`\u274c  TTS test failed:`, err.message);
  }

  try {
    await testChat();
  } catch (err) {
    console.error(`\u274c  Chat test failed:`, err.message);
  }

  console.log('\n=== Done ===');
}

main().catch(e => { console.error(e); process.exit(1); });
