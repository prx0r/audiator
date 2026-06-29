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
