# CallCallum — Product Specification

> A controlled support-call simulator that trains and assesses IT support candidates.
> The customer has a hidden technical problem, a personality profile, a pressure meter, a finite scenario graph, cached/preloaded voice responses, controlled fallback for off-script behaviour, and route-logged scoring.
>
> This document is the complete build specification. No prior context required.

---

## What Is CallCallum?

CallCallum is a training and assessment platform for IT service desk candidates. A candidate joins a simulated support call. An AI plays the customer — who has a known technical problem, a personality, and a hidden set of facts the candidate must discover. The call is recorded, scored against a rubric, and a manager reviews the route the candidate took through the scenario.

Unlike a generic voice chatbot, CallCallum knows:

- What the customer's hidden technical problem is
- What the customer is scripted to feel
- What the candidate should discover
- What good and bad paths look like
- How to score every turn against a rubric
- How to give managers structured evidence, not vague impressions

---

## Architecture Overview

```
┌──────────────────────────────┐
│       Browser (Candidate)     │
│  Fake service desk screen     │
│  Call panel + ticket UI       │
│  WebRTC to LiveKit room       │
└──────────────┬───────────────┘
               │ WebRTC audio
               ▼
┌──────────────────────────────┐
│     LiveKit Server (SFU)      │
│  WebRTC audio relay           │
│  No AI — just moves audio     │
│  Go binary, CPU only          │
│  Self-hosted on your server   │
└──────────────┬───────────────┘
               │ WebRTC audio
               ▼
┌──────────────────────────────┐
│     Customer Worker (Agent)   │
│  Joins room as "customer"     │
│  Runs ScenarioGraph runtime   │
│  Runs Kokoro TTS              │
│  Runs pressure meter          │
│  Logs route events            │
└──────────────┬───────────────┘
               │ HTTP
               ▼
┌──────────────────────────────┐
│       CX-Train (Next.js)      │
│  Assessment management        │
│  Scenario/SimPack library     │
│  Route log storage            │
│  Scoring engine               │
│  Manager review dashboard     │
│  Callum assistant (Phase 4)   │
└──────────────────────────────┘
```

### Two Engines

**Live Sim Engine** — the real-time AI customer during the call. Fast, deterministic, scorable. Runs in a LiveKit room as an agent.

**Analysis Engine** — the offline process that evaluates the candidate afterwards. Compares actual route vs ideal route. Produces structured evidence for managers.

They are coupled: the live engine produces `routeLog` entries that make the analysis accurate without guessing. The analysis engine's findings feed back into better SimPacks.

---

## Tech Stack

| Layer | Technology | Reason |
|---|---|---|
| Product shell | Next.js / TypeScript | Existing platform for assessments, dashboards, scoring |
| Media transport | LiveKit (self-hosted Docker) | WebRTC rooms, barge-in, SIP-ready. Go binary, no GPU, runs on any VPS |
| Voice agent | LiveKit Agents SDK | Joins room as participant, handles audio in/out, built-in speech controls |
| Scenario engine | Custom TypeScript runtime | Intent matching, graph navigation, state, evidence, scoring. This is the IP |
| TTS | Kokoro 82M (self-hosted Docker) | Apache 2.0 license, 82M params, runs on CPU via ONNX, ~100-300ms per sentence |
| STT | External API (OpenRouter Whisper) | Reliable, no local GPU needed during prototype |
| LLM fallback | External API (OpenRouter GPT-4o-mini) | Only for ~5% of turns when the graph cannot match. Constrained by scenario state |
| Statecharts | XState (optional) | For visualization/debugging of scenario state, not the core runtime |
| Offline AI | LangGraph (Phase 4) | Callum assistant for SimPack generation, post-analysis, coaching |

### Will a 2-core / 4GB Hetzner Server Handle This?

| Service | Load |
|---|---|
| LiveKit server | Minimal (Go binary, efficient CPU/RAM) |
| Next.js | One Node process |
| ScenarioGraph runtime | Same Node process as Next.js |
| Kokoro cache playback | Filesystem read — near-zero |
| Kokoro live generation (rare) | ~300MB RAM, one CPU core, ~100-300ms |
| External STT / LLM | API calls — zero local load |

Yes. Runs comfortably during prototyping with 1 concurrent call.

---

## The SimPack

A SimPack is the compiled artefact that defines one assessment scenario. Every call runs from a SimPack.

### SimPack Schema

```
simpack/
  metadata (id, title, version, difficulty)
  customerProfile (name, role, mood, voice, patience, interruptions)
  technicalState (initial facts — what's broken, what works)
  interruptionPolicy (when and how the customer butts in)
  openingLine (first thing the customer says)
  graphNodes (array of ScenarioNodes — the conversation map)
  offGraphRoutes (deterministic redirects for off-topic/bizarre input)
  scoringRubric (weights per evidence tag and score signal)
  hiddenFacts (what the candidate must discover)
  allowedCustomerKnowledge (what the customer can reveal, and when)
  preloadManifest (audio files to pre-generate before the call)
```

### Customer Profile

The customer is not a static script. They react to candidate quality. This is controlled by a profile:

```json
{
  "id": "urgent_office_manager",
  "name": "Sarah Mitchell",
  "role": "Office Manager",
  "mood": "urgent",
  "voice": "bf_emma",
  "patienceStart": 45,
  "angerThreshold": 75,
  "interruptionStyle": "rushed",
  "interruptions": {
    "enabled": true,
    "minSecondsBeforeInterrupt": 4,
    "triggerPressureAbove": 70,
    "silenceMsBeforePrompt": 2500,
    "wrongPathInterrupt": true,
    "jargonInterrupt": true
  },
  "interruptLines": {
    "silence": "Hello? Are you still there?",
    "wrongPath": "I don't really have time for that — I just need this email sent.",
    "jargon": "I don't know what that means. Can you just tell me what to click?",
    "bizarre": "I'm not sure about that. I really need this sorting.",
    "repeated": "You already asked me that. What should I do next?"
  }
}
```

### Pressure Meter

The customer has a pressure meter that starts at `patienceStart` and goes up or down based on candidate behaviour.

**Pressure increases when the candidate:**
- wastes time, gives vague instructions, uses jargon
- says something bizarre, goes down the wrong path
- repeats themselves, ignores urgency
- is silent too long, asks irrelevant small talk
- fails to take ownership

**Pressure decreases when the candidate:**
- reassures clearly, explains simply, gives one instruction at a time
- shows progress, acknowledges urgency
- confirms impact, keeps control of the call

When pressure exceeds `triggerPressureAbove`, the customer interrupts with the matching interrupt line. The mechanic is fully deterministic — driven by score signals and evidence tags on the matched graph node.

### Difficulty Levels

Same scenario, different customer profile:

| Level | Patience | Hints | Interruptions |
|---|---|---|---|
| Beginner | High (70) | Direct: "I see a highlighted Work Offline button" | None |
| Intermediate | Medium (45) | Vague: "Something's highlighted at the top" | Occasional |
| Advanced | Low (25) | Frustrated: "I don't know where that is" | Frequent |

---

## Scenario Graph

The graph is a directed graph where each node represents a **candidate action**, not a line of dialogue. The route through the graph is the real transcript of competence.

### Graph Node

```json
{
  "id": "ask_work_offline_status",
  "stage": "diagnosis",
  "candidateIntent": "ask_work_offline_status",
  "exampleUtterances": [
    "Can you check if Work Offline is highlighted?",
    "Is the Work Offline button turned on?",
    "Can you look at Send/Receive and tell me if Work Offline is selected?"
  ],
  "preconditions": { "outlookOpen": true },
  "stateUpdates": { "workOfflineChecked": true, "workOfflineFound": true },
  "customerResponses": [
    {
      "key": "work_offline_is_on_rushed",
      "text": "Yeah, it is highlighted. Is that why this isn't sending?",
      "mood": "rushed",
      "priority": "high"
    },
    {
      "key": "work_offline_is_on_confused",
      "text": "Yeah, it's highlighted. I'm not sure what that means though.",
      "mood": "confused",
      "priority": "medium"
    }
  ],
  "evidenceTags": ["checked_work_offline"],
  "scoreSignals": { "technical": 2, "diagnosticOrder": 1 },
  "pressureDelta": -8,
  "nextLikelyNodes": ["disable_work_offline", "explain_work_offline", "send_test_email"],
  "badIfBefore": ["escalate_without_basic_checks", "reinstall_outlook"]
}
```

Key fields:
- `preconditions` — must be true in state for this node to be reachable
- `stateUpdates` — applied when the candidate hits this node
- `customerResponses` — variants by mood; one is selected based on current pressure
- `evidenceTags` — logged to the route for scoring
- `scoreSignals` — affect the candidate's technical/communication/call-control/professionalism scores
- `pressureDelta` — how much the customer's pressure changes when the candidate takes this action
- `badIfBefore` — if any of these nodes were visited before this one, it is a negative signal

### Off-Graph Route

Bizarre or off-topic utterances are not panic fallbacks. They are first-class routes with deterministic responses, score signals, and evidence tags:

```json
{
  "id": "off_topic_bizarre",
  "exampleUtterances": ["aliens", "ghosts", "cursed", "government conspiracy"],
  "customerResponses": [
    {
      "key": "redirect_bizarre_rushed",
      "text": "I'm not sure about that. I really need this email sorted before my meeting.",
      "mood": "rushed"
    }
  ],
  "scoreSignals": { "professionalism": -2, "callControl": -1 },
  "pressureDelta": 15,
  "nextLikelyNodes": ["problem_restatement", "ask_outbox_status"]
}
```

### Compound Intents

A single candidate utterance can trigger multiple nodes and soft-skill modifiers:

```json
{
  "matchType": "compound",
  "primaryNodes": ["ask_work_offline_status"],
  "secondaryIntent": "empathy_check",
  "responseKey": "work_offline_plus_acknowledge_stress",
  "responseText": "I'm just stressed because of this meeting. And yes, Work Offline is highlighted.",
  "evidenceTags": ["checked_work_offline", "showed_empathy"],
  "stateUpdates": { "workOfflineFound": true },
  "scoreSignals": { "technical": 2, "communication": 1 },
  "pressureDelta": -6
}
```

### Response Taxonomy

Every candidate intent falls into one of these categories:

```
opening
identity_verification
rapport_small_talk
impact_scope
symptom_clarification
basic_check
diagnostic_action
resolution_action
customer_reassurance
expectation_setting
escalation
closure
handover
off_path_bizarre
off_path_unprofessional
off_path_irrelevant_small_talk
unsafe_or_bad_action
```

---

## Live Sim Engine Detail

### VoiceAgentRAG Dual-Agent Pattern

Two loops run concurrently:

**Slow Reader / Predictor** (background, after every turn):
- Takes current node + scenario state + candidate progress + customer mood
- Predicts likely next candidate intents with probabilities
- Preloads response audio/text into a fast cache
- Updates the preload manifest for the next few turns

**Fast Talker / Runtime** (per utterance):
- Receives partial transcript as the candidate speaks
- Collapses possible graph nodes word by word
- Selects cached/preloaded response when confident
- Plays audio instantly (or generates on-the-fly for rare cases)
- Logs the route event to CX-Train

### Runtime Loop (Complete)

```
1. Candidate joins LiveKit room. Customer agent joins as "customer".
2. Customer plays opening line from SimPack (preloaded audio).
3. Candidate speaks.
4. LiveKit sends audio frames to agent.
5. Agent sends audio to external STT API.
6. Partial transcripts arrive word by word:
   a. Intent matcher runs against partial text (keyword → phrase → embedding)
   b. Graph probability engine narrows possible nodes
   c. Slow Reader preloads likely response audio into buffer
7. Final transcript arrives (VAD end-of-speech):
   a. Intent matcher hard-commits with confidence score
   b. If high confidence + single node: play cached audio
   c. If high confidence + compound: play generated prefix + cached core
   d. If off-graph route matched: play deterministic redirect
   e. If low confidence: constrained LLM fallback
8. Customer decision object is built:
   - matchedNodes, evidenceTags, scoreSignals, stateUpdates, pressureDelta
9. Selected audio plays into LiveKit room.
10. Route event saved to CX-Train.
11. Slow Reader predicts next likely nodes and preloads their audio.
12. Repeat from step 3 until candidate ends call or issue is resolved.
```

### Word-by-Word Graph Collapsing

Candidate says: *"Can you check if the Work Offline button is highlighted?"*

| Partial Transcript | Action |
|---|---|
| "Can you..." | 40% of graph possible |
| "Can you check..." | Collapse to diagnostic nodes (~15) |
| "Can you check if..." | Narrow to state-inspection actions |
| "Can you check if the Work..." | Likely Outlook / Work Offline |
| "Can you check if the Work Offline..." | **Commit**: `ask_work_offline_status` |

Before the sentence even ends: the response key is selected, audio is in the buffer. At VAD end: `audio.play()`. TTS is never in the hot path.

### Soft Prediction vs Hard Commit

| During Speech | After VAD End-of-Speech |
|---|---|
| 0.30-0.60 confidence: preload broad branch | >0.70 confidence: commit and play cached |
| 0.60-0.85 confidence: preload specific node | 0.50-0.70 confidence: use template |
| 0.85+ confidence: prepare response in buffer | <0.50 confidence: LLM fallback |

### Four-Layer Intent Matcher

| Layer | Method | Speed | Typical Coverage |
|---|---|---|---|
| 1 | Keyword / regex match | ~0ms | ~40% |
| 2 | Partial phrase pattern match | ~2ms | ~25% |
| 3 | Embedding similarity (sentence-transformers) | ~10ms | ~25% |
| 4 | LLM fallback | ~200-500ms | ~10% |

### Three Response Layers

| Layer | Trigger | Latency | Typical % |
|---|---|---|---|
| **Cached audio** | High-confidence single-node match | ~0ms | ~55% |
| **Generated prefix + cached core** | Compound or secondary intent | ~300-600ms | ~25% |
| **Deterministic redirect** | Off-graph route match | ~0ms | ~10% |
| **Constrained LLM** | No match at all | ~800-2000ms | ~10% |

For the generated prefix case, Kokoro renders the short emotional opener (~100ms) and the cached core plays immediately after, assembled in the audio buffer.

---

## The Decision Object

Every turn produces this. The audio is just how the candidate experiences it — this object is what matters for scoring:

```typescript
type CustomerDecision = {
  matchedNodes: string[];
  primaryIntent: string;
  softSkillModifiers: string[];
  redFlags: string[];
  customerResponseText: string;
  responseMode: "cached" | "cached_plus_generated" | "redirect" | "fallback";
  audioCacheKey?: string;
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

---

## Route Log

Every turn produces a route event — this is the fundamental unit of analysis:

```json
{
  "turnId": "turn_004",
  "candidateText": "Can you check if the Work Offline button is highlighted?",
  "partialMatches": [
    { "partial": "Can you check if...", "intent": "diagnostic_action", "confidence": 0.3 },
    { "partial": "check if the Work...", "intent": "ask_work_offline_status", "confidence": 0.6 },
    { "partial": "Work Offline button", "intent": "ask_work_offline_status", "confidence": 0.91 }
  ],
  "matchedNodes": ["ask_work_offline_status"],
  "secondaryIntents": [],
  "matchConfidence": 0.91,
  "responseKey": "work_offline_is_on_rushed",
  "responseSource": "cached",
  "stateBefore": { "outboxChecked": true, "workOfflineFound": false, "pressure": 52 },
  "stateAfter": { "outboxChecked": true, "workOfflineFound": true, "pressure": 44 },
  "evidenceTags": ["checked_work_offline", "followed_diagnostic_path"],
  "scoreSignals": { "technical": 2, "diagnosticOrder": 1 },
  "missedEarlierNodes": ["ask_internet_status"],
  "nextLikelyNodes": ["disable_work_offline", "send_test_email", "explain_work_offline"]
}
```

### Post-Call Analysis

The full route log enables: `actual route vs ideal route vs acceptable alternatives vs bad branches taken`

The manager review page shows per-turn analysis:

```
Turn 1: Candidate asked problem summary. Good.
Turn 2: Candidate checked internet but not webmail. Okay.
Turn 3: Candidate used jargon; customer pressure rose to 65. Communication issue.
Turn 4: Candidate identified Work Offline. Strong diagnostic action.
Turn 5: Candidate confirmed test send. Resolved.
```

---

## Kokoro TTS Strategy

Kokoro-82M is self-hosted via Docker using `hwdsl2/docker-kokoro`, which provides an OpenAI-compatible API:

```bash
docker run -d -p 8080:80 hwdsl2/kokoro
```

Usage split:

| Usage | When | Frequency |
|---|---|---|
| Pre-generate graph responses | Before call starts (batch) | ~50-200 utterances per SimPack |
| Generate emotional prefix | Live, compound intent | ~25% of turns |
| Full fallback synthesis | Live, no graph match | ~10% of turns |

Point your app at `http://localhost:8080/v1/audio/speech` instead of OpenRouter. On a 2-core/4GB Hetzner box, Kokoro uses ~300MB RAM and one CPU core — handles concurrent pre-generation and the occasional live fallback.

---

## LiveKit Integration

### Why Add It Now

- One-call-at-a-time means zero migration cost
- MediaRecorder + HTTP blobs is a dead end you will replace anyway
- LiveKit gives real WebRTC call feel, barge-in (`allow_interruptions`), room-per-attempt isolation, and future SIP/telephony from day one
- Self-hosted LiveKit server is free software, runs as a Docker container, uses minimal resources

### How It Connects

```
1. CX-Train creates assessment
2. CX-Train creates LiveKit room + access token via LiveKit API
3. Candidate browser joins room (WebRTC)
4. Customer agent (LiveKit Agent SDK) joins same room as participant "Sarah Mitchell"
5. Agent receives candidate audio, sends to STT API
6. Agent runs ScenarioGraph → selects response
7. Agent plays response audio (from cache or Kokoro) into room
8. Agent sends route event to CX-Train via HTTP
```

### LiveKit Agents vs Pipecat

| Approach | Pros | Cons |
|---|---|---|
| **LiveKit Agents** | Fewer moving parts, built-in `session.say()`, `allow_interruptions`, agent sessions | Less flexible for custom voice pipelines |
| **Pipecat + LiveKitTransport** | More flexible pipeline, native KokoroTTSService, VAD/STT/TTS orchestration | Extra Python service, more infra |

**Start with LiveKit Agents.** The hard problem is the ScenarioGraph + scoring + pressure meter, not the voice pipeline. Add Pipecat in Phase 3 if you need custom VAD or streaming STT integration.

---

## Initial Hardcoded Graph: Outlook Work Offline

This is the first SimPack to build. It has 12-15 nodes covering a support call for "Outlook not sending email — hidden cause is Work Offline mode."

### Graph Nodes

```
 1. opening                          — Customer states problem
 2. identity_verification            — Candidate asks who they are
 3. ask_problem_summary              — Candidate clarifies issue
 4. ask_error_message                — Candidate asks about errors
 5. ask_outbox_status                — Candidate checks Outbox
 6. ask_internet_status              — Candidate checks internet
 7. ask_webmail_status               — Candidate isolates scope
 8. ask_send_receive_status          — Candidate checks Send/Receive
 9. ask_work_offline_status          — Candidate checks Work Offline  ← KEY
10. disable_work_offline             — Candidate instructs fix
11. send_test_email                  — Candidate verifies resolution
12. confirm_resolution               — Candidate confirms issue fixed
13. small_talk                       — Empathy / rapport (scored by quality)
14. bad_reinstall_outlook            — Candidate jumps to reinstall
15. bad_escalate_too_early           — Candidate escalates without basic checks
16. off_topic_bizarre                — Candidate says something bizarre
```

### Delivery Template System (for Varied Responses)

To avoid robotic repetition, responses are assembled from templates at runtime. This produces natural variation without caching 50 variants per node:

```json
{
  "nodeId": "ask_work_offline_status",
  "content": "Work Offline is highlighted",
  "deliveryTemplates": [
    "[filler] [hedge] [content].",
    "Yeah, [filler] [content] [tag].",
    "[content] [secondThought]."
  ],
  "fillerPool": ["erm", "yeah", "well", "okay so", "uh", "right yeah"],
  "hedgePool": ["I think", "it looks like", "I can see that"],
  "secondThoughtPool": ["Is that bad?", "What does that mean exactly?"],
  "tagPool": ["if that helps", "apparently", "I think"],
  "moodModifiers": {
    "neutral": { "speed": 1.0, "fillers": "low" },
    "frustrated": { "speed": 1.1, "fillers": "none" },
    "hesitant": { "speed": 0.85, "fillers": "high" },
    "relieved": { "speed": 0.95, "fillers": "low" }
  }
}
```

At runtime: select template, pick random filler/hedge/tag based on mood, assemble, send to Kokoro for synthesis.

---

## Failure Modes (Built-In Defences)

| Failure Mode | Defence |
|---|---|
| Premature commitment | Soft speculate during speech, hard commit after VAD |
| Multi-intent utterances | Support compound node matching |
| Human warmth treated as noise | Separate technical graph + soft-skill overlay |
| Curveball at end of sentence | Compound intents (primary + secondary) |
| Cache combinatorial explosion | Cache common spine only, generate rare blends on the fly |
| LLM fallback breaks character | Constrain with scenario state + structured JSON output |
| Off-graph turns need scoring | Off-graph routes are first-class with evidence tags |
| Partial transcript false positives | Confidence thresholds, final transcript confirmation |
| System feels too scripted | Delivery template system for natural variation |
| Interruptions | LiveKit native `allow_interruptions` + pressure meter |
| Graph overfits to one path | Acceptable alternative routes as first-class nodes |
| Happy path hides bad reasoning | Quality dimensions per node (timing, justification, explanation) |
| Zero-latency feels robotic | Intentional latency (200ms-2s) based on response type |
| State inconsistency | Technical state is authoritative; responses cannot contradict it |
| Small talk derails assessment | Bounded by customer mood; rushed customer pulls back to task |

---

## Product Behaviour Examples

These show the system handling real candidate behaviour across the technical + social spectrum.

### Efficient candidate
> Candidate: "Can you check if webmail works?"
> Customer: "Yes, webmail loads fine."
> Pressure: -5 | Score: good scope isolation

### Empathetic candidate
> Candidate: "I know this is stressful before a meeting, I'll keep this quick."
> Customer: "Thanks, I appreciate it."
> Pressure: -10 | Score: communication + ownership

### Jargon-heavy candidate
> Candidate: "Could be DNS, maybe the router, maybe Microsoft, maybe profile corruption..."
> Customer interrupts: "Sorry, I don't really know what that means. What do you need me to do?"
> Pressure: +15 | Score: jargon / poor call control

### Bizarre candidate
> Candidate: "Maybe aliens got into Outlook."
> Customer: "I'm not sure about that. I really need this sorting."
> Pressure: +20 | Score: professionalism red flag | State: unchanged

### Compound turn (technical + empathy)
> Candidate: "Can you check Work Offline? Also, are you okay? You sound stressed."
> Customer: "I'm just stressed because of this meeting. And yes, Work Offline is highlighted."
> Pressure: -6 | Score: empathy + correct diagnostic action

---

## Build Phases

### Phase 1 — LiveKit + Hardcoded Graph (Now)

One working scenario with real-time voice over WebRTC, cached responses, pressure meter, route logging.

**CX-Train changes:**
- Create assessment attempt → LiveKit room
- Fake service desk screen in browser (call panel + ticket UI)
- Join room as candidate via WebRTC

**Customer worker (LiveKit Agent):**
- Join room as "customer" participant
- Load hardcoded Outlook Work Offline graph
- Run 4-layer intent matcher
- Play cached Kokoro audio on graph match
- Use constrained LLM fallback for off-graph
- Run pressure meter with deterministic interruptions
- Log route events to CX-Train

**Infrastructure:**
- Self-hosted LiveKit server (Docker)
- Self-hosted Kokoro (Docker)
- External STT (OpenRouter Whisper)
- External LLM (OpenRouter GPT-4o-mini)

**Analysis:**
- Route log persisted to database
- Basic manager review page: path, pressure curve, red flags, score signals

**Files to create:**
```
lib/mvp/sim-graph/types.ts              — all TypeScript types
lib/mvp/sim-graph/outlook-work-offline.ts — hardcoded 12-node graph
lib/mvp/sim-graph/match-intent.ts        — 4-layer intent matcher
lib/mvp/sim-graph/preload-manifest.ts    — Slow Reader / predictor
lib/mvp/sim-graph/runtime.ts             — Fast Talker loop
lib/mvp/sim-graph/route-log.ts           — route event persistence
lib/mvp/sim-graph/customer-profile.ts    — pressure meter + interruptions
lib/mvp/sim-graph/delivery-templates.ts  — response variation engine
lib/mvp/voice/livekit-room.ts            — room creation + token generation
lib/mvp/voice/customer-worker.ts         — LiveKit agent entrypoint
```

### Phase 2 — ScenarioGraph Compiler

- Callum (LangGraph assistant) generates graph from manager's plain-language description
- Graph editor UI for manager review and approval
- Multiple SimPacks, versioning, difficulty tiers

### Phase 3 — Pipecat (If Needed)

- Replace minimal LiveKit agent with Pipecat voice pipeline
- Native KokoroTTSService integration
- Custom VAD for faster partial transcript detection
- Streaming STT directly into intent matcher
- Real-time latency instrumentation dashboard

### Phase 4 — Callum Intelligence

- LangGraph-based post-call analysis
- Manager calibration assistant
- Retry coaching recommendations
- Alternative route suggestions
- Training recommendation engine

---

## Key Engineering Decisions

| Decision | Choice | Rationale |
|---|---|---|
| LiveKit now or later | **Now** | One call at a time, no migration cost. MediaRecorder + HTTP is a dead end. |
| Pipecat or LiveKit Agents | **LiveKit Agents first** | Fewer moving parts for MVP. Pipecat later if pipeline flexibility is needed. |
| Kokoro streaming or cache | **Pre-generate cache** | 80%+ of turns are predictable. Kokoro only synthesises for rare cache misses. |
| Graph language | **TypeScript** | Same stack as CX-Train. No separate Python service needed for the graph. |
| LLM in hot path? | **No** | Only for ~5% of turns. Constrained by scenario state + structured output. |
| Emotion recognition | **No** | Pressure meter + evidence tags are deterministic and manager-useful. No "73% anxious." |
| Off-topic handling | **Graph routes (not LLM)** | Off-topic is a first-class deterministic route with evidence tags. |
| Candidate interruptions | **LiveKit native** | `allow_interruptions` per response line. |
| Customer interruptions | **Pressure meter** | Deterministic threshold, triggered by score signals, not random. |
| Response variation | **Delivery templates** | Not cached files. Templates + fillers produce infinite variation at ~KB scale. |

---

## The Moat

Generic voice AI companies solve: *"Say any text in a natural voice quickly."*

CallCallum solves: *"Did this IT support candidate competently handle a frustrated customer whose Outlook was stuck in Work Offline mode while a meeting deadline loomed?"*

The same graph powers live simulation, audio preloading, scoring, route logging, post-call feedback, manager calibration, and retry improvement. Every call produces structured evidence that no generic model can produce because no generic model knows the hidden facts, the expected path, the rubric, or the customer's scripted emotional state.

**That is not a TTS company. That is an assessment platform.**

Cartesia gives voices. CallCallum gives judgement.
