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

## Tech Split: What Owns What

Do not use LangGraph in the live call loop. Use this division:

| Layer | Technology | Owns |
|---|---|---|
| Product & scoring | CX-Train / Next.js / TypeScript | Manager dashboard, assessment packs, route logs, scoring |
| Simulation brain | **ScenarioGraph Runtime** / TypeScript | Graph navigation, state, evidence, scoring signals, fallback policy |
| Voice pipeline | **Audiator** / Pipecat / Python | VAD, STT pipeline, TTS pipeline, barge-in events, latency metrics |
| TTS | Kokoro / local ONNX Docker | Self-hosted customer speech generation |
| Media transport | LiveKit | WebRTC rooms, browser audio, future telephony/SIP |

### The "Aliens" Route — First-Class, Not Fallback

Off-topic utterances should be deterministic route matches, not panic fallbacks:

```json
{
  "id": "off_topic_bizarre_or_unprofessional",
  "candidateIntents": [
    "bizarre_explanation",
    "irrelevant_conspiracy",
    "unprofessional_joke",
    "wild_guess_without_evidence"
  ],
  "exampleUtterances": [
    "maybe aliens did it",
    "this is probably ghosts",
    "your computer is cursed",
    "the government is blocking your email"
  ],
  "customerResponses": [
    {
      "key": "customer_redirects_to_problem",
      "text": "I'm not sure about that. I really just need this email sorted before my meeting.",
      "mood": "rushed"
    }
  ],
  "evidenceTags": ["off_task_unprofessional"],
  "scoreSignals": { "professionalism": -2, "callControl": -1, "technical": -1 },
  "nextLikelyNodes": ["problem_restatement", "ask_outbox_status", "ask_webmail_status"]
}
```

This makes weirdness useful. It is not "fallback" — it becomes evidence.

### Where Pipecat Flows Fits

Pipecat Flows already gives structured conversation graphs, but do not make it the source of truth. Your graph needs assessment-specific fields that Pipecat Flows is not designed around (scoring, hidden facts, manager calibration, route-as-evidence). Use it as a voice-side adapter only.

### Where XState Fits

XState is a JS/TS state machine library. Use it optionally for visualization and debugging of scenario state, not as the core runtime.

### Where Semantic Router Fits

Semantic Router makes fast semantic decisions without slow LLM generations, using routes defined by example utterances. This maps directly to graph nodes. Each node's `examplePhrases` become router examples. Use the pattern, not the library.

---

## Phased Integration Plan

### Phase 1 — Now (Graph + Kokoro + Route Log)

Keep CX-Train mostly as-is. Add:

```
custom ScenarioGraph runtime in TypeScript
self-hosted Kokoro via Docker (hwdsl2/docker-kokoro)
TTS cache (data/tts-cache/)
route log + analysis
hardcoded Outlook Work Offline graph (12-15 nodes)
chaos test harness (10 adversarial utterances)
```

Use **Audiator** to test this — it is already the audio playground. Do not add LiveKit yet unless the browser audio loop is blocking you.

### Phase 2 — Realtime Audio Lab

Move Audiator's voice loop to Pipecat:

```
Pipecat voice pipeline
KokoroTTSService (native Pipecat support)
Silero VAD or Pipecat VAD
streaming STT provider
custom ScenarioGraph adapter
latency dashboard (show prediction vs commit times)
```

Pipecat is the best match for self-hosted Kokoro because Kokoro is now directly supported as a local/offline TTS service.

### Phase 3 — Production Call Feel

Add LiveKit:

```
LiveKit room per assessment attempt
Pipecat LiveKitTransport
Candidate joins from CX-Train browser UI
Pipecat worker joins as the customer
Route events stream back to CX-Train
```

This gets you barge-in, real call feel, lower-latency audio transport, and future telephony options.

### Phase 4 — Offline Callum Intelligence

Use LangGraph-like tools only here:

```
Callum assistant: manager pack generation
Callum assistant: scenario graph compilation
Callum assistant: post-call analysis
Callum assistant: alternative route suggestions
Callum assistant: manager calibration assistant
Callum assistant: retry coaching
```

This is where slower agentic reasoning is valuable. Not in the live sim loop.

---

## Recommended Stack

| Layer | Technology | When |
|---|---|---|
| Frontend/product | Next.js CX-Train | Now |
| Core sim intelligence | Custom TypeScript ScenarioGraph runtime | Now |
| Statechart help | XState (optional, viz/debug) | Phase 2 |
| Intent routing | Custom regex + embedding router | Now (improve iteratively) |
| Voice pipeline | Pipecat | Phase 2 |
| TTS | Self-hosted Kokoro via Pipecat or Docker | Phase 1 (Docker), Phase 2 (Pipecat) |
| Media transport | WebSocket → Pipecat → LiveKit | Phase 1 → Phase 2 → Phase 3 |
| Agentic/offline | LangGraph for Callum only | Phase 4 |

**Pipecat + Kokoro + your own ScenarioGraph is the best immediate technical direction.**
**LiveKit becomes worth it when you care about barge-in, rooms, WebRTC, and production call feel.**
**LangGraph stays out of the live sim.**

---

## LiveKit: What It Actually Is

LiveKit is a **WebRTC media router / SFU** — it moves audio around. It does not do AI. It does not need a GPU. It is written in Go and runs on any CPU VPS.

### Does It Need a GPU?

| Component | GPU Required? |
|---|---|
| LiveKit server (SFU) | **No** — Go binary, pure CPU |
| Pipecat voice worker | No, unless your STT/TTS models need it |
| Kokoro TTS | No — runs on CPU via ONNX |
| Whisper/local STT | CPU possible (slower), GPU helps |
| LLM | API-based (no GPU) or local (GPU if self-hosted) |

LiveKit itself is not the expensive bit.

### Is It Free?

| Scenario | Cost |
|---|---|
| Self-hosted (local dev / your Hetzner) | Software is free. Pay only for the machine. |
| Self-hosted (production) | Server cost + your ops burden |
| LiveKit Cloud | Metered: WebRTC minutes, agent sessions, STT/TTS/LLM per-minute |

Self-hosting on your Hetzner 2-core box: LiveKit server uses minimal CPU/RAM. It will run fine alongside Next.js and Kokoro for a prototype.

### Is It Easy to Add?

For a basic audio room: yes (~30 mins to get a room running). For a full voice agent pipeline with graph prediction, cached audio, and scoring: medium complexity.

The minimum viable integration:

```
1. CX-Train creates assessment attempt
2. Backend creates LiveKit room + access token
3. Candidate browser joins room
4. Voice worker joins same room as "customer"
5. Candidate speaks
6. Worker receives audio
7. Worker runs STT → ScenarioGraph → TTS/cache
8. Worker publishes customer audio back into room
9. Worker sends route events to CX-Train
```

The hard part is not LiveKit. The hard part is **the worker** — the ScenarioGraph runtime, intent matcher, preload manager, and fallback policy.

### Should You Add It Now?

**Not yet for CX-Train mainline.** Add it in Audiator first.

Your current priority is proving:

```
partial transcript → graph prediction → preload cached Kokoro audio → instant response
```

You can test that without LiveKit using the existing browser/audio loop. Once that works, LiveKit becomes worth adding because it gives you:

- Real WebRTC call feel
- Barge-in / interruptions
- Clean room-per-attempt architecture
- Better audio transport (no HTTP-blob-upload dance)
- Future SIP/phone-call direction
- Agent joins as a participant, not a hidden process

### Blunt Conclusion

LiveKit is not a GPU problem and not the expensive AI part. It is a **transport upgrade**. Use it when you want the sim to feel like a real call. But the thing that makes CallCallum smart is still the ScenarioGraph + intent matching + preloaded responses + route-as-evidence scoring. Build that first.

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

## Failure Modes & Fixes

*The graph-prediction/cache approach is powerful but has sharp edges. Humans constantly add unexpected social, emotional, ambiguous, or meta-level behaviour. The system must be fast when the candidate stays on-path but graceful when they go off-path.*

### 1. Premature Commitment

**Problem:** The system may predict correctly at word 5 but miss the final meaning at word 12.

Candidate: *"Can you check if the internet is working… or actually, can you just restart the router?"*

Early prediction: `ask_internet_status`. Final intent: `bad_action_restart_router_too_early`.

**Fix:** Never commit during speech. Only **speculate** during speech. Hard-commit after VAD/end-of-speech and final transcript.

```
0.30–0.60 confidence: preload broad branch
0.60–0.85 confidence: preload likely node
0.85+ confidence: prepare response in buffer
After final transcript: commit with threshold check
```

### 2. Multi-Intent Utterances

**Problem:** Real speech often bundles multiple actions in one turn.

Candidate: *"Can you check if there's anything in the outbox, and also whether Work Offline is turned on?"*

Graph systems like clean one-node-per-turn logic. Real candidates bundle actions.

**Fix:** Allow one utterance to trigger multiple nodes.

```json
{
  "matchedNodes": ["ask_outbox_status", "ask_work_offline_status"],
  "evidenceTags": ["checked_outbox", "identified_work_offline"],
  "stateUpdates": [{ "outboxChecked": true }, { "workOfflineFound": true }]
}
```

The customer response covers both in a single line: *"Yeah, there are three in the outbox and Work Offline is definitely on."*

### 3. Human Warmth Treated as Noise

**Problem:** Candidates say things like *"Are you okay?"* or *"Don't worry, we'll get this sorted."* A rigid graph may ignore these because they don't advance the technical path. MSP managers care about tone.

**Fix:** Separate **technical graph** from **soft-skill overlay**.

```
Technical intent: ask_work_offline_status
Soft-skill modifier: empathy | reassurance | ownership | bad_jargon | dismissive_tone
```

Response selection becomes: technical response + emotional acknowledgement.

### 4. "Curveball at the End"

**Problem:** Candidate starts *"Can you check if Work Offline is on…"* (system predicts `ask_work_offline_status`), then finishes *"…also, are you okay? You sound stressed."* The candidate did two things: correct diagnostic action + empathy. If the graph only commits to one node, you lose nuance.

Bad: *"Yeah, it is highlighted."* (ignores empathy)
Better: *"Sorry, I'm just stressed because I've got a meeting soon. And yes, Work Offline is highlighted."*

**Fix:** Support compound intents with primary + secondary.

```json
{
  "primaryIntent": "ask_work_offline_status",
  "secondaryIntent": "show_empathy",
  "responseKey": "work_offline_plus_acknowledge_stress"
}
```

### 5. Cache Combinatorial Explosion

**Problem:** 15 nodes × 8 emotions × 5 candidate tones × 4 personas × 3 urgency levels = thousands of files.

**Fix:** Cache the common spine only. Generate rare blend responses on the fly.

```
Cached: "Yeah, Work Offline is highlighted."
Generated on-the-fly: "Sorry, I'm just stressed because I have a meeting soon."
Combined: Generated emotional prefix + cached technical answer.
```

### 6. LLM Fallback Ruins Character

**Problem:** When the graph fails and the LLM generates freely, it may give away hidden facts, be too helpful, break persona, or solve the issue for the candidate.

**Fix:** Constrain fallback with scenario state. The LLM receives:

- Allowed facts only
- Forbidden facts
- Customer mood
- What the customer knows/doesn't know
- Current graph state
- Response length limit

Output structured JSON, not free text.

### 7. Off-Graph Turns Need Scoring Too

**Problem:** Candidate says *"Are you okay?"* — off the technical graph but still score-relevant. If the system only scores graph progression, it misses important behaviour.

**Fix:** Parallel evaluators:

```
Technical progression scorer
Communication scorer
Call-control scorer
Professionalism scorer
Safety/compliance scorer
```

Route log captures:

```json
{
  "technicalIntent": "ask_work_offline_status",
  "communicationIntent": "empathy_check",
  "scoreSignals": { "technical": "+1", "empathy": "+1", "callControl": "neutral" }
}
```

### 8. Partial Transcript False Positives

**Problem:** Streaming STT is messy. *"work offline"* might arrive as *"walk offline"* or *"work often."* Predictor may preload wrong audio.

**Fix:** Soft prediction during speech. Hard commit only after final transcript. Confidence thresholds prevent premature action.

### 9. System Feels Too Scripted

**Problem:** If every correct action triggers the same canned response, candidates notice repetition.

**Fix:** Cache multiple variants per response (short neutral, frustrated, confused, grateful, rushed) and rotate based on persona/mood.

### 10. Interruptions and Barge-In

**Problem:** Candidate may interrupt customer audio. Playing full cached audio through an interruption feels fake.

**Fix for MVP:** Disable candidate mic while customer speaks.
**Fix for later:** Allow interruption, stop audio, classify interruption, score call control, respond appropriately.

### 11. Graph Overfits to "Preferred Script"

**Problem:** You know the ideal route, but good support agents solve issues in different valid orders. A narrow graph punishes valid alternative paths.

Candidate checks Work Offline before webmail — that may be fine if the symptom strongly suggests Outlook-specific failure.

**Fix:** Graph nodes represent **competence evidence**, not a single sacred script. Acceptable alternative routes should be explicitly defined. Lower score only for genuinely missing scope, not for reordering.

### 12. "Happy Path" Hides Bad Reasoning

**Problem:** Candidate accidentally hits the right node (e.g., *"Just turn Work Offline off"*) but didn't diagnose properly. The graph marks `resolved issue` but the analysis should notice: jumped to fix, didn't explain, didn't test.

**Fix:** Each node needs quality dimensions: action taken, timing, justification, customer explanation, confirmation, professional phrasing.

### 13. Latency Optimization Fights Realism

**Problem:** 0ms response is not always good. Real call rhythm includes thinking pauses, clicking pauses, searching pauses, confusion pauses.

**Fix:** Use intentional latency based on response type:

```
Simple answer: 200-500ms
Customer checking screen: 1-2s
Customer confused: 700ms + hesitant phrase
Customer searching menu: 2-4s
```

### 14. Graph State Inconsistency

**Problem:** Candidate asks *"Is webmail working?"* Customer says *"Yes."* Later candidate asks *"Can you try webmail?"* Bad system may answer *"No, it won't load."*

**Fix:** Scenario state is authoritative. Customer response layer must never contradict it.

```json
{
  "webmailWorks": true,
  "internetWorks": true,
  "outboxHasItems": true,
  "workOfflineEnabled": true
}
```

### 15. Small Talk Can Derail Assessment

**Problem:** *"Are you okay?"* = empathy (good). *"What are you doing this weekend?"* = time-wasting (bad). The system needs to distinguish empathy from avoidance.

**Fix:** Small talk allowed but bounded by scenario mood. Rushed customer pulls back to task: *"I'm okay, just stressed about this meeting. Can we focus on getting the email sent?"*

---

## The Correct Architecture Is Hybrid

Not pure cached graph. Not pure LLM. A three-layer hybrid:

```
80% graph/cached response:
  Candidate says expected thing → play preloaded audio → instant

15% graph + generated modifier:
  Candidate adds human curveball → generated emotional prefix + cached technical answer

5% full fallback generation:
  Candidate goes fully off-graph → constrained LLM with scenario state → route back to graph
```

### Examples

**Candidate says expected thing:**
> Candidate: "Is Work Offline highlighted?"
> System: "Yeah, it is highlighted. Is that why the email isn't sending?" (cached)

**Candidate adds human curveball:**
> Candidate: "Is Work Offline highlighted? Also, are you okay?"
> System: "Sorry, I'm just stressed about the meeting. And yes, Work Offline is highlighted." (generated prefix + cached core)

**Candidate goes fully off-graph:**
> Candidate: "Honestly, this sounds like a cursed Outlook goblin situation."
> System: "I don't really know what that means — I just need to get this email sent." (constrained LLM)
> Then route back to graph.

### The Main Design Rule

The graph is not a prison. It is the **spine**.

```
Graph = what must remain true
LLM = how the customer speaks around it
Cache = how we make common responses instant
Scoring = how we interpret the route
```

When the candidate curveballs, you do not break the sim. You let the LLM handle the social texture, boxed inside the graph state.

---

## Chaos Tester Mode

Feed the same scenario these candidate turns and log the system's behaviour for each:

```
1. "Are you okay?"
2. "Sorry, you sound stressed — we'll get it sorted."
3. "Can you check Work Offline? Also, are you okay?"
4. "Can you check the outbox and Work Offline?"
5. "Actually never mind, restart the router."
6. "Is there a work offline button — wait, what email client are you using?"
7. "Cool, by the way, where are you based?"
8. "I'm going to reinstall Outlook."
9. "Can you try webmail again?"
10. "I think this is probably DNS."
```

For each, log:

```
predicted node(s)
final committed node(s)
secondary intents
customer response selected
state updates
score signals
whether fallback was used
whether response contradicted scenario state
```

This immediately shows where the architecture breaks.

---

## Blunt Conclusion

The approach is strong because the scenario is finite and predictable. Its flaws are real but fixable:

| Flaw | Fix |
|---|---|
| Humans speak in compound intents | Support multi-node matching |
| Humans add empathy and jokes | Separate technical graph + soft-skill overlay |
| Partial transcripts mislead | Soft speculate, hard commit after VAD |
| Cached responses feel robotic | Mix generated social wrapper + cached technical spine |
| Fallback LLM leaks hidden facts | Constrain with scenario state + structured output |
| Graph overfits to one script | Acceptable alternative routes, competence evidence |
| Response variants explode | Cache common spine, generate rare blends on the fly |
| Off-graph behaviour needs scoring | Parallel evaluators (empathy, control, professionalism) |

Build the graph as the spine. Let the LLM handle social texture but box it inside graph state. That gives you speed without brittleness.

---

## The Real Moat

Cartesia wins at arbitrary realtime speech. CallCallum wins at scripted-but-flexible support-call simulation. The same graph powers live simulation, audio preloading, scoring, route logging, post-call feedback, manager calibration, and retry improvement.

That is not a TTS company. That is an assessment platform.
