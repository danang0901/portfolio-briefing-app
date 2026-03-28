import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const { portfolio } = await req.json();

  const holdingsText = (portfolio as { ticker: string; units: number }[])
    .map(h => `  ${h.ticker}: ${h.units.toLocaleString()} units`)
    .join('\n');

  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `You are a financial analyst providing a concise daily briefing for an ASX (Australian Securities Exchange) investor.

Current portfolio:
${holdingsText}

Write a daily briefing (300–400 words) covering:
1. Key macro and market themes relevant to these holdings today
2. Notable developments or context for individual holdings (use your knowledge of these ASX-listed securities)
3. A brief outlook and any considerations worth watching

Keep the tone professional but conversational. Use plain paragraphs — no bullet points or headers.`,
        },
      ],
    });

    const briefing = message.content[0].type === 'text' ? message.content[0].text : '';
    return NextResponse.json({ briefing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Briefing API error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
