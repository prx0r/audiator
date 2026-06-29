# CallCallum MVP Build Plan

This is the implementation plan for the realistic MVP on a Hetzner 2-core / 4GB RAM server.

The important changes from `docs/spek.md` are:

- Do not use OpenRouter.
- Do not build word-by-word graph collapsing for MVP.
- Do not put an LLM in the live call path.
- Use end-of-turn transcript matching.
- Use local TTS through Kokoro-FastAPI.
- Test local STT options before committing, with Vosk as the first MVP target and `sherpa-onnx-node` as the already-installed alternative.
- Treat latency measurement as a product requirement, not a nice-to-have.

## Target MVP

Candidate joins a browser-based simulated service desk call. A deterministic customer agent answers using a hardcoded Outlook "Work Offline" ScenarioGraph. The call is logged as structured route events and reviewed after completion.

The MVP should prove:

1. The candidate can complete one realistic support scenario by voice.
2. The system can identify key support intents from imperfect STT.
3. Customer pressure changes deterministically.
4. Every turn produces reviewable evidence.
5. The stack can run one active call on 2 cores / 4GB RAM.

## Runtime Architecture

```text
Browser candidate UI
  -> LiveKit room
    -> customer worker
      -> VAD / end-of-turn detection
      -> STT adapter
          preferred MVP: Vosk sidecar
          benchmark alternative: sherpa-onnx-node
          quality fallback: whisper.cpp tiny/base.en
      -> ScenarioGraph intent matcher
      -> pressure meter
      -> delivery template selection
      -> Kokoro-FastAPI local TTS
      -> customer audio published back to LiveKit
      -> route event POSTed to Next.js API
  -> Next.js persists attempt, route log, score, latency metrics
```

## Deployment Assumptions

Target server:

- Hetzner VPS
- 2 vCPU
- 4GB RAM
- 1 active call
- Linux
- Docker available
- No GPU

Services on the box:

- Next.js
- LiveKit server
- customer worker
- SQLite or existing local persistence for MVP
- Kokoro-FastAPI
- STT sidecar if Vosk/whisper.cpp is selected

Strict MVP constraints:

- No local LLM.
- No external OpenRouter calls.
- Pre-generate common TTS responses before calls.
- Only synthesize short live phrases during a call.
- Commit candidate intent after end-of-turn transcript, not partial transcript.

## Technology Choices

### LiveKit

Use LiveKit for room transport only:

- room-per-attempt
- candidate browser joins as candidate
- worker joins as customer
- publish/subscribe audio tracks
- allow customer audio interruption later, but do not make barge-in a Phase 1 blocker

Implementation notes:

- Add server-side room/token creation under `lib/mvp/voice/livekit-room.ts`.
- Do not expose the LiveKit API secret to the browser.
- Persist LiveKit room name against the assessment attempt.
- Use short-lived tokens.
- Add a local dev mode that can bypass LiveKit with text/audio fixtures for fast testing.

### STT

Preferred first implementation: Vosk sidecar.

Reason:

- lightweight
- offline
- streaming-capable
- small English models are feasible on this server
- grammar/vocabulary adaptation can help this narrow support-call domain

Vocabulary to bias/test:

- Outlook
- Work Offline
- Outbox
- Send Receive
- webmail
- email
- internet
- meeting
- highlighted
- button
- error message
- test email

Already-installed alternative:

- `sherpa-onnx-node` exists in `package.json`.
- Add a benchmark harness before either removing it or adopting it.

Quality fallback:

- `whisper.cpp` with `tiny.en` or `base.en`.
- Use only if Vosk/sherpa intent accuracy is too poor.
- Expect higher CPU latency.

Do not require streaming STT for MVP. The MVP only needs:

```text
audio turn -> final transcript -> intent match -> customer response
```

### TTS

Use Kokoro-FastAPI locally.

Recommended service:

```text
http://127.0.0.1:8880/v1/audio/speech
```

Implementation notes:

- Replace current OpenRouter-based TTS in `lib/voice/tts.ts`.
- Make TTS provider configurable with `VOICE_TTS_PROVIDER=kokoro`.
- Add `KOKORO_BASE_URL`.
- Cache generated audio by stable key:

```text
voice + scenarioId + responseKey + responseTextHash + format
```

- Pre-generate all graph-node response cores before starting a call.
- During a call, only synthesize rare short delivery prefixes if needed.

### ScenarioGraph

Build the graph as TypeScript data and deterministic runtime code.

Create:

```text
lib/mvp/sim-graph/types.ts
lib/mvp/sim-graph/outlook-work-offline.ts
lib/mvp/sim-graph/match-intent.ts
lib/mvp/sim-graph/runtime.ts
lib/mvp/sim-graph/route-log.ts
lib/mvp/sim-graph/customer-profile.ts
lib/mvp/sim-graph/delivery-templates.ts
lib/mvp/sim-graph/latency.ts
```

The matcher should start simple:

1. normalize transcript
2. exact/domain phrase match
3. weighted keyword match
4. scenario-specific aliases
5. deterministic fallback route

No embedding layer is required for the first build. Add it only if phrase/keyword matching fails the fixture tests.

Required first graph nodes:

- `opening`
- `identity_verification`
- `ask_problem_summary`
- `ask_error_message`
- `ask_outbox_status`
- `ask_internet_status`
- `ask_webmail_status`
- `ask_send_receive_status`
- `ask_work_offline_status`
- `disable_work_offline`
- `send_test_email`
- `confirm_resolution`
- `small_talk`
- `bad_reinstall_outlook`
- `bad_escalate_too_early`
- `off_topic_bizarre`
- `repeat_or_unclear`

## Environment Variables

Remove OpenRouter as a required dependency.

Add:

```bash
LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

VOICE_STT_PROVIDER=vosk
VOSK_BASE_URL=http://127.0.0.1:2700
SHERPA_MODEL_DIR=
WHISPER_CPP_BASE_URL=

VOICE_TTS_PROVIDER=kokoro
KOKORO_BASE_URL=http://127.0.0.1:8880
VOICE_TTS_VOICE=af_heart

CALLCALLUM_DB_PATH=./data/callcallum.sqlite
CALLCALLUM_AUDIO_CACHE_DIR=./data/tts-cache
CALLCALLUM_RECORDINGS_DIR=./data/recordings
```

Provider interfaces should be explicit:

```ts
type SttProvider = "vosk" | "sherpa" | "whisper_cpp" | "fixture";
type TtsProvider = "kokoro" | "fixture";
```

## Turn Runtime

Turn flow:

```text
1. Candidate starts speaking.
2. VAD records a turn until end-of-speech.
3. STT transcribes the completed turn.
4. Intent matcher selects a graph route.
5. Runtime applies state updates and pressure delta.
6. Runtime selects response text and audio cache key.
7. TTS cache returns audio, or Kokoro generates and stores it.
8. Customer audio plays into the call.
9. Route event and latency metrics are persisted.
```

Required decision object:

```ts
type CustomerDecision = {
  matchedNodes: string[];
  primaryIntent: string;
  matchConfidence: number;
  fallbackReason?: string;
  customerResponseText: string;
  responseMode: "cached" | "generated" | "redirect" | "clarification";
  audioCacheKey?: string;
  pressureBefore: number;
  pressureAfter: number;
  pressureDelta: number;
  stateUpdates: Record<string, unknown>;
  evidenceTags: string[];
  scoreSignals: {
    technical?: number;
    communication?: number;
    callControl?: number;
    professionalism?: number;
  };
  nextLikelyNodes: string[];
};
```

## Latency Recording

Record latency for every turn. Store both raw marks and computed durations.

Required marks:

```text
turn_start
speech_start
speech_end
stt_start
stt_end
match_start
match_end
tts_cache_start
tts_cache_end
tts_generate_start
tts_generate_end
audio_play_start
audio_play_end
route_log_start
route_log_end
turn_end
```

Computed metrics:

```text
speech_duration_ms
vad_tail_ms
stt_ms
match_ms
tts_cache_ms
tts_generate_ms
time_to_first_customer_audio_ms
customer_audio_duration_ms
route_log_ms
total_turn_ms
```

Latency targets for one active call:

| Metric | Target | Hard Fail |
|---|---:|---:|
| matcher | < 50ms | > 150ms |
| cached TTS lookup | < 50ms | > 150ms |
| generated short TTS | < 800ms | > 2000ms |
| STT final transcript | < 1500ms | > 3500ms |
| end-of-speech to first customer audio, cached | < 1800ms | > 4000ms |
| end-of-speech to first customer audio, generated | < 2600ms | > 5500ms |

Add a route-log latency section to the manager/debug review page:

- per-turn bars
- p50/p95 for the attempt
- provider name/model
- cache hit/miss
- fallback reason

## Tests To Add

### Unit Tests

Add:

```text
tests/sim-graph.match-intent.test.ts
tests/sim-graph.runtime.test.ts
tests/sim-graph.pressure.test.ts
tests/sim-graph.delivery-templates.test.ts
tests/voice.tts-cache.test.ts
tests/voice.latency.test.ts
```

Minimum coverage:

- each graph node has at least 3 matching candidate utterances
- off-topic utterances route to deterministic redirects
- bad actions produce negative score signals
- pressure increases/decreases correctly
- repeated questions are detected
- state preconditions block impossible nodes
- route events include state before/after
- delivery templates never produce empty response text
- latency tracker handles missing optional marks
- TTS cache key changes when response text changes

Run:

```bash
npm test
```

### STT Benchmark Tests

Add:

```text
scripts/benchmark-stt.mjs
tests/fixtures/stt/outlook-work-offline/*.wav
tests/fixtures/stt/outlook-work-offline/manifest.json
```

Manifest format:

```json
[
  {
    "file": "ask-work-offline-01.wav",
    "expectedText": "can you check if work offline is highlighted",
    "expectedIntent": "ask_work_offline_status"
  }
]
```

Benchmark output:

```text
provider
model
file
audio_duration_ms
transcript
expected_intent
matched_intent
intent_correct
word_error_hint
stt_ms
match_ms
total_ms
rss_mb
cpu_percent_hint
```

Pass criteria before using a provider:

- >= 85% intent accuracy on clean fixture audio
- >= 75% intent accuracy on laptop-mic/noisy fixture audio
- p95 STT latency under 3500ms
- RSS stable under 1GB for the STT service
- no process crash across 100 sequential turns

Test phrases must include:

- normal happy path
- hesitant speech
- customer-service phrasing
- short commands
- jargon-heavy bad responses
- off-topic/bizarre phrases
- repeated questions
- common STT confusions: "work offline" vs "work off line", "out box" vs "outbox"

### TTS Benchmark Tests

Add:

```text
scripts/benchmark-tts.mjs
```

Benchmark:

- 20 short responses
- 20 medium graph responses
- 5 generated prefix + cached core responses
- cold cache and warm cache

Record:

```text
response_key
text_chars
voice
cache_hit
generate_ms
read_cache_ms
audio_bytes
audio_duration_ms
```

Pass criteria:

- warm cache p95 under 150ms
- short generated p95 under 2000ms
- no failed generations in 50 requests

### End-to-End Simulation Tests

Add:

```text
scripts/simulate-call.mjs
tests/fixtures/calls/outlook-happy-path.json
tests/fixtures/calls/outlook-bad-path.json
tests/fixtures/calls/outlook-off-topic.json
```

The simulator should run without LiveKit:

```text
candidate transcript -> ScenarioGraph runtime -> route log -> final score
```

Pass criteria:

- happy path resolves issue
- bad path does not resolve issue
- off-topic path logs professionalism red flag
- pressure curve matches expected direction
- all turns have latency records, even with fixture STT/TTS

### LiveKit Smoke Test

Add:

```text
scripts/smoke-livekit-room.mjs
```

Test:

- create room
- create candidate token
- create customer token
- worker joins room
- candidate joins room
- customer publishes a known audio fixture
- route event is posted
- room is cleaned up

This can be manual at first, but should print clear pass/fail steps.

## Implementation Order

### Step 1: Remove OpenRouter From Local Voice Path

- Change `lib/voice/stt.ts` into a provider interface.
- Change `lib/voice/tts.ts` into a provider interface.
- Keep a `fixture` provider for tests.
- Do not delete old code until replacement tests pass, but make OpenRouter non-default and non-required.

### Step 2: Build ScenarioGraph Text Runtime

- Implement graph types.
- Implement hardcoded Outlook graph.
- Implement matcher.
- Implement pressure meter.
- Implement route event generation.
- Implement simulation script.

This step must work with plain text before voice is connected.

### Step 3: Add Latency Tracker

- Add runtime marks.
- Persist metrics in route events.
- Print p50/p95 in simulation output.
- Add unit tests.

### Step 4: Add Kokoro TTS Provider

- Implement local HTTP client.
- Implement cache.
- Implement pre-generation script:

```text
scripts/prebuild-tts-cache.mjs
```

- Benchmark cold/warm behavior.

### Step 5: Benchmark STT Providers

Implement the benchmark harness before final STT selection.

Order:

1. Vosk sidecar
2. `sherpa-onnx-node`
3. whisper.cpp tiny/base.en only if needed

Document results in:

```text
docs/stt-benchmark-results.md
```

The selected provider must be based on measured intent accuracy and latency, not transcript prettiness.

### Step 6: Add LiveKit Room Flow

- Add room/token creation.
- Add browser join flow.
- Add worker join flow.
- Start with customer opening-line playback.
- Then connect candidate audio to STT.

### Step 7: Manager Review Page

Show:

- route path
- transcript
- matched intent
- confidence
- pressure before/after
- score signals
- evidence tags
- latency metrics
- provider/cache diagnostics

## Acceptance Criteria

The MVP is acceptable when:

- A candidate can complete the Outlook Work Offline scenario by voice.
- A manager can review every turn with evidence and scoring signals.
- The app runs with one active call on the Hetzner 2-core / 4GB server.
- OpenRouter is not required for call execution.
- Common TTS responses are cached.
- End-of-speech to first customer audio is usually under 2 seconds for cached responses.
- STT provider choice is backed by benchmark output.
- `npm test` passes.
- Simulation scripts pass without LiveKit.
- LiveKit smoke test passes locally or on the target server.

## Known Risks

### Local STT Accuracy

Lightweight STT may produce rough transcripts. The system should optimize for intent classification, not perfect text. Add aliases and scenario-specific phrase matching before switching to heavier models.

### CPU Contention

Kokoro and STT can compete for CPU. Mitigations:

- pre-generate TTS
- serialize live TTS generation
- keep one active call
- monitor RSS and CPU during benchmark scripts
- move STT to a second small server if required

### LiveKit Complexity

Voice plumbing can slow product iteration. Keep the text simulation path working permanently so graph/scoring changes can be tested without LiveKit.

### Overbuilding

Do not add these until the basic route runtime works:

- embedding similarity
- LLM fallback
- word-by-word graph collapsing
- Pipecat
- scenario graph editor
- multi-scenario compiler

## Agent Notes

When implementing:

- Read existing `lib/voice/*`, `lib/audio/*`, and `tests/audio-analysis.test.ts` before editing.
- Preserve the existing test command unless replacing it deliberately.
- Prefer provider interfaces over hardcoded service calls.
- Keep fixture providers for deterministic tests.
- Avoid requiring Docker services for unit tests.
- Make benchmark scripts skip with a clear message if a provider is not running.
- Keep all route events serializable JSON.
- Store raw provider names and model names in metadata.
- Fail closed on missing customer state. Do not let responses contradict the scenario.
- Add concise comments only around scoring, pressure, and latency calculations.

