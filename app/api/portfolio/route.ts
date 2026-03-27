import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const client = new Anthropic();

type Holding = { ticker: string; units: number };

export async function POST(req: Request) {
  const { portfolio, command } = await req.json();

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 512,
    messages: [
      {
        role: 'user',
        content: `You manage a stock portfolio. Apply the user's command and return updated JSON.

Current portfolio (JSON array):
${JSON.stringify(portfolio)}

User command: "${command}"

Rules:
- Tickers must be UPPERCASE
- Units must be positive integers
- "Add X TICKER" → increase units or create new holding
- "Remove TICKER" or "Delete TICKER" → remove that holding
- "Set TICKER to X" / "TICKER = X" → set units to X
- If ambiguous or invalid, return an error

Respond with ONLY valid JSON:
Success: {"portfolio": [...], "description": "summary of change"}
Error:   {"error": "explanation"}`,
      },
    ],
  });

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}';

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');
    const result = JSON.parse(jsonMatch[0]) as
      | { portfolio: Holding[]; description: string }
      | { error: string };
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({
      error: 'Could not understand that command. Try: "Add 10 TLS" or "Set VGS to 200".',
    });
  }
}
