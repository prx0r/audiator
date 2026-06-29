interface AssessmentInput {
  sessionId: string;
  transcript: { role: string; text: string }[];
  routeEvents: {
    turnId: string;
    candidateText: string;
    evidenceTags: string[];
    scoreSignals: Record<string, number>;
  }[];
  acousticAnalysis?: {
    durationMs: number;
    talkRatio: number;
    silenceRatio: number;
    longestSilenceMs: number;
    silenceSegments: number;
    avgRms: number;
    peakRms: number;
    rmsVariance: number;
  } | null;
  voiceFeatures?: {
    f0Mean: number | null;
    f0Stddev: number | null;
    f0Range: number | null;
    loudnessMean: number | null;
    jitter: number | null;
    shimmer: number | null;
    hnr: number | null;
    spectralFlux: number | null;
    speechRate: number | null;
  } | null;
}

interface CallAssessment {
  rating: string;
  score: number;
  dimensions: {
    technical: { score: number; feedback: string };
    communication: { score: number; feedback: string };
    callControl: { score: number; feedback: string };
    professionalism: { score: number; feedback: string };
  };
  strengths: string[];
  improvements: string[];
  narrative: string;
}

const ASSESSMENT_SYSTEM_PROMPT = `You are an expert call assessor for IT service desk training. Analyze the following help desk call simulation and produce a structured assessment.

The candidate (IT support agent) is speaking with Sarah Mitchell, an office manager whose Outlook email is stuck in "Work Offline" mode. She's rushed and needs it fixed before a meeting.

Score each dimension 1-10 and provide specific, evidence-based feedback. Be critical where warranted — this is for coaching.

Call assessment rubric:
- Technical (1-10): Did they follow the right diagnostic path? Did they check the correct things in the right order? Did they avoid bad fixes?
- Communication (1-10): Were they clear, confident, and easy to understand? Did they explain things well? Use the acoustic voice features below as evidence for confidence, hesitancy, and tone.
- Call Control (1-10): Did they drive the call efficiently? Did they avoid getting stuck or repeating? Use silence/pause metrics as evidence.
- Professionalism (1-10): Were they courteous, empathetic, and professional? Did they handle pressure well?

ACOUSTIC INTERPRETATION GUIDE — use these to assess Communication and Call Control:
- Talk ratio < 30%: candidate was passive or hesitant, let customer dominate
- Talk ratio > 70%: candidate dominated, didn't let customer speak
- Silence ratio > 40% or longest pause > 5s: awkward gaps, candidate got stuck
- Silence segments > 1 per 3 seconds: excessive hesitation, fragmented speech
- Avg loudness < 0.03: candidate was barely audible, low assertiveness
- Loudness variance (rmsVariance): low = monotone/flat affect; high = dynamic/expressive
- Peak RMS > 0.5: candidate raised voice (frustration or excitement)
- F0 pitch range narrow (< 10 semitones): monotone voice, low confidence
- F0 pitch range wide (> 20 semitones): expressive, confident
- Jitter/shimmer high: vocal tension, nervousness, stress
- HNR (Harmonics-to-Noise) low (< 10): breathy voice, weak, uncertain
- Spectral flux low: robotic/flat delivery
- Speech rate (loudness peaks per second): high (> 3) = rushed/nervous; low (< 1) = slow/hesitant

Overall rating: one of EXCELLENT, GOOD, FAIR, POOR, FAIL

Return ONLY valid JSON with this exact structure:
{
  "rating": "GOOD",
  "score": 75,
  "dimensions": {
    "technical": { "score": 7, "feedback": "..." },
    "communication": { "score": 6, "feedback": "..." },
    "callControl": { "score": 8, "feedback": "..." },
    "professionalism": { "score": 7, "feedback": "..." }
  },
  "strengths": ["..."],
  "improvements": ["..."],
  "narrative": "2-3 paragraph coaching summary"
}

IMPORTANT: In your feedback, cite specific acoustic evidence. E.g. "Long pauses (longest 4.2s) suggest the candidate was unsure" or "Narrow pitch range and low loudness variance indicate a monotone, low-confidence delivery."`;

export async function assessCall(input: AssessmentInput): Promise<CallAssessment | null> {
  const transcriptStr = input.transcript
    .map(m => `${m.role === 'customer' ? 'Customer' : 'Candidate'}: ${m.text}`)
    .join('\n');

  const routeSummary = input.routeEvents
    .map(e => `Turn: "${e.candidateText}" → tags=[${e.evidenceTags.join(',')}]`)
    .join('\n');

  const a = input.acousticAnalysis;
  const acousticStr = a
    ? `Duration: ${(a.durationMs / 1000).toFixed(0)}s
Talk ratio: ${(a.talkRatio * 100).toFixed(0)}% (candidate speaking)
Silence ratio: ${(a.silenceRatio * 100).toFixed(0)}%
Longest pause: ${a.longestSilenceMs}ms
Silence segments: ${a.silenceSegments}
Avg loudness: ${a.avgRms.toFixed(3)}
Peak loudness: ${a.peakRms.toFixed(3)}
Loudness variance: ${a.rmsVariance.toFixed(3)}`
    : 'No acoustic data available';

  const v = input.voiceFeatures;
  const voiceStr = v && v.f0Mean != null
    ? `F0 pitch mean: ${v.f0Mean?.toFixed(1)} semitones
F0 pitch range: ${v.f0Range?.toFixed(1)} semitones
F0 pitch stddev: ${v.f0Stddev?.toFixed(2)}
Loudness: ${v.loudnessMean?.toFixed(3)}
Jitter: ${v.jitter?.toFixed(3)} (higher = vocal stress)
Shimmer: ${v.shimmer?.toFixed(3)} (higher = vocal tension)
HNR: ${v.hnr?.toFixed(1)} dB (higher = clearer voice)
Spectral flux: ${v.spectralFlux?.toFixed(3)} (higher = more dynamic)
Speech rate: ${v.speechRate?.toFixed(2)} peaks/sec (higher = faster)`
    : 'No voice feature data available';

  const userPrompt = `Session: ${input.sessionId}

=== Transcript ===
${transcriptStr}

=== Route Analysis ===
${routeSummary}

=== Acoustic Analysis (VAD) ===
${acousticStr}

=== Voice Features (openSMILE) ===
${voiceStr}

Assess this call — use the acoustic and voice feature data as evidence for confidence, hesitancy, tone, and call control.`;

  const opencodeBase = process.env.AI_BASE_URL;
  const opencodeKey = process.env.AI_API_KEY;
  const openrouterKey = process.env.OPENROUTER_API_KEY;

  let baseUrl: string;
  let authKey: string;
  let model: string;

  if (opencodeBase && opencodeKey) {
    baseUrl = opencodeBase.replace(/\/+$/, '');
    authKey = opencodeKey;
    model = process.env.AI_MODEL || 'deepseek-v4-flash';
  } else if (openrouterKey) {
    baseUrl = 'https://openrouter.ai/api/v1';
    authKey = openrouterKey;
    model = 'deepseek/deepseek-v4-flash';
  } else {
    return null;
  }

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authKey}`,
        'Content-Type': 'application/json',
        ...(baseUrl.includes('openrouter') ? {
          'HTTP-Referer': 'https://audiator.app',
          'X-Title': 'Audiator',
        } : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: ASSESSMENT_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.2,
        max_tokens: 1500,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) return null;

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as CallAssessment;
    return parsed;
  } catch {
    return null;
  }
}
