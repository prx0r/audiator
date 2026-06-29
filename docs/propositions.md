# Auditor — Engine Propositions

> Research-backed evaluation of 8 open-source audio/emotion tools for the audiator pipeline.
> Goal: build an objective audio/conversation metrics engine + LLM-based call-quality interpretation layer.

---

## Architecture

```
audio file in
  → Objective Engine (no GPU, deterministic)
     → transcript + word timestamps
     → turn timing & response latency
     → prosody features (pitch, energy, jitter, shimmer)
     → eGeMAPS/ComParE feature sets
     → arousal/dominance/valence estimates
  → Evidence Assembly
     → candidate-behaviour signals
     → hesitation/confidence/pressure/interruption markers
  → LLM Interpretation Layer
     → manager-readable analysis narrative
  → Manager Feedback Loop
     → calibrate + store → retrain lightweight classifier
```

**Framing principle:** We do not claim to read "true emotional state." We produce *signals suggesting confidence, hesitation, pressure, interruption, calmness, pace, and customer-handling quality.* That is defensible and manager-useful.

---

## Tool Propositions

---

### 1. openSMILE — Best No-GPU Feature Extractor

**Repo:** https://github.com/audeering/opensmile
**Docs:** https://audeering.github.io/opensmile/
**Stars:** ~1.5k | **License:** Research-only (free) + commercial (paid)

#### What It Is
C++ toolkit for extracting audio features in real-time or batch. Industry standard in affective computing. Ships with eGeMAPS (Geneva Minimalistic Acoustic Parameter Set) and ComParE (Interspeech Challenge) feature sets.

#### Key Features
- Pitch (F0 via ACF/Cepstrum/SHS), formants, jitter, shimmer
- Energy/intensity/loudness, MFCCs, LPC, PLP, spectral features
- Voice quality: jitter, shimmer, HNR
- eGeMAPS (88 features), ComParE (6373 features)
- Real-time streaming or offline batch
- Python bindings via `opensmile` pip package
- Pre-trained emotion models (openEAR)

#### Pipeline Impact
```
Before:  amplitude VAD (analyzer.ts) → silence/talk ratio only
After:   openSMILE eGeMAPS → 88 interpretable prosodic features per segment
         → pitch_mean, pitch_variability, energy_mean, jitter_local, shimmer_local
         → spectral_slope, mfcc_1-4, formant_1-3 bandwidths
```

#### Verdict: INTEGRATE — PHASE 1
**Why:** No GPU, fast, research-backed, gives transparent "why" for each signal. The eGeMAPS set alone covers pitch/energy/voice-quality features that map directly to hesitation, confidence, and calmness indicators. Use it for per-turn and per-utterance feature extraction.

**Risks:** Research-only license for free tier. Need commercial license for production product. C++ binary dependency — but Python wheels exist for linux/windows/mac.

**Integration cost:** Medium (3-5 days). Install opensmile pip package, write wrapper for per-segment feature extraction, map outputs to audiator's analysis schema.

---

### 2. pyAudioAnalysis — Quick Prototyping Lab

**Repo:** https://github.com/tyiannak/pyAudioAnalysis
**Stars:** 6.2k | **License:** Apache 2.0

#### What It Is
Python library for audio feature extraction, classification, segmentation, and visualisation. Covers feature extraction (MFCCs, spectral, chroma), supervised/unsupervised segmentation, and classifier training.

#### Key Features
- Feature extraction: MFCCs, spectral, chroma, zero-crossing rate, energy
- Supervised segmentation (joint segmentation-classification)
- Unsupervised segmentation (speaker diarization, audio thumbnailing)
- Audio regression (emotion recognition example)
- Dimensionality reduction and visualisation
- Command-line and Python API

#### Pipeline Impact
```
Before:  manual test scripts only
After:   pyAudioAnalysis → quick feature experiments + visualisations
         → segment audio into speaker turns
         → extract per-turn features for lab testing
         → visualise feature distributions across call segments
```

#### Verdict: USE FOR R&D LAB — NOT PRODUCTION
**Why:** Great for rapid prototyping and visualisation. Use it in the audio lab to test feature extraction approaches before committing them to the production pipeline. The segmentation and classification tools help validate hypotheses about which features correlate with manager ratings.

**Risks:** Not actively maintained (last commit 2021). Uses older sklearn-based approaches. Not suitable for production inference — use openSMILE for that.

**Integration cost:** Low (1 day). Install via pip, use notebooks for exploration.

---

### 3. WhisperX — Word-Level Timestamps & Diarization

**Repo:** https://github.com/m-bain/whisperX
**Stars:** 22.8k | **License:** BSD-2-Clause

#### What It Is
Fast ASR with word-level timestamps and speaker diarization. Uses faster-whisper backend (CTranslate2) for 70x realtime with large-v2. Adds wav2vec2 forced alignment for accurate word timing. Optional pyannote-based diarization.

#### Key Features
- Word-level timestamps via forced alignment
- Speaker diarization (pyannote backend)
- Batched inference (70x realtime)
- VAD pre-processing (reduces hallucination)
- Sentence-level segments (NLTK)
- Language-specific alignment models
- Python API + CLI

#### Pipeline Impact
```
Current:  amplitude VAD → silence segments (no word timing)
With WX:  word-level timestamps → pause lengths between words
         → words_per_minute per turn
         → fillers detected from transcript (um, uh, like, you know)
         → response latency from word gaps
         → candidate vs customer turn boundaries
```

#### Metrics WhisperX Enables
| Metric | How It's Computed |
|--------|------------------|
| `word_onset_ms` | Forced alignment per word |
| `pause_before_answer_ms` | Gap between customer end and candidate first word |
| `words_per_minute` | Word count / turn duration |
| `filler_word_count` | Regex on transcript |
| `interruption_count` | Overlapping word detection |
| `candidate_response_latency_ms` | Word-gap analysis per turn |

#### Verdict: INTEGRATE — PHASE 1 (with GPU)
**Why:** Word timing is gold for call quality analysis. Pause lengths, talk speed, interruptions, and filler words are manager-visible metrics that directly map to SERVQUAL responsiveness and ITIL call-handling criteria.

**Risks:** Requires GPU for real-time batch (can run CPU but slow). Diarization via pyannote is CPU-heavy. Phoneme alignment model needs language-specific models. ~3GB VRAM for large-v2.

**Integration cost:** Medium (3-5 days). Set up GPU inference service, wrap Python API, store word-level results in JSON alongside acoustic analysis.

---

### 4. pyannote.audio — Diarization Reference

**Repo:** https://github.com/pyannote/pyannote-audio
**Stars:** 10.2k | **License:** MIT (community-1 pipeline: CC-BY-4.0)

#### What It Is
PyTorch toolkit for speaker diarization. Provides pretrained pipelines for speech activity detection, speaker change detection, overlapped speech detection, and speaker embedding. State-of-the-art performance.

#### Key Features
- Speaker diarization pipeline (speech activity → segmentation → clustering)
- Overlapped speech detection
- Speaker embedding (voiceprinting)
- HuggingFace integration
- Community-1 open-source pipeline
- Premium pipeline via pyannoteAI API

#### Pipeline Impact
```
Current:  sherpa-onnx-node diarizer (CPU, ONNX)
With PA:  GPU-accelerated diarization (more accurate)
         → overlapping speech detection
         → better speaker counting
         → confidence scores per segment
```

#### Verdict: REPLACE SHERPA-ONNX IN PHASE 2
**Why:** The community-1 pipeline achieves significantly lower diarization error rates than sherpa-onnx across AMI, DIHARD, VoxConverse benchmarks. Once GPU inference is available for WhisperX, switch pyannote to the same GPU stack.

**Risks:** CPU-inference is very slow (see GitHub discussion #778). Requires HuggingFace token. Community-1 pipeline is CC-BY-4.0. The premium pipeline is a paid API.

**Current approach (correct for MVP):** sherpa-onnx CPU diarization is adequate since we already know speaker identity from the known turn log. Don't overbuild diarization until GPU is available.

**Integration cost:** Medium (2-3 days). Replace sherpa-onnx import with pyannote pipeline, same interface contract.

---

### 5. audEERING wav2vec2 Emotion Model — Arousal/Dominance/Valence Baseline

**HF Model:** https://huggingface.co/audeering/wav2vec2-large-robust-12-ft-emotion-msp-dim
**Stars:** ~170 HF likes | **License:** CC-BY-NC-SA 4.0 (research only)

#### What It Is
Fine-tuned Wav2Vec2-Large-Robust (pruned from 24 to 12 layers) on MSP-Podcast v1.7. Predicts arousal, dominance, and valence in range ~0-1. Also provides pooled transformer states for embedding extraction.

#### Key Features
- Dimensional emotion: arousal, dominance, valence
- Trained on MSP-Podcast (naturalistic speech, not acted)
- Research baseline for emotion recognition
- ONNX export available
- Pooled hidden states (768-dim embedding)

#### Pipeline Impact
```
After:   per-turn arousal/dominance/valence values
         → arousal = pressure/activation level
         → dominance = confidence/control
         → valence = positive/negative tone
         → "candidate was aroused (anxious?) with low dominance (hesitant?)"
```

#### Framing (Critical)
Do NOT frame this as "emotion detection." Frame as:
> **Affect estimates:** signals suggesting activation level, conversational control, and tone. Not "angry" — instead "elevated arousal combined with declining dominance suggests rising pressure."

This is defensible because MSP-Podcast is naturalistic call data, not acted emotions. The continuous dimensions avoid cartoon labels.

#### Verdict: INTEGRATE AS RESEARCH BASELINE — PHASE 2
**Why:** Arousal/dominance/valence are the right abstraction layer — they map to manager concerns (confidence, calmness, control) without overclaiming. MSP-Podcast training data is the most relevant corpus for call centre audio.

**Risks:** CC-BY-NC-SA 4.0 — research only, not commercial. Commercial license available from audEERING (DEVAICE product). ~1.5GB GPU memory for inference. Unknown generalisation to MSP call audio specifically.

**Integration cost:** Low (1-2 days). HuggingFace transformers pipeline, 50 lines of Python.

---

### 6. SenseVoice — Promising All-in-One ASR + Emotion + Events

**Repo:** https://github.com/FunAudioLLM/SenseVoice
**Stars:** 8.7k | **License:** Apache 2.0 (model weights)

#### What It Is
Multilingual speech understanding model from Alibaba. Does ASR (50+ languages), speech emotion recognition (7 classes), audio event detection (applause, laughter, crying, cough, etc.). Non-autoregressive, 15x faster than Whisper-Large.

#### Key Features
- ASR: 50+ languages, surpasses Whisper on Chinese/Cantonese
- SER: 7 emotion classes (happy, sad, angry, neutral, fearful, disgusted, surprised)
- AED: bgm, applause, laughter, cry, sneeze, breath, cough
- 15x faster than Whisper-Large (70ms for 10s audio)
- llama.cpp/GGUF support (CPU inference, no Python)
- ONNX export, FunASR integration
- Speaker diarization (via CAM++ + FunASR)

#### Pipeline Impact
```
SenseVoice as experimental all-in-one:
  → ASR transcript (possibly replacing WhisperX for some languages)
  → Emotion tags per utterance (neutral, happy, angry, etc.)
  → Event detection (laughter, background noise, cough)
  → Speaker labels (with CAM++ diarization)
```

#### Verdict: EXPERIMENT — PHASE 3
**Why:** The combination of ASR + emotion + audio events in one model is compelling. The 15x speed advantage matters for batch processing. GGUF support means CPU-only deployment is possible.

**Risks:** Emotion labels are discrete categories (not dimensions), which is philosophically opposed to our framing principle. May not generalise well to Western MSP call audio (training data is Chinese-heavy). Licensing status of model weights needs confirmation.

**Integration cost:** Low (1 day) for experiment, high (2 weeks) for production replacement of existing pipeline stages.

---

### 7. emotion2vec — Research-Grade Emotion Embeddings

**Repo:** https://github.com/ddlBoJack/emotion2vec
**Stars:** 1.1k | **License:** MIT

#### What It Is
Self-supervised speech emotion representation model (ACL 2024). Provides 768-dim embeddings that capture emotional content across languages and tasks. SOTA on IEMOCAP with linear probe. Offers emotion2vec+ fine-tuned variants for 9-class emotion recognition.

#### Key Features
- Universal emotion embedding (768-dim)
- SOTA on IEMOCAP (4-class: 78.5% WA)
- Cross-lingual transfer (Mandarin, French, German, Italian)
- emotion2vec+: fine-tuned SER with 9 classes (40k hours training data)
- FunASR integration
- Frame-level features (50Hz) and utterance-level features

#### Pipeline Impact
```
Before:  custom RMS-based VAD only
After:   emotion2vec embeddings per utterance
         → 768-dim representation of emotional content
         → feed into lightweight classifier (logistic regression)
         → calibrated against manager feedback
```

#### The Moat Potential
emotion2vec embeddings + manager-labelled feedback + lightweight classifier = defensible differentiation. The embeddings capture emotional nuance that simple prosodic features miss, and the manager feedback loop continuously improves accuracy.

#### Verdict: PHASE 4 — MOAT BUILDING
**Why:** Use emotion2vec embeddings (not raw audio) as features for a trainable classifier that learns from manager feedback. This creates a data moat: the more managers use the system, the better it gets at identifying domain-specific patterns (hesitation, pressure, lost control).

**Risks:** Research model — may need fine-tuning for call audio. GPU required for embedding extraction (~1GB VRAM). 768-dim embeddings add storage/compute overhead.

**Integration cost:** Medium (3-5 days) for embedding extraction pipeline. Additional time for classifier training and calibration.

---

### 8. Praat / Parselmouth — Transparent Prosody Features

**Scripts:** https://github.com/drfeinberg/PraatScripts
**Python lib:** https://github.com/YannickJadoul/Parselmouth
**License:** GPL (Praat), BSD-3 (Parselmouth)

#### What It Is
Praat is the gold standard in phonetic analysis (20+ years, 10k+ citations). Parselmouth is a Python wrapper around Praat's C++ code. Provides pitch, formants, HNR, jitter, shimmer, intensity, and voice quality measures.

#### Key Features
- Pitch (F0): mean, median, SD, min, max, range
- Formants: F1-F3 frequencies and bandwidths
- HNR (Harmonics-to-Noise Ratio): voice quality
- Jitter local, jitter absolute, shimmer local, shimmer APQ
- Intensity: mean, min, max, dynamic range
- Point process analysis for voice breaks

#### Pipeline Impact
```
Per-turn features from Parselmouth:
  → pitch_range (Δ between min/max F0) = emotional variability
  → jitter_local = voice instability (stress indicator)
  → shimmer_local = breathiness/roughness
  → HNR = vocal effort/pressure
  → intensity_std = loudness variation
```

#### Comparison with openSMILE
| Feature | openSMILE | Parselmouth |
|---------|-----------|-------------|
| Pitch | ✓ (ACF/Cepstrum/SHS) | ✓ (Praat autocorrelation) |
| Jitter/Shimmer | ✓ | ✓ (Praat gold standard) |
| Formants | ✓ | ✓ |
| HNR | ✓ (via ACF) | ✓ (Praat cross-correlation) |
| Speed | Fast (C++) | Moderate (C++ via Python) |
| Explainability | Research standard | Phonetic gold standard |
| License | Research-only | GPL/BSD |

#### Verdict: SUPPLEMENTARY — PHASE 2
**Why:** Praat-style features provide the most explainable voice quality measures. If a manager asks "why did the system say the candidate sounded hesitant?", you can point to specific jitter, shimmer, and HNR values. This is better than "emotion model said 73% anxious."

**Risks:** openSMILE already covers most of these features. Parselmouth adds marginal value unless specific Praat algorithms are needed (e.g., for phonetics research validation). GPL license for Praat itself.

**Integration cost:** Low (1 day). Install Parselmouth pip package, write extraction wrapper.

---

## Mapped Features by Tool

| Feature Group | Phase 1 | Phase 2 | Phase 3 | Phase 4 |
|--------------|---------|---------|---------|---------|
| Silence/talk ratio | analyzer.ts ✓ | — | — | — |
| Turn timing | turns.ts ✓ | — | — | — |
| eGeMAPS prosody | openSMILE ✓ | — | — | — |
| Word timestamps | WhisperX ✓ | — | — | — |
| Filler words | WhisperX ✓ | — | — | — |
| Response latency | WhisperX ✓ | — | — | — |
| Arousal/Dominance/Valence | — | audEERING ✓ | — | — |
| Voice quality (jitter/shimmer/HNR) | — | Parselmouth ✓ | — | — |
| Diarization (GPU) | — | pyannote ✓ | — | — |
| Emotion embeddings | — | — | — | emotion2vec ✓ |
| All-in-one ASR+emotion | — | — | SenseVoice exp. | — |
| Manager feedback classifier | — | — | — | emotion2vec + XGBoost |

---

## Phase Plan

### Phase 1 (Now — 2 weeks)
**No GPU. Evidenced signals. No emotion labels.**

- `openSMILE` → per-turn eGeMAPS prosody features
- `WhisperX` → word timestamps, pause lengths, WPM, fillers (via OpenRouter STT as fallback)
- Existing `analyzer.ts` VAD → silence/talk metrics
- Existing `turns.ts` → turn timing
- LLM interprets extracted signals → manager narrative

### Phase 2 (Weeks 3-4)
**Add affect estimates. GPU optional.**

- `audEERING wav2vec2` → arousal/dominance/valence per turn
- `Parselmouth` → voice quality (jitter, shimmer, HNR) as supplementary explainable features
- Replace sherpa-onnx with `pyannote` if GPU available
- Compare affect estimates against manager ratings

### Phase 3 (Weeks 5-6)
**Experiment with all-in-one models. Validate against real data.**

- `SenseVoice` experiment: compare ASR quality, emotion tags, speed
- Check GPU requirements and licensing for production use
- A/B test WhisperX vs SenseVoice on 50 MSP calls

### Phase 4 (Weeks 7+)
**Manager feedback loop. Trainable layer. Moat.**

- `emotion2vec` embeddings per utterance
- Collect manager feedback on analysis accuracy
- Train lightweight classifier (XGBoost / logistic regression / small MLP)
- Continuously calibrate against manager ratings
- Domain-specific moat: call centre audio + transcript + actions + manager judgement

---

## What Not to Do (Deliberately Excluded)

| Thing | Reason |
|-------|--------|
| Fine-tune Qwen on raw audio | Premature. Build the evidence pipeline first. |
| Train raw-audio transformer | GPU-dependent, slow, uninterpretable. |
| emotion label → core score | "73% anxious" is not actionable. |
| pyannote diarization dependency | Already know speaker turns. Overbuilding for MVP. |
| Commercial emotion model | audEERING DEVAICE is $; wait until Phase 2 validates need. |
| Real-time inference | Batch analysis is sufficient for MVP. |

---

## The Actual Moat

```
MSP call audio
+ transcript
+ scenario truth
+ candidate actions (ticket, tools, notes)
+ manager judgement
+ evidence-backed analysis (not emotion scores)
+ repeated attempts over time
```

Most emotion datasets know "angry/sad/happy." They do not know:

> *"This first-line candidate lost control of the call when the user became impatient. They sounded calm but failed to clarify impact. They hesitated before asking permission to remote in."*

That is our domain-specific layer. Build the evidence pipeline first.

---

## Tool Priority Matrix

```
Tool            | Impact | Effort | Risk  | Phase
----------------|--------|--------|-------|------
openSMILE       | HIGH   | MED    | LOW   | 1
WhisperX        | HIGH   | MED    | MED   | 1
audEERING w2v2  | MED    | LOW    | MED   | 2
Parselmouth     | LOW    | LOW    | LOW   | 2
pyannote        | MED    | MED    | MED   | 2
SenseVoice      | MED    | LOW    | HIGH  | 3
emotion2vec     | MED    | MED    | MED   | 4
pyAudioAnalysis | LOW    | LOW    | LOW   | R&D lab
```

**Do this order.** Phase 1 alone (openSMILE + WhisperX + existing VAD/turns) gives manager-useful outputs without any emotion model.

---

## Why This Spec Over Alternatives

There are roughly four schools of thought for audio-based call analysis. Here is why this spec opposes each of them.

### Alternative A: "Just fine-tune a big model"

**Claim:** Fine-tune Whisper or Qwen on call audio + manager scores. One model does everything.

**Why this spec disagrees:**
- Fine-tuning gives you a black box. When it says "confidence: 73%", you cannot explain why. A manager cannot act on that.
- Fine-tuning requires 1000s of labelled calls *before you have any labelled calls*. Chicken-and-egg problem.
- Audio foundation models drift across audio formats, microphone quality, background noise. Your fine-tune breaks on the first Teams call recording.
- You cannot separate "the model is bad at transcription" from "the model is bad at emotion" from "the rubric is wrong." Debugging is hell.

**This spec instead:** Extract *transparent signals* (pause length, pitch variability, filler count, response latency) that can be individually validated against ground truth. The LLM interprets the signals, not the raw audio. Each signal is independently testable.

### Alternative B: "Use a commercial emotion API"

**Claim:** Azure Emotion API / Hume AI / audEERING DEVAICE handles everything.

**Why this spec disagrees:**
- API cost at scale: $0.001–0.01 per API call × millions of calls = significant.
- Vendor lock-in. If Hume changes their model or pricing, your analysis changes.
- API responses are black boxes — you get JSON scores with no explanation of what audio features drove them.
- Privacy: sending call audio to third-party APIs is a non-starter for enterprise MSPs handling PII.
- The good APIs (Hume, audEERING) are research-only licensed or expensive.

**This spec instead:** Open-source tools (openSMILE, WhisperX, emotion2vec) run on your own infra. Zero data leaves your environment. Each feature extraction step is auditable.

### Alternative C: "Just use the LLM — GPT-4o can analyse audio directly"

**Claim:** GPT-4o / Gemini can listen to audio and write analysis. No pipeline needed.

**Why this spec disagrees:**
- Cost: 1 minute of audio input via GPT-4o audio modality is ~$0.10. A 10-minute call = $1.00 per analysis. At 1000 calls/month = $1000/mo just for audio processing.
- Latency: 10+ seconds per analysis. Cannot scale to batch.
- No structured output guarantee. The LLM might say "the candidate sounded confident" one day and "the candidate seemed assertive" the next for the same audio.
- No repeatability. Run the same audio twice → two different analyses. Managers cannot trust this.
- Hallucination: LLMs invent acoustic detail that does not exist ("I detected a slight tremor in the voice" when there was none).

**This spec instead:** Objective feature extraction (deterministic, repeatable) + LLM interpretation of the feature vector (constrained, verifiable). The LLM sees `[pause_avg_ms: 1200, pitch_std: 24Hz, filler_count: 7]`, not raw audio. Its output can be validated against the input features.

### Alternative D: "Build on top of a conversational AI platform"

**Claim:** Use Rasa / Voiceflow / Cognigy for the voice agent, bolt on analysis.

**Why this spec disagrees:**
- Those platforms are designed for building conversational AI, not analysing it. Their analytics are dashboards and logs, not acoustic feature extraction.
- They do not compute jitter, shimmer, eGeMAPS, or word-level timing.
- You export a transcript and lose all acoustic information.
- Platform lock-in again.

**This spec instead:** Audiator is purpose-built for analysis from day one. The feature extraction pipeline is the product, not an afterthought bolted onto a conversational platform.

### Summary of Differentiation

| Concern | Alternative Approaches | This Spec |
|---------|----------------------|-----------|
| Explainability | Black box (fine-tuned model, API, LLM) | Each signal traceable to specific acoustic feature |
| Cost at scale | $0.01–$0.10 per call (API/LLM audio) | ~$0.001 per call (open-source inference) |
| Privacy | Audio leaves your infra | All processing local |
| Repeatability | Non-deterministic (LLM, API model updates) | Deterministic feature extraction |
| Debuggability | Cannot tell why a score was wrong | Each feature independently testable |
| Data moat | Model vendor owns the fine-tune | Your manager feedback + rubric = your moat |
| Time to value | Requires labelled data first | Works with zero labelled data (Phase 1) |

---

## Where I Am Not Sure / Would Test Multiple Approaches

The spec above is my best judgment. These are the areas where I am genuinely uncertain and recommend running experiments rather than committing early.

### 1. WhisperX vs SenseVoice for ASR + Timing

**The question:** Should Phase 1 use WhisperX (GPU-accelerated, word-level alignment, pyannote diarization) or SenseVoice (CPU-capable via GGUF, 15x faster, built-in emotion + audio events)?

**Why I am not sure:**
- WhisperX is the gold standard for word-level timing. But it needs GPU for reasonable speed.
- SenseVoice on llama.cpp/GGUF runs CPU-only with no Python runtime — vastly simpler deployment.
- If SenseVoice's word timing is accurate enough, it could skip WhisperX entirely and also provide emotion tags as a side effect.
- But SenseVoice's emotion tags are discrete (happy/sad/angry) which conflicts with our "no emotion labels" framing.

**Test:** Take 20 MSP call recordings (5 minutes each). Run through both pipelines. Compare:
- Word-level timestamp accuracy (manually check 100 random words per call)
- Transcription WER
- Processing time
- For SenseVoice: are the emotion tags consistent with human labelling?

**If SenseVoice wins:** Replace WhisperX entirely. Get ASR + emotion + audio events in one CPU-capable pipeline.
**If WhisperX wins:** Keep WhisperX for ASR/timing. Ignore SenseVoice until Phase 3 experiment.

### 2. openSMILE vs Parselmouth for Prosody/Voice Quality

**The question:** Which should be the primary prosody extractor?

**Why I am not sure:**
- openSMILE is faster and its eGeMAPS feature set is the affective computing standard. But its jitter/shimmer algorithms may differ from Praat's.
- Parselmouth (Praat bindings) is the phonetic gold standard — if a feature claims "high jitter", Praat's measurement is more defensible in a scientific sense.
- However, Parselmouth is slower and covers less ground (no eGeMAPS/ComParE).
- The question is: do managers care about phonetic validity or broad coverage?

**Test:** Run both on 50 candidate utterances. Compare jitter, shimmer, HNR, pitch values. Are they correlated? Do they produce the same "hesitation" classification? Which is faster?

**Suspicion:** openSMILE is good enough and covers more features. Parselmouth adds marginal value. But if domain experts (speech therapists, phoneticians) are involved in validation, Parselmouth's Praat provenance matters.

### 3. Should We Build a Trainable Layer at All?

**The question:** Given that Phase 1 works with zero training data, is Phase 4's trainable classifier worth the complexity?

**Why I am not sure:**
- The LLM interpretation layer might be good enough. If GPT-4o-mini can write a sensible "candidate hesitated because [pause=1.2s, filler=5, pitch_rise=yes]" from feature vectors alone, manager-labelled training data might not improve things much.
- Training a classifier introduces model versioning, data drift, and calibration complexity.
- However, the LLM will not get better over time. A trained classifier improves with every manager rating.

**Test:** Run Phase 1 for 100 calls. Have managers rate each analysis as accurate/inaccurate/hallucinated. If >80% are rated accurate, defer Phase 4. If <60%, build the classifier.

**Risk:** The classifier makes the system harder to explain. The beauty of Phase 1 is that every output is traceable to a measured feature. A trained model re-introduces opacity.

### 4. audEERING ADV vs Nothing at All

**The question:** Do arousal/dominance/valence estimates actually improve manager decision-making?

**Why I am not sure:**
- Phase 1's signals (pause length, WPM, fillers, pitch variability, silence ratio) already cover most of what managers care about.
- "Arousal: 0.61" adds a single number that managers may not know how to act on.
- If the ADV model disagrees with the prosodic signals (e.g., low arousal but high pitch variability), which does the manager trust?

**Test:** Show managers two versions of the same analysis — one with ADV scores, one without. Ask: does the ADV version change your assessment of the candidate? Does it help you write feedback?

**Suspicion:** ADV will matter most for edge cases — candidates who seem calm (low pitch variability, moderate latency) but have high arousal (ADV model detects tension). This might be the "hiding panic" signal. But I am not confident.

### 5. pyannote Diarization vs sherpa-onnx vs Known Turn Log

**The question:** We already know who spoke when from the sim engine's turn log. Do we need any diarization at all, or does the acoustic diarization add cross-validation value?

**Why I am not sure:**
- For audiator's current use case (known agent/customer turns), diarization is redundant.
- But if audiator is used on real call recordings (where turn log is unknown), diarization becomes essential.
- sherpa-onnx (current) works CPU but is less accurate. pyannote is more accurate but needs GPU.
- The question is: do we build for the current use case or for future generality?

**Test:** Run 20 mixed-call recordings through all three approaches. Compare:
- sherpa-onnx vs pyannote accuracy (how well do they reconstruct the known turn log?)
- Processing time difference
- Does diarization accuracy affect downstream metrics (response latency, talk ratio)?

**Suspicion:** sherpa-onnx is good enough for the known-turn-log case. Switch to pyannote only when processing unknown recordings becomes a requirement.

### 6. Feature Set Size: eGeMAPS (88) vs ComParE (6373)

**The question:** Do we need all 6373 ComParE features, or is eGeMAPS sufficient?

**Why I am not sure:**
- eGeMAPS (88 features) was specifically designed to be minimal but sufficient for affective computing. It is more interpretable and less prone to overfitting.
- ComParE (6373 features) captures everything but is heavily redundant. Most papers using ComParE apply feature selection.
- For Phase 1, eGeMAPS is the right choice. But if the MLP in Phase 4 underperforms, a larger feature set (ComParE + feature selection) might unlock better accuracy.

**Test:** After Phase 4's classifier is trained on eGeMAPS, re-run with ComParE + mutual-information feature selection. Compare accuracy.

**Suspicion:** eGeMAPS will be 90% as good as ComParE for call centre audio. The gap is not worth the interpretability cost.

### 7. LLM Provider: OpenRouter GPT-4o-mini vs Local Model

**The question:** Should the LLM interpretation layer use a hosted model (OpenRouter) or a local model (Qwen 2.5 7B via Ollama)?

**Why I am not sure:**
- OpenRouter GPT-4o-mini is cheap ($0.15/1M input tokens) and high quality. But it requires internet and API key.
- Qwen 2.5 7B local is free, private, and always available. But quality is lower and hardware requirements are higher.
- The interpretation task is simple: "Given these feature values, write a paragraph." Both models can do this.
- The risk with hosted models: they change, deprecate, or increase pricing.

**Test:** Feed the same feature vectors to both models. Run 50 comparisons. Which produces more manager-useful narratives? Are there systematic differences (e.g., GPT-4o-mini is more cautious, Qwen is more definitive)?

**Suspicion:** Start with OpenRouter GPT-4o-mini (best quality, zero ops burden). Add Qwen as fallback/offline option in Phase 3.

### Summary of Uncertainties

| Question | Test | Decision Point |
|----------|------|----------------|
| WhisperX vs SenseVoice | 20 calls, compare timing accuracy + WER + speed | End of Phase 1 |
| openSMILE vs Parselmouth | 50 utterances, compare jitter/shimmer correlation | End of Phase 1 |
| Trainable layer needed? | 100 calls, manager satisfaction survey | Before Phase 4 |
| ADV value-add | Manager A/B test with/without ADV scores | End of Phase 2 |
| pyannote vs sherpa-onnx | 20 mixed recordings, diarization accuracy | When unknown recordings are needed |
| eGeMAPS vs ComParE | Compare classifier accuracy after Phase 4 training | During Phase 4 |
| LLM provider | 50 comparisons, narrative quality | Before production deployment |
