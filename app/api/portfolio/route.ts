import Anthropic from '@anthropic-ai/sdk';
import { NextResponse } from 'next/server';

const client = new Anthropic();

type Holding = { ticker: string; units: number; market: 'ASX' | 'NASDAQ' | 'NYSE' };

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
- "Add TICKER" (no quantity) → add or create holding with 1 unit
- "Add X TICKER" → increase units by X or create new holding with X units
- "Remove TICKER" or "Delete TICKER" → remove that holding
- "Set TICKER to X" / "TICKER = X" → set units to X
- If no quantity is mentioned when adding, default to 1 unit
- If ambiguous or invalid, return an error
- If the user specifies an exchange (e.g. "Add 30 NASDAQ:AAPL" or "Add 30 AAPL on NASDAQ"), use it for the market field
- Default new holdings to market: "ASX" if no exchange is specified
- Always include "market" on every holding in the output array (preserve existing values on unchanged holdings)
- market must be one of: "ASX", "NASDAQ", "NYSE"

Respond with ONLY valid JSON:
Success: {"portfolio": [{"ticker": "...", "units": 0, "market": "ASX"}], "description": "summary of change"}
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
