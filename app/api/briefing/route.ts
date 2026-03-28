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
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `You are a financial analyst providing a daily briefing for an ASX (Australian Securities Exchange) investor.

Current portfolio:
${holdingsText}

Return ONLY valid JSON (no markdown, no code fences) with this exact structure:

{
  "stocks": [
    {
      "ticker": "TICKER",
      "sentiment": "positive" | "neutral" | "negative",
      "sector": "e.g. Technology, Financials, Consumer Staples, ETF, Telecommunications",
      "country": "e.g. Australia, United States, Global, Emerging Markets",
      "commentary": "2-3 sentences of analysis specific to this holding — recent context, outlook, or key considerations"
    }
  ],
  "generalisation": {
    "sectorBreakdown": "1-2 sentences about how the portfolio is spread across sectors and any concentration risk",
    "regionExposure": "1-2 sentences about geographic and regional exposure across the holdings",
    "riskProfile": "1-2 sentences about overall portfolio risk level, volatility, and diversification quality",
    "actionableOutlook": "1-2 sentences of forward-looking recommendations or key things to watch"
  }
}

Include every ticker from the portfolio in the stocks array. Be concise and professional.`,
        },
      ],
    });

    const raw = message.content[0].type === 'text' ? message.content[0].text : '{}';

    // Strip any accidental markdown code fences
    const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
    const briefing = JSON.parse(cleaned);

    return NextResponse.json({ briefing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('Briefing API error:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
