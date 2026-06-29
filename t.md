# Build & Test Results

## Environment
- 2 cores, 4GB RAM, no GPU
- Could not install `@huggingface/transformers` (ONNX runtime GPU package OOM)
- Tried OpenRouter embedding API → scores too clustered (all utterances about Outlook)
- Used `natural` with **per-utterance TfIdf + log-normalized TF** (pure JS, 10.9k ★)

## What Changed

### Files modified:
- `lib/mvp/sim-graph/types.ts` — added `previousQueries` field to `ScenarioState`
- `lib/mvp/sim-graph/outlook-work-offline.ts` — added `previousQueries: {}` to initial state; updated identity_verification response to include company ("head office")
- `lib/mvp/sim-graph/runtime.ts` — wired in new per-utterance TfIdf matcher + smart repeat detection
- `lib/mvp/sim-graph/match-intent.ts` — replaced old n-gram matcher with new per-utterance TfIdf
- `app/api/chat/route.ts` — no changes needed (stays sync)
- `tests/sim-graph.runtime.test.ts` — updated assertions
- `tests/sim-graph.match-intent.test.ts` — updated to new sync API

### Files created:
- `lib/mvp/sim-graph/embedding-matcher.ts` — per-utterance TfIdf matcher + `isGenuineRepeat()`
- `lib/mvp/sim-graph/embedding-api.ts` — OpenRouter embedding API (attempted, removed)
- `app/api/debug/` — debug endpoint (removed)

### Files removed:
- `lib/mvp/sim-graph/embedding-api.ts` — not needed (OpenRouter embeddings too clustered)

## Why OpenRouter Embeddings Didn't Work
- All node example utterances are about "Outlook troubleshooting" → embedding vectors cluster together
- Cosine similarities all in range 0.38–0.51 → no clear winner
- Would need fine-tuning or a classifier on top to work properly
- API latency added 200-400ms per request

## Root Cause
1. **N-gram keyword overlap** — "which company though" matched `identity_verification` because "company" was in keywordHints, even though it was a follow-up
2. **Aggressive repeat penalty** — any revisit of a node ID triggered "You already asked me that" + pressure penalty
3. **Term frequency inflation** — "outlook" appearing 10× in `bad_reinstall_outlook`'s concatenated examples inflated its score (original TfIdf)
4. **Missing info** — identity_verification response didn't include the company

## Fix
### 1. Per-utterance TfIdf with log-normalized TF (replaces both n-gram and doc-level TfIdf)
- Each example utterance is a separate document → no word can inflate a node's score by repetition
- Uses `log(1 + tf)` normalization to dampen term frequency effects
- Scores each utterance independently → takes max per node → nodes ranked by best-utterance match

### 2. Smart repeat detection
- Tracks `previousQueries` per node (actual text of each turn)
- `isGenuineRepeat()` uses Jaccard similarity between current and last query for same node
- If similarity < 0.4 → new question → no repeat penalty
- If similarity >= 0.4 → actual repeat → penalty applies

### 3. Better identity_verification response
- Now: "It's Sarah Mitchell — office manager at our head office."
- Includes company context so follow-ups are answered

## Test Results
- **27/27 tests pass**
- "Which company though?" after identity verification → **NOT treated as repeat** (Jaccard sim = 0.17)
- Literal repeats still correctly caught (Jaccard sim = 1.0)
- Timeline question ("when did it stop working?") → **no longer matches `bad_reinstall_outlook`**
- Full happy path (11 turns) completes without loops

## Live API Test (3-turn flow)
```
Turn 1: identity_verification → "It's Sarah Mitchell — office manager at our head office."
Turn 2: identity_verification → "It's Sarah Mitchell — office manager at our head office."  (no loop)
Turn 3: ask_webmail_status → "Webmail loads fine..." (not bad_reinstall_outlook)
```

## Added dependency
- `natural@8.1.1` — pure JS NLP library (TfIdf, tokenizer, distance metrics)
- Zero native deps, 2MB, instant install
