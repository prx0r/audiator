# Audiator Propositions 2 — Practical Architecture

> A refined, opinionated build plan. This supersedes the more speculative parts of `propositions.md` with a concrete implementation strategy.

---

## Core Thesis

You do not need to stream TTS word by word like Cartesia. You need to **stream understanding word by word**, then use that early understanding to **preload / preselect / buffer likely customer responses**.

Cartesia's advantage: low-latency arbitrary speech generation.
Your advantage: **known scenario graph → predicted candidate action → pre-cached customer response.**

The graph makes the conversation finite. You are not inventing the world every turn. You are navigating a known world. That is the cheat.

---

## The Two Loops

### Slow Reader / Predictor (background, after every turn)

Understands the whole call state, predicts likely next candidate actions, preloads likely customer responses.

```
Input:  current node + scenario state + candidate progress + customer mood
Output: likely next intents + response audio/text cache keys
```

### Fast Talker / Runtime (per utterance)

Listens to partial transcript, matches to a graph node, selects cached audio, plays immediately, logs route event.

```
Input:  candidate text or partial transcript
Output: matched node + preloaded audio playback + route log event
```

---

## How It Works: Word-by-Word Graph Collapsing

Candidate says: *"Can you check if the Work Offline button is highlighted?"*

The system does **not** wait for the full sentence:

| Partial Transcript | What Happens |
|---|---|
| *"Can you..."* | Too broad — 40% of graph still possible |
| *"Can you check..."* | Collapses to diagnostic-action nodes (~15) |
| *"Can you check if..."* | Narrowing to state-inspection actions |
| *"Can you check if the Work..."* | Likely Outlook / Work Offline |
| *"Can you check if the Work Offline..."* | **Commit**: `ask_work_offline_status` |

Before the sentence ends:
- Response key selected: `work_offline_highlighted_frustrated_v1`
- Cached MP3 loaded into memory buffer
- Slow Reader triggered to preload next-likely nodes

When VAD fires end-of-speech:
- Fast Talker confirms high-confidence match
- `audio.play()` — playback starts at ~0ms TTS latency

**TTS was never in the hot path.**

---

## Preload Manifest

After each turn, the Slow Reader produces a preload manifest:

```typescript
type PreloadedRoute = {
  nodeId: string;
  candidateIntent: string;
  responseKey: string;
  responseText: string;
  audioCacheKey: string;
  audioUrl?: string;
  stateUpdate: Record<string, unknown>;
  evidenceTags: string[];
  scoreImpact: Record<string, number>;
  nextLikelyNodes: string[];
};

type PreloadManifest = {
  currentNodeId: string;
  likelyRoutes: PreloadedRoute[];
  generatedAt: number;
};
```

Example:

```json
{
  "currentNodeId": "ask_outbox_status",
  "likelyRoutes": [
    {
      "nodeId": "ask_work_offline_status",
      "candidateIntent": "ask_work_offline_status",
      "responseKey": "work_offline_highlighted_frustrated_v1",
      "responseText": "Yeah, it is highlighted. Is that why this isn't working?",
      "audioCacheKey": "kokoro_work_offline_highlighted_frustrated_v1",
      "evidenceTags": ["identified_work_offline"],
      "nextLikelyNodes": ["disable_work_offline", "send_test_email", "explain_issue"]
    },
    {
      "nodeId": "ask_internet_status",
      "responseKey": "internet_working_neutral_v1",
      "responseText": "The websites seem to be loading fine.",
      "audioCacheKey": "kokoro_internet_working_neutral_v1",
      "evidenceTags": ["checked_internet"],
      "nextLikelyNodes": ["ask_work_offline_status", "ask_outbox_status"]
    }
  ]
}
```

---

## Four-Layer Intent Matcher

| Layer | Method | Speed | Coverage | Example |
|-------|--------|-------|----------|---------|
| 1 | Keyword/regex | ~0ms | ~40% | "outbox" → `ask_outbox_status` |
| 2 | Partial phrase match | ~2ms | ~25% | "can you check if..." → diagnostic intent |
| 3 | Embedding similarity | ~10ms | ~25% | Paraphrase → closest graph node |
| 4 | LLM fallback | ~200-500ms | ~10% | Off-script utterances |

**For MVP, skip layer 3 (tiny classifier) and use: keyword → embedding → LLM.**

---

## Soft Prediction vs Hard Commit

Critical design pattern — speculate aggressively, commit conservatively:

| During Speech | After VAD |
|---|---|
| **Soft prediction**: preload likely responses for top 3-5 nodes | **Hard commit**: choose response only if confidence > threshold (e.g., 0.7) |
| Update probabilities as each word arrives | If no high-confidence match → template → LLM fallback |
| Preload audio into memory buffer | Play selected audio, log route event |

This lets you preload aggressively without exposing mistakes.

---

## Route Log: The Real Transcript of Competence

Every turn produces a structured event — not just what was said, but the entire graph traversal:

```json
{
  "turnId": "turn_004",
  "candidateText": "Can you check if the Work Offline button is highlighted?",
  "partialMatches": [
    { "partial": "Can you check if...", "matchedIntent": "diagnostic_action", "confidence": 0.3 },
    { "partial": "check if the Work...", "matchedIntent": "ask_work_offline_status", "confidence": 0.6 },
    { "partial": "Work Offline button", "matchedIntent": "ask_work_offline_status", "confidence": 0.91 }
  ],
  "matchedIntent": "ask_work_offline_status",
  "matchConfidence": 0.91,
  "responseKey": "work_offline_highlighted_frustrated_v1",
  "responseSource": "preloaded_audio",
  "playbackLatencyMs": 34,
  "stateBefore": { "outboxChecked": true, "workOfflineFound": false },
  "stateAfter": { "outboxChecked": true, "workOfflineFound": true },
  "evidenceTags": ["identified_work_offline", "followed_diagnostic_path"],
  "missedEarlierNodes": ["ask_internet_status"],
  "nextLikelyNodes": ["disable_work_offline", "send_test_email", "explain_issue"]
}
```

This feeds directly into analysis:

```
actual route vs ideal route vs acceptable alternatives vs bad branches taken
```

---

## Kokoro Self-Hosting Strategy

**Do not** send each word to Kokoro. Kokoro is used **before the user needs audio**, not after.

| Usage | When | Frequency |
|---|---|---|
| Pre-generate graph responses | Before call starts (batch) | ~50-200 utterances per sim pack |
| Fallback TTS for off-graph turns | During call (on demand) | ~5% of turns |
| Re-cache after graph changes | After sim pack edits | Rare |

Deploy with `hwdsl2/docker-kokoro` which provides an OpenAI-compatible API:

```bash
docker run -d -p 8080:80 hwdsl2/kokoro
```

Then point your app at `http://localhost:8080/v1/audio/speech` instead of OpenRouter. On your Hetzner 2-core/4GB box, Kokoro uses ~300MB RAM and one CPU core per request — easily handles concurrent pre-generation and the rare live fallback.

---

## Architecture Diagram

```
Browser
  ↓ live mic chunks
Streaming STT / partial transcript
  ↓
Partial Intent Matcher (4-layer: keyword → phrase → embedding → LLM)
  ↓
Graph Probability Engine
  ↓
Preload Manager
  ↓
Audio Cache / Self-Hosted Kokoro
  ↓
Fast Talker Response Player
  ↓
Route Logger
  ↓
Analysis Engine
```

---

## Module Layout

```
lib/mvp/sim-graph/
  types.ts                  — PreloadedRoute, PreloadManifest, RouteEvent, etc.
  outlook-work-offline.graph.ts  — the graph: 12-15 nodes
  match-partial-intent.ts   — 4-layer matcher with soft/hard commit
  predict-next.ts           — Slow Reader: preload manifest generator
  preload-manifest.ts       — cache preload orchestration
  runtime.ts                — Fast Talker: per-turn loop
  route-log.ts              — route event persistence

lib/mvp/voice/
  local-kokoro.ts           — self-hosted Kokoro client
  audio-cache.ts            — pre-generated audio cache manager

lib/mvp/analysis/
  route-analysis.ts         — actual vs ideal path comparison
```

---

## First Experiment

Build this in audiator (the standalone lab, not CX-Train):

```
One scenario:      Outlook Work Offline
One graph:         12-15 nodes
One voice:         Kokoro bf_emma (default US female)
One cache:         data/tts-cache/
One UI panel:      live transcript + predicted node + confidence + preloaded keys
```

Test UI should show in real time:

```
Partial transcript:
  "can you check if the work..."

Predicted node:
  ask_work_offline_status

Confidence:
  0.81

Preloaded:
  work_offline_highlighted_frustrated_v1.mp3
  work_offline_highlighted_neutral_v1.mp3

Final committed node:
  ask_work_offline_status

Playback latency after VAD:
  34ms
```

---

## What This Proves

This architecture proves five things at once:

| Problem | Solution |
|---|---|
| Latency | Audio is preloaded before the candidate finishes speaking. TTS is never in the hot path. |
| Realism | Responses are consistent with the persona and scenario because they're hand-authored or pre-generated from the graph. |
| Scoring | Every turn produces structured evidence — the route log is the analysis substrate. |
| Customisation | Graph density controls difficulty. Same scenario, beginner → intermediate → advanced. |
| Moat | No generic model knows "This candidate skipped Outbox check and jumped to reinstall." Your graph does. |

---

## What Not to Do

| Trap | Why |
|---|---|
| Word-level TTS streaming | You don't need it. Preloaded audio covers 80%+ of turns. |
| Full Rasa adoption | Too heavy for MVP. Copy the mental model, not the framework. |
| LangGraph for live call | Use for Callum/analysis/offline, not the millisecond-sensitive live loop. |
| GPU inference | Kokoro runs on CPU. Your Hetzner box is enough. |
| Emotion recognition | You don't need to read emotion. The graph *knows* the customer's scripted emotional state. |

---

## The Real Moat

Cartesia wins at arbitrary realtime speech. CallCallum wins at scripted-but-flexible support-call simulation. The same graph powers live simulation, audio preloading, scoring, route logging, post-call feedback, manager calibration, and retry improvement.

That is not a TTS company. That is an assessment platform.
