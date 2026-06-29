import { NextRequest, NextResponse } from 'next/server';

const SYSTEM_PROMPT = `You are a customer calling IT support with a technical problem.
- Be vague at first, don't reveal all details upfront
- Respond naturally to the support agent's questions
- You're slightly frustrated but not abusive
- Keep responses to 1-3 sentences
- Stay in character as a non-technical user`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history = [] } = body;

    if (!message?.trim()) {
      return NextResponse.json({ error: 'Missing message' }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 });
    }

    const messages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...history,
      { role: 'user', content: message },
    ];

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openai/gpt-4o-mini',
        messages,
        max_tokens: 150,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter chat failed (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || '';

    return NextResponse.json({ reply });
  } catch (err: any) {
    console.error('[Chat] error:', err.message);
    return NextResponse.json({ error: 'Chat failed', detail: err.message }, { status: 502 });
  }
}
