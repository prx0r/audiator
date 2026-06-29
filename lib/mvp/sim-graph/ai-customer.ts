import type { CustomerPersona } from './customer-personas';

export interface AiCustomerResponse {
  reply: string;
  issueResolved: boolean;
  evidenceTags: string[];
  scoreSignals: Record<string, number>;
}

function getLlmConfig(): { url: string; model: string; apiKey: string } | null {
  const base = process.env.AI_BASE_URL;
  const key = process.env.AI_API_KEY;
  if (base && key) {
    return { url: base.replace(/\/+$/, '') + '/chat/completions', model: process.env.AI_MODEL || 'deepseek-v4-flash', apiKey: key };
  }
  return null;
}

function buildSystemPrompt(persona: CustomerPersona, priorFacts: string[]): string {
  const facts = [
    `Name: ${persona.name}`,
    `Company: ${persona.company}`,
    `Role: ${persona.role}`,
    `Issue: ${persona.issue}`,
    ...Object.entries(persona.hiddenFacts).map(([k, v]) => `${k}: ${v}`),
    ...priorFacts,
  ];

  return `You are ${persona.name}, a ${persona.role.toLowerCase()} at ${persona.company}, on a support call with an IT technician.

Your issue: ${persona.issue}
Your temperament: ${persona.temperament}

RULES:
- Stay in character as a non-technical user. You do NOT know IT terminology.
- Keep replies short (1-3 sentences). Real users don't write paragraphs.
- Do NOT reveal the solution. The technician must diagnose and fix it.
- Do NOT reveal information the technician hasn't asked about.
- If the technician asks you to check something on your screen, describe what you see based on: ${persona.issue}
- If asked something you don't know, say "I'm not sure" or "I don't know".
- If the issue has been resolved, confirm it.

AVAILABLE FACTS (you know these):
${facts.map(f => `- ${f}`).join('\n')}

FORBIDDEN:
- Do not suggest the fix yourself
- Do not use technical terms like "offline mode" or "VPN client" unless the technician has identified them
- Do not break character

RESPONSE FORMAT — respond with valid JSON only:
{
  "reply": "your spoken reply as the customer",
  "issueResolved": boolean (true only if the technician has actually fixed the issue),
  "evidenceTags": ["short tag describing candidate's action, like 'good_question', 'jargon', 'empathy', 'bypassed_diagnosis', 'workaround_offered'"],
  "scoreSignals": {}
}`;
}

export async function getAiCustomerResponse(
  persona: CustomerPersona,
  history: { role: 'customer' | 'candidate'; text: string }[],
  candidateMessage: string,
  priorFacts: string[] = [],
): Promise<AiCustomerResponse | null> {
  const config = getLlmConfig();
  if (!config) return null;

  const conversation = history.map(m =>
    `${m.role === 'candidate' ? 'Technician' : persona.name}: ${m.text}`
  ).join('\n');

  const systemPrompt = buildSystemPrompt(persona, priorFacts);
  const userPrompt = `Current conversation:
${conversation}

Technician: "${candidateMessage}"

Respond as ${persona.name}. Return ONLY valid JSON.`;

  try {
    const res = await fetch(config.url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 1000,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(`[AiCustomer] HTTP ${res.status}: ${body.slice(0, 200)}`);
      return null;
    }

    const data = await res.json() as { choices: { message: { content: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;

    const parsed = JSON.parse(content) as AiCustomerResponse;
    return {
      reply: parsed.reply || '',
      issueResolved: Boolean(parsed.issueResolved),
      evidenceTags: Array.isArray(parsed.evidenceTags) ? parsed.evidenceTags : [],
      scoreSignals: parsed.scoreSignals || {},
    };
  } catch (err: any) {
    console.warn(`[AiCustomer] error: ${err.message}`);
    return null;
  }
}
