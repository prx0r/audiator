# Audio Analysis Pipeline — Plan Assessment

## Hardware Reality Check

Our server: **2 cores, 4GB RAM, no GPU**

This rules out several of your suggestions:

| Tool | Can We Run It? | Why |
|------|---------------|-----|
| **WhisperX** | ❌ No | Needs GPU for alignment (GPU OOM killed our earlier npm install). The CPU-only whisper.cpp we have is fine. |
| **pyannote** | ❌ No | PyTorch-based, needs GPU. Our existing sherpa-onnx diarization is the pragmatic alternative. |
| **Silero VAD** | ⚠️ Maybe | JIT model is 2MB, could run on CPU. But Python-based — we'd need a subprocess bridge. Our existing JS VAD is adequate. |
| **openSMILE** | ⚠️ Maybe | C++ binary, Python wrapper. Could run as subprocess. But the eGeMAPS feature set produces 88 features per window — heavy for 4GB. |
| **Parselmouth** | ❌ No | Python + Praat C extension. Needs significant resources for pitch tracking. |
| **librosa** | ✅ Yes | Pure Python with numpy/scipy. Most realistic to add. |
| **ffmpeg** | ✅ Yes | Already available on the system. |

## What We Currently Have

- **`lib/audio/analyzer.ts`** — JS-based VAD with windowed RMS. Computes talk/silence ratios, longest pause, RMS stats. Works in-process.
- **`lib/audio/diarizer.ts`** — sherpa-onnx speaker diarization (PyAnnote segmentation + 3D-Speaker embedding). Only works if models are downloaded.
- **`lib/audio/turns.ts`** — Turn timing from session events. Computes response latency, talk balance.
- **`lib/audio/recorder.ts`** — File persistence for recording blobs.
- Recording is a `.webm` blob captured via `MediaRecorder` in the browser. Saved as-is.

## What's Realistic To Add

Given our constraints, the most impactful additions (in priority order):

### 1. WAV Conversion & Normalization (via ffmpeg)

Recorded `.webm` → normalized mono 16kHz `.wav`. ffmpeg is already available. This is trivial and unlocks everything below.

### 2. Full-Recording Spectrogram (via Next.js API route calling Python librosa subprocess)

The existing `analyzeAudio()` runs on the uploaded `.webm` bytes. We can add a post-processing step:
- Save the full .webm blob during the call (already done)
- On end-call, convert to WAV via ffmpeg
- Call Python script with librosa to produce:
  - Full spectrogram image
  - RMS energy contour
  - Silence/speech segment boundaries
  - Spectral features (centroid, rolloff, bandwidth)
- Store results in the recording analysis JSON

### 3. LLM-Powered Call Assessment (replaces graph scoring entirely)

You're right — the graph-based scoring system is overly complex for what it delivers. Instead:

**After the call ends:**
- Take the full transcript + route events + acoustic metrics
- Send to the LLM (DeepSeek V4 Flash via opencode go endpoint)
- Prompt it to produce a structured assessment:
  - Technical accuracy
  - Communication quality
  - Call control / process adherence  
  - Professionalism
  - Key strengths
  - Key improvement areas
  - Overall rating

This replaces:
- `scoreSignals` per turn (technical +1, callControl -1)
- `evidenceTags`
- Pressure curve analysis
- Manual dimension scoring

All of those become inputs to the LLM prompt instead.

### 4. Silero VAD (optional enhancement)

If we want better silence/pause detection than our current RMS threshold approach, we could call Silero VAD via a Python subprocess. But honestly, our current VAD is good enough for the call-length metrics we need. Upgrade only if we find it's inaccurate.

## The Analysis Pipeline (Post-Call)

```
Browser: End Call pressed
  ↓
Browser: Flush accumulated MediaRecorder blob (full-call.webm)
  ↓ POST /api/recording
Server: Save webm to disk
Server: analyzeAudio() — JS RMS-based VAD
Server: diarization via sherpa-onnx (if available)
Server: ffmpeg — convert webm → mono 16kHz.wav
Server: Python subprocess — librosa spectrogram + spectral features
Server: LLM — analyze transcript + events + acoustic data → structured assessment
  ↓
Database: Store combined analysis JSON
  ↓
Browser: Navigate to /analysis/[id] → rendered analysis dashboard
```

## The Analysis Page — MVP Spec

After pressing "End Call", the user should see a **loading state** that transitions to a **full analysis dashboard** with these sections:

### Section 1: Call Overview
- Duration (mm:ss)
- Talk time breakdown (candidate vs customer vs silence)
- Number of turns
- Overall rating (from LLM)

### Section 2: Transcript with Acoustic Overlay  
- Full conversation transcript
- Each turn annotated with:
  - Response latency
  - Pressure delta
  - Acoustic energy contour (mini sparkline)
- Click any turn to hear the audio segment

### Section 3: Acoustic Analysis
- **Spectrogram** (librosa-generated image) — full call waveform
- **RMS energy timeline** — shows speech activity vs silence
- **Silence/pause map** — where were the long pauses?
- **Spectral features** — centroid, rolloff, bandwidth (visualized)

### Section 4: LLM Assessment
- Structured feedback in sections:
  - Technical: Did they follow the right diagnostic path?
  - Communication: Were they clear, empathetic, professional?
  - Call Control: Did they drive the call or get lost?
  - Pressure Management: How did they handle Sarah's urgency?
- Key strengths (bullet points)
- Improvement areas (bullet points)
- Coach note (1-2 paragraph narrative)

### Section 5: Scoring Details (simplified)
- Instead of per-turn score signals, a summary:
  - Correct diagnosis path (Y/N + explanation)
  - Avoided bad paths (Y/N)
  - Resolved issue (Y/N)
  - Customer satisfaction (based on final pressure + LLM assessment)

### Implementation Plan

Phase 1 (this session):
- Replace graph scoring with LLM post-call assessment
- Wire up the analysis page to show LLM assessment alongside current acoustic data

Phase 2 (next session):
- ffmpeg WAV conversion
- Python+librosa subprocess for spectrogram + spectral features
- Acoustic overlay on transcript

Phase 3:
- Polished analysis dashboard with all components
- Audio playback of specific turns

## Why This Approach Works

1. **LLM assessment replaces the fragile graph scoring** — one good prompt is easier to maintain than 14 nodes × 5 response variants × pressure curves × repeat detection
2. **Minimal new dependencies** — ffmpeg (already there), Python+librosa (can be pip installed), no GPU needed
3. **Progressive enhancement** — we can ship Phase 1 immediately, add Phases 2-3 incrementally
4. **Defensible analytics** — LLM produces evidence-based assessment, not black-box "anxiety scores"
