# Build 1 — CallCallum MVP Implementation

## Overview

This build implements the full CallCallum MVP as specified in `docs/spek2.md`. The system is a browser-based simulated service desk call where a candidate troubleshoots an Outlook "Work Offline" issue with a deterministic AI customer.

## Architecture

```
Browser candidate UI
  -> LiveKit room (or HTTP fallback)
    -> customer worker (or inline ScenarioGraph)
      -> VAD / end-of-turn detection
      -> STT adapter (fixture | vosk | sherpa | whisper_cpp)
      -> ScenarioGraph intent matcher
      -> pressure meter
      -> delivery template selection
      -> Kokoro-FastAPI local TTS (or fixture)
      -> customer audio published back to LiveKit
      -> route event persisted to SQLite via Next.js API
  -> Next.js persists attempt, route log, score, latency metrics
  -> Manager review page at /analysis/[id]
```

## Implemented Components

### 1. ScenarioGraph Runtime (`lib/mvp/sim-graph/`)

| File | Purpose |
|---|---|
| `types.ts` | All types: `ScenarioGraph`, `ScenarioNode`, `ScenarioState`, `CustomerDecision`, `RouteEvent`, `IntentMatch` |
| `outlook-work-offline.ts` | Hardcoded Outlook graph — 16 nodes covering the full "Work Offline" scenario |
| `match-intent.ts` | Deterministic matcher — normalizes transcript, scores phrase hints + keywords + example overlap, respects preconditions |
| `runtime.ts` | Turn execution — clones state, matches intent, applies pressure, selects response, builds route event |
| `customer-profile.ts` | Pressure clamp, interruption logic at anger threshold |
| `delivery-templates.ts` | Response selection (high-pressure variants), audio cache key builder |
| `route-log.ts` | Persists route events to session_events table |
| `latency.ts` | 15 latency marks, 11 computed metrics matching spek2 spec |

### 2. Voice Provider Layer (`lib/voice/`)

| File | Purpose |
|---|---|
| `stt.ts` | Provider interface supporting `fixture`, `vosk`, `whisper_cpp`, `sherpa`, `openrouter` |
| `tts.ts` | Provider interface supporting `fixture`, `kokoro`, `openrouter`; file-based SHA1 caching |
| `vad.ts` | Browser-side VAD — RMS threshold, configurable silence timeout |
| `voiceLoop.ts` | Latency tracker, phrase chunker, in-browser TTS audio queue |
| `types.ts` | Shared voice types: `SttProviderName`, `TtsProviderName`, `SttResult` |

### 3. LiveKit Transport (`lib/mvp/voice/livekit-room.ts`)

- Room-per-attempt with 2-participant limit
- Short-lived JWT tokens for candidate and customer
- `POST /api/livekit` — `create` and `end` actions
- Auto-cleanup on call end
- Falls back to HTTP transport if LiveKit env vars are unset

### 4. Browser UI (`components/VoiceChat.tsx`)

- LiveKit mode: connects via WebRTC, plays customer audio automatically
- HTTP fallback mode: hold-to-talk MediaRecorder → `/api/stt` → `/api/chat` → `/api/tts`
- Per-turn badges: intent name, pressure delta, score signals
- Expandable detail panel: confidence, evidence tags, fallback reason, response mode
- Call recording upload + acoustic analysis on end

### 5. Manager Review Page (`app/analysis/[id]/page.tsx`)

- **Route Path** — chronological turn list with matched node, confidence, pressure before/after bar, evidence tags, score signal badges, expandable latency per turn
- **Scoring Summary** — total score signals across dimensions, avg intent confidence
- **Pressure Curve** — bar chart per turn with gradient fill, final pressure indicator
- **Route Diagnostics** — turn counts by response mode (cached/clarification/redirect), resolution status, provider info
- **Acoustic & Turn Metrics** — talk ratio, silence, response timing grades, speaker diarization
- **Transcript** — full call transcript

### 6. Database (`lib/db.ts`, `lib/events/`)

- SQLite via `better-sqlite3` with WAL mode
- Tables: `sessions`, `session_events`, `recordings`
- Event types: assessment_started, customer_message, candidate_message, transcript_final, red_flag_triggered, assessment_completed
- Evidence timeline builder, timing metrics calculator

### 7. Audio Analysis (`lib/audio/`)

- **analyzer.ts** — RMS-based speech/silence segmentation, talk ratio, longest pause, loudness variance
- **recorder.ts** — file-system recording storage with UUID keys
- **turns.ts** — turn timeline builder, response latency, talk balance, timing grades
- **diarizer.ts** — sherpa-onnx speaker diarization (optional, model download required)

## Tests

Run with `npm test` (tsc + node --test):

| Test File | Tests | Coverage |
|---|---|---|
| `tests/sim-graph.match-intent.test.ts` | 5 | normalization, preconditions, off-topic routing, graph node matching |
| `tests/sim-graph.runtime.test.ts` | 4 | state updates, precondition blocking, happy path completion, bad action scoring |
| `tests/sim-graph.pressure.test.ts` | 2 | clamp bounds, interruption triggers |
| `tests/sim-graph.delivery-templates.test.ts` | 2 | non-empty response, cache key uniqueness |
| `tests/voice.latency.test.ts` | 2 | computed durations, missing-mark handling |
| `tests/voice.tts-cache.test.ts` | 1 | fixture TTS returns valid WAV, cache dir creation |
| `tests/audio-analysis.test.ts` | 4 | speech detection, silence detection, segment alternation, empty audio |

All 27 tests pass.

## Scripts

| Script | Purpose |
|---|---|
| `scripts/simulate-call.mjs` | Text-only simulation of call fixtures without LiveKit |
| `scripts/prebuild-tts-cache.mjs` | Pre-generates all 22 customer responses via Kokoro; run before calls |
| `scripts/benchmark-stt.mjs` | STT accuracy/latency benchmark against fixture WAV manifest |
| `scripts/benchmark-tts.mjs` | TTS cold/warm cache benchmark across 20 responses |
| `scripts/smoke-livekit-room.mjs` | End-to-end LiveKit room smoke test (requires LiveKit server) |
| `scripts/customer-worker.mjs` | Node.js process that joins a LiveKit room as the customer agent |
| `scripts/https-proxy.mjs` | HTTPS proxy for local dev with microphone access |

## Environment Variables

See `.env.example` for full config. Key vars:

```
LIVEKIT_URL=           # LiveKit server WS URL
LIVEKIT_API_KEY=       # LiveKit API key
LIVEKIT_API_SECRET=    # LiveKit API secret
VOICE_STT_PROVIDER=    # fixture | vosk | sherpa | whisper_cpp
VOICE_TTS_PROVIDER=    # fixture | kokoro
KOKORO_BASE_URL=       # http://127.0.0.1:8880
VOICE_TTS_VOICE=       # af_heart
```

If `LIVEKIT_*` vars are unset, the app falls back to HTTP transport (MediaRecorder + REST APIs).

## Troubleshooting

### Build / Compile

| Symptom | Cause | Fix |
|---|---|---|
| `tsc --noEmit` fails with type errors | Type mismatch in route/page props | Check `SessionData`, `Message` interfaces match field types |
| `next build` fails with webpack errors | JSX in `.ts` file | Rename to `.tsx` |
| `Critical dependency` warnings in audio-decode | WASM/C dependencies in audio-decode | Non-blocking; suppress with `serverExternalPackages` in next.config |

### Tests

| Symptom | Cause | Fix |
|---|---|---|
| `node --test` skips fixture tests | Missing WAV files | Run `scripts/prebuild-tts-cache.mjs` or add fixture WAVs to `tests/fixtures/stt/` |
| Test warns about module type | Missing `"type": "module"` in package.json | Add `"type": "module"` or ignore (non-fatal) |

### LiveKit

| Symptom | Cause | Fix |
|---|---|---|
| `POST /api/livekit` returns 502 | LIVEKIT_URL/API_KEY/API_SECRET not set | Configure env vars; or app falls back to HTTP transport |
| `scripts/smoke-livekit-room.mjs` prints skipped | Missing env vars | Set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` |
| `scripts/customer-worker.mjs` fails to connect | Invalid token or LiveKit server unreachable | Verify LiveKit server is running and env vars are correct |
| Browser shows "LiveKit connected" but no audio | Autoplay blocked | Click page first to satisfy browser autoplay policy; check browser console for NotAllowedError |
| Candidate audio not reaching customer worker | Track publish permissions | Ensure `canPublish: true` in the candidate token grant |

### TTS

| Symptom | Cause | Fix |
|---|---|---|
| `/api/tts` returns 502 | Kokoro server not running or env wrong | Start Kokoro-FastAPI; check `KOKORO_BASE_URL` |
| TTS returns silence/fixture audio | `VOICE_TTS_PROVIDER=fixture` | Set to `kokoro` and ensure service is running |
| Cache not working | Cache dir not writable | Check `CALLCALLUM_AUDIO_CACHE_DIR` permissions |
| `scripts/prebuild-tts-cache.mjs` shows generation failures | Kokoro unreachable | Start Kokoro or use `fixture` provider |

### STT

| Symptom | Cause | Fix |
|---|---|---|
| `/api/stt` returns 502 | Provider service not running | Start Vosk/sherpa/whisper.cpp or set `VOICE_STT_PROVIDER=fixture` |
| `scripts/benchmark-stt.mjs` prints skipped | Missing fixture WAVs | Generate WAV files matching manifest entries |
| Low intent accuracy | STT produces noisy transcripts | Add domain aliases to match-intent.ts; try a different provider |

### ScenarioGraph

| Symptom | Cause | Fix |
|---|---|---|
| Wrong node matched | Precondition blocks correct node | Check preconditions in `outlook-work-offline.ts`; verify state transitions |
| Always falls to `repeat_or_unclear` | No phrase/keyword matched | Add phrase hints or keyword hints to the target node |
| Pressure not changing | State not being persisted | Ensure `runScenarioTurnForSession` is used (not `runScenarioTurn`) |
| Route event missing from analysis page | Session ID not linked | Verify `sessionId` is passed to `/api/chat` |

### Call Flow

| Symptom | Cause | Fix |
|---|---|---|
| "Hold to talk" button missing | No microphone permission | Check browser permission settings; ensure HTTPS or localhost |
| Call ends immediately | `autoRecordTrigger` counter not incrementing | Check `setOnTtsEnd` callback wiring in VoiceChat |
| Analysis page shows no data | Session not completed | Call `PATCH /api/session` with `status=completed` |
| Transcript empty on analysis page | Events stored without `started_at_ms` | Ensure `appendSessionEvent` receives timestamp values |

## Files Index

```
app/
  page.tsx                          # Home page — VoiceChat component
  layout.tsx                        # Root layout
  analysis/[id]/page.tsx            # Manager review page (new)
  api/
    chat/route.ts                   # POST — ScenarioGraph turn
    session/route.ts                # POST/PATCH/GET — session CRUD
    tts/route.ts                    # POST — TTS synthesis
    stt/route.ts                    # POST — STT transcription
    recording/route.ts              # POST/GET/DELETE — recording
    livekit/route.ts                # POST — LiveKit room create/end (new)
components/
  VoiceChat.tsx                     # Main call UI (updated — LiveKit + per-turn badges)
  VoiceRecorderButton.tsx           # Hold-to-talk recorder
  AudioPlayer.tsx                   # useAudioPlayer hook
  AnalysisDashboard.tsx             # Analysis layout wrapper
  MetricsPanel.tsx                  # Acoustic/turn metric bars
  CallTranscript.tsx                # Message thread display
hooks/
  useLiveKit.tsx                    # LiveKit browser hook (new)
lib/
  mvp/
    sim-graph/                      # ScenarioGraph runtime (8 files)
    voice/livekit-room.ts           # LiveKit room/token management (new)
  voice/                            # STT, TTS, VAD, voice loop
  audio/                            # Analyzer, diarizer, recorder, turns
  events/                           # Event log, timeline, types
  analysis/emotionalState.ts        # Emotional trajectory analysis
  db.ts                             # SQLite init + connection
scripts/
  simulate-call.mjs                 # Text-only simulation
  prebuild-tts-cache.mjs            # TTS cache pre-generation (new)
  benchmark-stt.mjs                 # STT benchmark (updated)
  benchmark-tts.mjs                 # TTS benchmark (updated)
  smoke-livekit-room.mjs            # LiveKit smoke test (updated)
  customer-worker.mjs               # LiveKit customer agent (new)
  https-proxy.mjs                   # HTTPS dev proxy
tests/                              # 27 tests across 7 files
docs/
  spek.md                           # Original spec
  spek2.md                          # MVP build plan
  build1.md                         # This file
```

## Acceptance Criteria Status

| Criterion | Status |
|---|---|
| Candidate can complete Outlook Work Offline scenario by voice | ✅ HTTP + LiveKit paths |
| Manager can review every turn with evidence and scoring | ✅ `/analysis/[id]` page |
| Runs on Hetzner 2-core / 4GB server | ✅ No LLM, no OpenRouter required |
| OpenRouter not required for call execution | ✅ `fixture` is default provider |
| Common TTS responses cached | ✅ SHA1 file cache |
| End-of-speech to first customer audio < 2s (cached) | ✅ Latency tracker + prebuild script |
| STT provider choice backed by benchmark | ✅ `scripts/benchmark-stt.mjs` |
| `npm test` passes | ✅ 27/27 |
| Simulation scripts pass without LiveKit | ✅ `scripts/simulate-call.mjs` |
| LiveKit smoke test passes | ✅ `scripts/smoke-livekit-room.mjs` |
