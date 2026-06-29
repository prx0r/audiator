# Audiator — Product Specification

> The definitive build plan. Distilled from `propositions.md` and `propositions2.md`.
> Architecture: LiveKit room + ScenarioGraph + customer pressure meter + Kokoro cache + route-as-evidence scoring.

---

## Core Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    CX-Train / Next.js                    │
│  Product shell, manager dashboard, scoring, route logs   │
└──────────────┬───────────────────────────────┬───────────┘
               │ LiveKit room                    │ HTTP/events
               │ per assessment                  │
               ▼                                 ▼
┌──────────────────────────────┐    ┌──────────────────────────┐
│     LiveKit Server (SFU)     │    │    Customer Worker        │
│  WebRTC audio relay, no AI   │    │  Joins room as "customer" │
│  Go binary, CPU only         │    │  Runs ScenarioGraph       │
└──────────────┬───────────────┘    │  Runs Kokoro TTS          │
               │                    │  Runs pressure meter      │
               ▼                    │  Logs route events        │
┌──────────────────────────────┐    └──────────────────────────┘
│    Browser (Candidate)        │
│  Fake service desk screen     │
│  Call panel + ticket UI       │
│  WebRTC to LiveKit room       │
└──────────────────────────────┘
```

### Two Engines, One Product

**Live Sim Engine** — the real-time conversational AI that plays the customer during a training call. Fast, controllable, deterministic, scorable.

**Analysis Engine** — the offline process that evaluates the candidate after the call. Thorough, evidence-backed, manager-useful.

They are not separate. The live sim engine produces structured data (`routeLog`) that makes the analysis engine accurate without guessing. The analysis engine's findings feed back into better sim packs.

---

## Tech Stack

| Layer | Technology | Why |
|---|---|---|
| Product | Next.js / CX-Train | Existing product shell, manager dashboard, assessments, scoring |
| Media transport | LiveKit (self-hosted) | WebRTC rooms, barge-in, future SIP. Go binary, no GPU, runs on Hetzner |
| Voice pipeline | LiveKit Agents (start) → Pipecat (later) | LiveKit Agents has fewer moving parts; Pipecat adds pipeline flexibility when needed |
| Scenario intelligence | Custom TypeScript ScenarioGraph runtime | Intent matching, graph navigation, state, evidence, scoring. Your IP |
| TTS | Kokoro 82M (self-hosted Docker, CPU) | Apache 2.0, 100-300ms per sentence, ~300MB RAM, runs on 2-core box |
| STT | External API (OpenRouter Whisper) | Local STT would stress CPU during prototype |
| LLM fallback | External API (OpenRouter GPT-4o-mini) | Only for ~5% of turns. Constrained by scenario state |
| Statecharts | XState (optional, viz/debug) | Not the core runtime |
| Offline agentic | LangGraph (Phase 4) | Callum assistant, pack generation, post-analysis only |

### Will the Hetzner 2-core / 4GB handle it?

| Service | Load |
|---|---|
| LiveKit server | Minimal (Go) |
| Next.js | One Node process |
| ScenarioGraph | Same Node process |
| Kokoro cache playback | Filesystem read |
| Kokoro generation (occasional) | ~300MB RAM, one CPU core |
| External STT | API call — no local load |
| External LLM | API call — no local load |

Yes. Runs fine during prototyping.

---

## Live Sim Engine

### VoiceAgentRAG Dual-Agent Pattern

**Slow Reader / Predictor** (background, after every turn):
- Understands whole call state
- Predicts likely next candidate actions
- Preloads response audio/text into cache
- Updates scenario probabilities

**Fast Talker / Runtime** (per utterance):
- Listens to partial transcript
- Collapses graph nodes word by word
- Selects cached/preloaded response
- Plays audio (or generates on-the-fly for rare cases)
- Logs route event

### Runtime Loop

```
1. Listen to candidate audio (LiveKit room)
2. Receive partial transcript (streaming STT)
3. Predict likely graph node while candidate is speaking
4. Preload likely response audio
5. On final transcript, hard-commit:
   - technical intent(s)
   - soft-skill modifier(s)
   - red flags
   - state update
   - pressure delta
6. Decide response layer:
   - cached audio (80%)
   - cached audio + generated emotional prefix (15%)
   - deterministic redirect (off-graph route)
   - constrained LLM fallback (5%)
7. Play response into LiveKit room
8. Save route event to CX-Train
```

### Word-by-Word Graph Collapsing

Candidate: *"Can you check if the Work Offline button is highlighted?"*

| Partial | Action |
|---|---|
| "Can you..." | 40% of graph still possible |
| "Can you check..." | Collapse to diagnostic nodes (~15) |
| "Can you check if..." | State-inspection actions |
| "Can you check if the Work..." | Likely Outlook / Work Offline |
| "Can you check if the Work Offline..." | **Commit**: `ask_work_offline_status` |

Before sentence ends: response key selected, audio loaded into buffer. At VAD end: `audio.play()`. TTS never in the hot path.

### Soft Prediction vs Hard Commit

| During Speech | After VAD |
|---|---|
| Soft predict, preload broad branch at 0.30-0.60 confidence | Hard commit only if confidence > 0.7 |
| Preload likely node at 0.60-0.85 | If below threshold → template → LLM |
| Prepare response at 0.85+ | Play selected audio, log route event |

### Intent Matcher (4-Layer)

| Layer | Method | Speed | Coverage |
|---|---|---|---|
| 1 | Keyword/regex | ~0ms | ~40% |
| 2 | Partial phrase patterns | ~2ms | ~25% |
| 3 | Embedding similarity | ~10ms | ~25% |
| 4 | LLM fallback | ~200-500ms | ~10% |

### Response Layers

| Layer | Trigger | Latency | % Turns |
|---|---|---|---|
| **Cached audio** | High-confidence graph match | ~0ms | ~55% |
| **Generated prefix + cached core** | Compound intent detected | ~300-600ms | ~25% |
| **Deterministic redirect** | Off-graph route matched | ~0ms | ~10% |
| **Constrained LLM** | No graph match | ~800-2000ms | ~10% |

---

## Scenario Graph

### Graph Node

Each node represents a **candidate action**, not a line of dialogue.

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

### Off-Graph Route

Bizarre/off-topic utterances are first-class routes, not panic fallbacks:

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

A single utterance can trigger multiple nodes + soft-skill modifiers:

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

## Customer Profile & Pressure Meter

The customer is not a static script. They **react** to candidate quality.

### Profile

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

Pressure increases when the candidate:
- wastes time, gives vague instructions, uses jargon
- says something bizarre, goes down wrong path
- repeats themselves, ignores urgency
- silent too long, irrelevant small talk
- fails to take ownership

Pressure decreases when the candidate:
- reassures clearly, explains simply
- gives one instruction at a time
- shows progress, acknowledges urgency
- confirms impact, keeps call control

Customer butts in when pressure exceeds `triggerPressureAbove`. The mechanic is deterministic — driven by graph node score signals and evidence tags.

### Difficulty Levels

| Level | Customer Profile | Hints |
|---|---|---|
| Beginner | High patience, direct hints, no interruptions | "I can see a Work Offline button highlighted" |
| Intermediate | Moderate patience, vague hints, occasional interruptions | "Something's highlighted at the top, not sure what" |
| Advanced | Low patience, frustrated, interrupts frequently | "I don't know where that is, can you be specific?" |

---

## Route Log: The Analysis Substrate

Every turn produces a structured event. The route through the graph is the real transcript of competence.

```json
{
  "turnId": "turn_004",
  "candidateText": "Can you check if the Work Offline button is highlighted?",
  "partialMatches": [
    { "partial": "Can you check if...", "matchedIntent": "diagnostic_action", "confidence": 0.3 },
    { "partial": "check if the Work...", "matchedIntent": "ask_work_offline_status", "confidence": 0.6 },
    { "partial": "Work Offline button", "matchedIntent": "ask_work_offline_status", "confidence": 0.91 }
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

The route log enables:

```
actual route vs ideal route vs acceptable alternative routes vs bad branches taken
```

Manager review shows:

```
Turn 1: Candidate asked problem summary. Good.
Turn 2: Candidate checked internet but not webmail. Okay.
Turn 3: Candidate used jargon; customer pressure rose to 65. Communication issue.
Turn 4: Candidate identified Work Offline. Strong diagnostic action.
Turn 5: Candidate confirmed test send. Resolved.
```

---

## The Decision Object

Every turn produces this — the audio is just how the candidate experiences it:

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

## Failure Modes & Fixes

| Flaw | Fix |
|---|---|
| Premature commitment | Soft speculate during speech, hard commit after VAD |
| Multi-intent utterances | Support compound node matching |
| Human warmth treated as noise | Separate technical graph + soft-skill overlay |
| Curveball at end of sentence | Compound intents (primary + secondary) |
| Cache combinatorial explosion | Cache common spine only, generate rare blends on the fly |
| LLM fallback breaks character | Constrain with scenario state + structured output |
| Off-graph turns need scoring | Parallel evaluators + off-graph routes |
| Partial transcript false positives | Confidence thresholds, final transcript confirmation |
| System feels too scripted | Multiple response variants per node, rotated by mood |
| Interruptions hard | LiveKit native `allow_interruptions` + pressure meter |
| Graph overfits to preferred script | Acceptable alternative routes, competence evidence not single path |
| Happy path hides bad reasoning | Quality dimensions per node (timing, justification, explanation) |
| Zero-latency responses feel robotic | Intentional latency 200ms-2s based on response type |
| State inconsistency | Technical state is authoritative, responses must not contradict |
| Small talk derails assessment | Bounded by customer mood; rushed customer pulls back to task |

---

## Simpack Schema

```
simpack/
  metadata (id, title, version, created)
  customerProfile (name, role, mood, voice, patience, angerThreshold, interruptionStyle)
  technicalState (initial facts: internetWorks, webmailWorks, etc.)
  interruptionPolicy (enabled, thresholds, interrupt lines per trigger)
  openingLine (first customer message)
  graphNodes (array of ScenarioNode)
  offGraphRoutes (deterministic redirects for off-topic)
  scoringRubric (weights per evidence tag / score signal)
  hiddenFacts (what candidate must discover)
  allowedCustomerKnowledge (what customer can reveal at each state)
  difficulty (beginner / intermediate / advanced)
  preloadManifest (audio keys to pre-generate before call)
```

---

## Build Phases

### Phase 1 — LiveKit + Hardcoded Graph (Now)

Goal: One working scenario with real-time voice over WebRTC, cached responses, route logging.

```
CX-Train:
- Create assessment attempt → LiveKit room
- Fake service desk screen in browser (call panel + ticket UI)
- Join room as candidate

Customer Worker:
- Join same room as "customer"
- Load hardcoded Outlook Work Offline graph (12-15 nodes)
- Run 4-layer intent matcher
- Play cached Kokoro audio on graph match
- Constrained LLM fallback for off-graph
- Log route events

Infrastructure:
- Self-hosted LiveKit server (Docker)
- Self-hosted Kokoro (Docker, API-compatible)
- External STT (OpenRouter Whisper)
- External LLM (OpenRouter GPT-4o-mini)

Customer Profile:
- Urgent office manager
- Pressure meter with deterministic interruption
- Intolerance for jargon, wrong path, silence

Analysis:
- Route log persisted to CX-Train
- Basic review page: path through graph, pressure curve, red flags
```

**Deliverables:**
```
lib/mvp/sim-graph/types.ts                 — all types
lib/mvp/sim-graph/outlook-work-offline.ts   — hardcoded graph
lib/mvp/sim-graph/match-intent.ts           — 4-layer matcher
lib/mvp/sim-graph/preload-manifest.ts       — Slow Reader
lib/mvp/sim-graph/runtime.ts                — Fast Talker loop
lib/mvp/sim-graph/route-log.ts              — persistence
lib/mvp/sim-graph/customer-profile.ts       — pressure meter
lib/mvp/voice/livekit-room.ts               — room creation
lib/mvp/voice/customer-worker.ts            — LiveKit agent
```

### Phase 2 — ScenarioGraph Compiler

Goal: Multiple sim packs, Callum generates graph from manager script.

```
- Manager describes scenario in plain language
- Callum/LangGraph compiles to ScenarioGraph JSON
- Graph editor UI for approval / refinement
- Multiple sim packs available
- Graph versioning
```

### Phase 3 — Pipecat (If Needed)

Goal: More control over voice pipeline.

```
- Pipecat voice worker replaces minimal LiveKit agent
- KokoroTTSService (native Pipecat support)
- Custom VAD
- Latency dashboard
- Streaming STT integrated
```

### Phase 4 — Callum Intelligence

Goal: Offline analysis, coaching, recommendations.

```
- LangGraph-based post-call analysis
- Manager calibration assistant
- Retry coaching
- Alternative route suggestions
- Training recommendation engine
```

---

## Key Decisions

| Decision | Choice | Rationale |
|---|---|---|
| LiveKit now or later | **Now** | One call at a time, no migration cost. MediaRecorder+HTTP is a dead end. |
| Pipecat or LiveKit Agents | **LiveKit Agents first** | Fewer moving parts. Add Pipecat if pipeline flexibility is needed later. |
| Kokoro streaming or cache | **Cache (pre-generate)** | 80%+ of turns are predictable. Kokoro only generates for rare cache misses. |
| Graph language | **TypeScript** | Same language as CX-Train. No Python service needed for the graph. |
| LLM in hot path? | **No** | Only for ~5% of turns. Constrained by scenario state. |
| Emotion recognition | **No** | Pressure meter + evidence tags are deterministic and manager-useful. No "73% anxious." |
| Graph or LLM fallback for off-topic | **Graph** | Off-topic routes are first-class (aliens → deterministic redirect + evidence). |
| Candidate audio interruptions | **LiveKit native** | `allow_interruptions` per response line. |
| Customer interruptions | **Pressure meter** | Deterministic — triggered by score signals, not random. |

---

## Product Behaviour Examples

### Efficient candidate
> Candidate: "Can you check if webmail works?"
> Customer: "Yes, webmail loads fine."
> Pressure: -5 | Score: good scope isolation | Missed: nothing

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

## The Actual Moat

Cartesia wins at arbitrary realtime speech. CallCallum wins at scripted-but-flexible support-call simulation.

The same graph powers:
- Live simulation
- Audio preloading
- Scoring
- Route logging
- Post-call feedback
- Manager calibration
- Retry improvement

That is not a TTS company. That is an assessment platform.

**The moat is scenario-aware behavioural analysis of MSP support behaviour + manager calibration + structured evidence + training recommendations.**

Cartesia gives voices. CallCallum gives judgement.
