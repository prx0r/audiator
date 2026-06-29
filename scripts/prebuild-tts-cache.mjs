import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const outputDir = process.env.CALLCALLUM_AUDIO_CACHE_DIR
  ? path.resolve(process.cwd(), process.env.CALLCALLUM_AUDIO_CACHE_DIR)
  : path.resolve(process.cwd(), 'data', 'tts-cache');

const voice = process.env.VOICE_TTS_VOICE || 'af_heart';
const scenarioId = 'outlook-work-offline';

const responses = [
  // opening
  { key: 'opening_rushed', text: "Hi, this is Sarah in the office. Outlook won't send an email and I need it gone before my meeting." },
  // identity
  { key: 'identity_sarah', text: "It's Sarah Mitchell, office manager." },
  // problem summary
  { key: 'summary_outlook_wont_send', text: "I'm trying to send an email in Outlook, but it just sits there and won't go." },
  // error message
  { key: 'no_error_message', text: "No error message. It just stays in the outbox." },
  // outbox
  { key: 'email_in_outbox', text: "Yes, it's sitting in the Outbox." },
  // internet
  { key: 'internet_works', text: 'Yes, the internet is working. I can open websites.' },
  // webmail
  { key: 'webmail_works', text: 'Webmail loads fine, so it seems to be Outlook.' },
  // send receive
  { key: 'send_receive_open', text: "Okay, I'm on Send and Receive now." },
  // work offline
  { key: 'work_offline_is_on', text: "Yes, Work Offline is highlighted. Is that why this isn't sending?" },
  // disable
  { key: 'disabled_work_offline', text: "Okay, I've clicked it and it's not highlighted anymore." },
  // test email
  { key: 'test_email_sent', text: 'It sent. That email has gone now.' },
  // resolution
  { key: 'confirmed_resolved', text: "Yes, that's fixed it. Thanks for keeping it quick." },
  // empathy
  { key: 'acknowledge_empathy', text: 'Thanks, I appreciate that. I just need it sorted quickly.' },
  // bad paths
  { key: 'reinstall_pushback', text: "That sounds drastic. I don't have time for that before my meeting." },
  { key: 'early_escalation_pushback', text: "Can we at least try something first? I really need to send this now." },
  { key: 'redirect_bizarre', text: "I'm not sure about that. I really need this email sorted before my meeting." },
  { key: 'clarify_needed', text: "Sorry, I'm not sure what you need me to do. Can you give me one clear step?" },
  // interruptions
  { key: 'interrupt_silence', text: 'Hello? Are you still there?' },
  { key: 'interrupt_wrong_path', text: "I don't really have time for that. I just need this email sent." },
  { key: 'interrupt_jargon', text: "I don't know what that means. Can you just tell me what to click?" },
  { key: 'interrupt_bizarre', text: "I'm not sure about that. I really need this sorting." },
  { key: 'interrupt_repeated', text: 'You already asked me that. What should I do next?' },
];

function cachePath(text, voice, format) {
  const hash = crypto.createHash('sha1').update(`${voice}\n${format}\n${text}`).digest('hex');
  return path.join(outputDir, `${voice}-${hash}.${format}`);
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });

  const format = 'mp3';
  const generated = [];
  const skipped = [];

  for (const { key, text } of responses) {
    const filePath = cachePath(text, voice, format);
    if (fs.existsSync(filePath)) {
      skipped.push({ key, file: path.basename(filePath) });
      continue;
    }

    const keyBase = [scenarioId, voice, key, crypto.createHash('sha1').update(text).digest('hex').slice(0, 12), format].join('__').replace(/[^a-zA-Z0-9_.-]+/g, '_');
    const keyPath = path.join(outputDir, keyBase);

    if (fs.existsSync(keyPath)) {
      skipped.push({ key, file: keyBase, at: keyPath });
      continue;
    }

    const kokoroUrl = process.env.KOKORO_BASE_URL || 'http://127.0.0.1:8880';
    console.log(`[prebuild] Generating: ${key}`);

    try {
      const res = await fetch(`${kokoroUrl}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'kokoro', input: text, voice, response_format: format }),
      });
      if (!res.ok) throw new Error(`Kokoro returned ${res.status}`);

      const audio = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(keyPath, audio);
      generated.push({ key, file: keyBase, bytes: audio.length });
    } catch (err) {
      console.error(`[prebuild] Failed to generate ${key}:`, err.message);
      fs.writeFileSync(keyPath, Buffer.alloc(0));
      skipped.push({ key, reason: `generation_failed: ${err.message}` });
    }
  }

  const report = { voice, format, outputDir, total: responses.length, generated: generated.length, skipped: skipped.length, generated, skipped };
  fs.writeFileSync(path.join(outputDir, 'prebuild-report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('[prebuild] Fatal:', err.message);
  process.exit(1);
});
