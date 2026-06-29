# Recent Work — Audiator

## openSMILE eGeMAPS Integration

**Script:** `scripts/extract-egemaps.py`
- Python wrapper around `opensmile` package (v2.6.0 installed via pip)
- Accepts WAV path, outputs 88 eGeMAPS feature values as JSON
- Features: loudness, pitch/F0, jitter, shimmer, MFCCs, spectral flux, formant amplitudes, alpha ratio

**Node wrapper:** `lib/audio/opensmile.ts`
- `extractOpenSmileFeatures(wavPath)` — spawns Python script, parses JSON result
- `wavFromRecording(recordingPath)` — converts webm → 16kHz mono WAV via ffmpeg
- `opensmileAvailable()` — check if openSMILE is importable

**Integration:** `app/api/recording/route.ts`
- After upload, converts webm to WAV, then calls openSMILE extraction
- Results stored in `analysis_json.opensmile` in SQLite
- OpenSMILE errors are non-fatal (logged as warnings)

## MP3 Recording & Replay

**Server-side conversion:** `app/api/recording/route.ts`
- After webm save, runs ffmpeg to produce MP3 (`-codec:a libmp3lame -b:a 64k -ar 22050 -ac 1`)
- MP3 stored alongside webm: `data/recordings/{sessionId}-{id}.mp3`
- GET endpoint supports `?format=mp3` → returns `audio/mpeg`

**Session API:** `app/api/session/route.ts`
- Returns `mp3Url` field with link to MP3 recording

**Analysis page:** `app/analysis/[id]/page.tsx`
- `<audio controls>` player renders when `mp3Url` is available

**Metrics panel:** `components/MetricsPanel.tsx`
- Displays openSMILE features in a grid (first 24 visible, expandable)

## End Call Flow Fix

**Problem:** Race condition — "End Call" navigated to analysis page before recording upload completed.

**Fix:** `components/VoiceChat.tsx` + `components/VoiceRecorderButton.tsx`
- `navigationPendingRef` set when user presses End Call
- `onFlushComplete` callback fires after recording upload finishes
- When both navigation is pending AND upload is complete → navigate immediately
- 6-second fallback timeout if upload never completes

## LLM Provider Switch: OpenCode Go API

**Changed:** `.env.local`
- Removed `OPENROUTER_API_KEY`
- Set `AI_BASE_URL=https://opencode.ai/zen/go/v1`
- Set `AI_API_KEY=sk-...` (opencodego key)
- Set `AI_MODEL=deepseek-v4-flash` (note: no `deepseek/` prefix — opencodego model naming)

**Changed:** `lib/mvp/sim-graph/llm-matcher.ts`
- Prioritizes OpenCode Go API over OpenRouter
- Uses `AI_MODEL` env var with fallback `deepseek-v4-flash`

**Changed:** `lib/mvp/analysis/call-assessment.ts`
- Same pattern — OpenCode Go first, OpenRouter fallback (removed)
- Updated model name fallback

**Verified:** Direct API call to opencodego works:
```
POST https://opencode.ai/zen/go/v1/chat/completions
{"model":"deepseek-v4-flash","messages":[...]}
```
Available models include: `deepseek-v4-flash`, `deepseek-v4-pro`, `qwen3.7-max`, `kimi-k2.7-code`, `minimax-m3`, `glm-5.2`, etc.

## Running the Server with Cloudflare Tunnel

```bash
# 1. Start dev server
npx next dev -H 127.0.0.1 -p 3002

# 2. In another terminal, create tunnel
cloudflared tunnel --url http://127.0.0.1:3002

# 3. Copy the https://*.trycloudflare.com URL from the output
```

## Full Pipeline Test (verified via curl)

| Step | Status |
|------|--------|
| Session creation | ✅ |
| Chat with OpenCode Go DeepSeek | ✅ Intent matched |
| WebM upload | ✅ Processed through all stages |
| openSMILE 88 eGeMAPS features | ✅ |
| Turn timeline | ✅ |
| LLM assessment | ✅ |
| MP3 conversion & serving | ✅ 200, audio/mpeg |
| Analysis page | ✅ 200 with player + metrics |

## Scrapped Graph/Intent System → Raw DeepSeek Customer

**Problem:** The old system used a keyword/TF-IDF/LLM intent matcher against a predefined scenario graph with nodes, preconditions, state transitions, and template responses. This was overcomplicated, fragile, and didn't leverage the LLM's ability to roleplay.

**Solution:** Replaced the entire graph/intent matching system with a direct DeepSeek prompt that tells the model to act as a specific customer persona. Based on CX-Train's hiring pack format.

**New files:**

| File | Purpose |
|------|---------|
| `lib/mvp/sim-graph/customer-personas.ts` | Customer persona definitions (name, company, role, issue, hidden facts, temperament) — 4 scenarios: Outlook, VPN, Printer, Phishing |
| `lib/mvp/sim-graph/ai-customer.ts` | Builds the system prompt from a persona + prior facts, calls DeepSeek with `response_format: json_object`, returns `{reply, pressure, issueResolved, evidenceTags, scoreSignals}` |

**Simplified files:**

| File | What changed |
|------|-------------|
| `lib/mvp/sim-graph/types.ts` | Stripped `ScenarioGraph`, `ScenarioNode`, `ScenarioState`, `IntentMatch`, `CustomerProfile`, `CustomerResponseVariant`. Kept only `CustomerDecision` and `RouteEvent` |
| `lib/mvp/sim-graph/runtime.ts` | Replaced graph traversal with direct `getAiCustomerResponse()` call. No more `matchIntent`, `selectResponse`, `applyPressure` |
| `app/api/chat/route.ts` | Now accepts `history` array in request body, passes it to `runScenarioTurn` |
| `app/api/recording/route.ts` | Updated route event extraction to use new `pressureBefore`/`pressureAfter` fields |
| `app/api/session/route.ts` | Now parses `payload_json` and `analysis_json` from JSON strings before returning |
| `app/analysis/[id]/page.tsx` | Updated route event rendering to use simplified format |
| `lib/mvp/analysis/call-assessment.ts` | Updated `AssessmentInput` and route summary to use new field names |

**Deleted files (old graph system):**

- `lib/mvp/sim-graph/customer-profile.ts`, `delivery-templates.ts`, `embedding-matcher.ts`, `llm-matcher.ts`, `match-intent.ts`, `outlook-work-offline.ts`, `latency.ts`
- `tests/sim-graph.*.test.ts`, `tests/voice.latency.test.ts`

**Key finding about OpenCode Go API:**
- Model name is `deepseek-v4-flash` (no `deepseek/` prefix — differs from OpenRouter)
- `response_format: { type: 'json_object' }` is supported
- DeepSeek uses `reasoning_content` field for chain-of-thought before the actual reply in `content`
- Need `max_tokens: 1000` (not 200) because reasoning tokens consume budget before the reply |

## Continuous Recording (Single Stream)

**Problem:** Old code had two `getUserMedia` calls (continuous recorder + push-to-talk) causing silent capture. Timeslice chunks were invalid as standalone WebM files for STT.

**Fix:** `components/VoiceChat.tsx`
- Two separate `MediaRecorder` instances, each with its own `getUserMedia` stream:
  - **Continuous recorder** (no timeslice): starts at Start Call, stops at End Call. Fires one `ondataavailable` on stop with entire call (speech + silence). Uploaded to `/api/recording`.
  - **Utterance recorder** (no timeslice): auto-started via `setOnTtsEnd` when AI finishes speaking. User clicks "Stop" to end. Each utterance is a complete valid WebM file sent to `/api/stt`.
- Replaced VoiceRecorderButton with inline toggle button
- `openingTimeoutRef` clears the 500ms Sarah opening message timeout on End Call (fixes duplicate opening message bug)
- Proper cleanup of both recorders and streams on unmount

## Click-to-Talk + Auto Record

- Removed push-to-talk (hold-to-talk) from VoiceRecorderButton entirely
- **Auto-record:** When AI customer finishes speaking (TTS end callback via `setOnTtsEnd`), `startUtterance()` fires automatically
- User clicks "Stop" button → utterance blob assembled → sent to `/api/stt` → chat API → TTS reply → auto-record again
- "Stop" button is never disabled (user can always stop); "Start" is disabled during loading
- `duration_ms` now uses actual call duration (`Date.now() - callStartRef.current`)

## WAV-Based Audio Analysis (fixes 0.0 talk ratio)

**Problem:** `audio-decode` npm package doesn't properly decode WebM bytes (returns silence). Custom `parseWav()` function in `analyzer.ts` had header parsing bugs.

**Fix:** `lib/audio/analyzer.ts`
- `analyzeWavFile(wavPath)` uses `decodeAudio` on the WAV file buffer (which handles all WAV formats correctly) instead of on raw WebM bytes
- `runRmsAnalysis(channelData, sampleRate)` — extracted RMS VAD logic into reusable function (same algorithm as before)
- `parseWav(buffer)` kept as utility for manual WAV parsing
- `app/api/recording/route.ts`: converts WebM → WAV via `wavFromRecording()` first, then analyzes the WAV file instead of raw WebM bytes
- If WAV conversion fails, falls back to `analyzeAudio(audioBytes)` on original WebM

## Removed Per-Turn Score Signals

**Problem:** ScoreSignals per turn ("professionalism +1", "technical -1") displayed as badges in VoiceChat and analysis page. User called this "horseshit" — simplistic +/-1 scoring doesn't meaningfully assess performance.

**Fix:**
- Removed `SignalBadge` component and all scoreSignals display from `app/analysis/[id]/page.tsx`
- Removed Scoring Summary section (accumulated +/-1 totals)
- Removed scoreSignals badges from `components/VoiceChat.tsx` message bubbles
- Removed `scoreSignals` instructions from AI customer prompt (`lib/mvp/sim-graph/ai-customer.ts`) — LLM now returns `"scoreSignals": {}`
- Final LLM assessment (`call-assessment.ts`) still scores dimensions 1-10 properly
- Cleaned up `VoiceRecorderButton.tsx`: removed `flushRecordingTrigger`, `onFullRecording`, `onFlushComplete` props and `fullCallChunksRef` accumulation

## Fixed Analysis Page State Management

**Problem:** Assessment was being lost because two sequential `setSessionData()` calls in the useEffect were overwriting each other (React 18 batching).

**Fix:** `app/analysis/[id]/page.tsx`
- Consolidated all state (session, messages, routeEvents, assessment) into a single `setSessionData` call
- Assessment now correctly renders on the analysis page

## LLM Audio Interpretation

**Problem:** LLM assessment received basic acoustic metrics but didn't interpret them for hiring-relevant insights. openSMILE features were dumped raw on the page (88 features) with no meaning explained.

**Fix:** `lib/mvp/analysis/call-assessment.ts`
- `AssessmentInput` expanded: now accepts `voiceFeatures` with F0 pitch range, jitter, shimmer, HNR, spectral flux, speech rate
- `app/api/recording/route.ts`: extracts key openSMILE features from the 88-feature set and maps them to interpretable fields (f0Range, jitter, shimmer, hnr, etc.)
- System prompt includes **Acoustic Interpretation Guide** telling the LLM what each metric means:
  - Talk ratio < 30%: passive/hesitant, > 70%: dominating
  - Silence ratio > 40% or longest pause > 5s: awkward gaps, got stuck
  - Silence segments > 1 per 3s: excessive hesitation
  - Avg loudness < 0.03: barely audible, low assertiveness
  - RMS variance low: monotone; high: dynamic
  - F0 pitch range narrow (< 10 st): monotone, low confidence
  - F0 range wide (> 20 st): expressive, confident
  - Jitter/shimmer high: vocal tension, nervousness, stress
  - HNR low (< 10 dB): breathy, weak, uncertain
  - Spectral flux low: robotic/flat delivery
  - Speech rate high (> 3 peaks/s): rushed/nervous; low (< 1): slow/hesitant
- LLM instructed to **cite specific acoustic evidence** in feedback (e.g. "Long pauses of 4.2s suggest uncertainty")
- Costs nothing extra — all text input to OpenCode Go

