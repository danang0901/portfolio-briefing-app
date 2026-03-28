import Anthropic from '@anthropic-ai/sdk';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const client = new Anthropic();

type Holding = { ticker: string; units: number };

export type StockSignal = {
  ticker: string;
  signal: 'ADD' | 'HOLD' | 'TRIM' | 'EXIT';
  confidence: 'High' | 'Medium' | 'Low';
  thesis_status: 'intact' | 'developing' | 'broken';
  sector: string;
  country: string;
  catalyst: string;
  upcoming_catalyst: string;
  what_to_watch: string;
  risk_change: 'increased' | 'decreased' | 'unchanged';
};

export type BriefingOverview = {
  watch_list: string[];
  priority_actions: string[];
  sector_breakdown: string;
  region_exposure: string;
  risk_profile: string;
  macro_note: string;
};

export type BriefingData = {
  stocks: StockSignal[];
  overview: BriefingOverview;
  generated_at: string;
  news_sourced: boolean;
};

// Streaming event types sent to the client
type StreamEvent =
  | { type: 'progress'; message: string }
  | { type: 'stock'; data: StockSignal }
  | { type: 'overview'; data: BriefingOverview }
  | { type: 'done'; generated_at: string; news_sourced: boolean }
  | { type: 'error'; message: string };

const OUTPUT_SCHEMA = `{
  "stocks": [
    {
      "ticker": "TICKER",
      "signal": "ADD" | "HOLD" | "TRIM" | "EXIT",
      "confidence": "High" | "Medium" | "Low",
      "thesis_status": "intact" | "developing" | "broken",
      "sector": "e.g. Materials, Financials, Consumer Staples, ETF — Global Equities, Telecommunications",
      "country": "e.g. Australia, United States, Global, Emerging Markets",
      "catalyst": "2-3 sentences: what recently happened that affects this holding",
      "upcoming_catalyst": "Next known event to watch (earnings date, AGM, macro data release)",
      "what_to_watch": "The single most important risk or trigger to monitor right now",
      "risk_change": "increased" | "decreased" | "unchanged"
    }
  ],
  "overview": {
    "watch_list": ["3-5 specific items the trader should pay attention to this week"],
    "priority_actions": ["One line per ADD/TRIM/EXIT signal only — empty array if all HOLD"],
    "sector_breakdown": "1-2 sentences on sector concentration and any imbalances",
    "region_exposure": "1-2 sentences on geographic exposure",
    "risk_profile": "1-2 sentences on overall portfolio risk and diversification quality",
    "macro_note": "1-2 sentences on the key macro factor most relevant to this specific portfolio right now"
  }
}`;

export async function POST(req: Request) {
  const body = await req.json();
  const holdings = (body.portfolio ?? []) as Holding[];

  if (!holdings.length) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Portfolio is empty.' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: StreamEvent) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }

      try {
        // ── Phase 1: Search ──────────────────────────────────────────────────
        emit({ type: 'progress', message: 'Starting news search…' });

        const tickers = holdings.map(h => h.ticker).join(', ');
        const searchPrompt = `Today is ${today}. You are researching an ASX portfolio for a morning briefing.

Portfolio tickers: ${tickers}

Search for:
1. Recent news and ASX company announcements for each ticker (past 2-4 weeks)
2. Upcoming earnings dates, AGMs, or capital events in the next 1-2 months
3. Key macro events for this ASX portfolio: RBA decisions, Australian CPI/GDP, China PMI and trade data (critical for miners), US Fed decisions
4. Any analyst upgrades/downgrades or significant price target changes

For index ETFs (VGS = global equities, VAS = ASX 300, VAE = Asian equities): search for index performance drivers and macro factors.

Summarise what you find. Be specific — include dates, figures, and source context where available. Note explicitly where you couldn't find recent information.`;

        let newsContext = '';
        let newsSourced = false;

        try {
          type AnyMessage = {
            stop_reason: string;
            content: Array<{ type: string; text?: string; tool_use_id?: string }>;
          };

          const betaCreate = client.beta.messages.create.bind(client.beta.messages) as (
            params: unknown
          ) => Promise<AnyMessage>;

          const messages: Anthropic.MessageParam[] = [{ role: 'user', content: searchPrompt }];

          // Emit per-ticker progress as we go
          let searchRound = 0;
          for (let i = 0; i < 25; i++) {
            if (searchRound < holdings.length) {
              emit({ type: 'progress', message: `Searching news for ${holdings[searchRound]?.ticker ?? '…'}…` });
              searchRound++;
            }

            const response = await betaCreate({
              model: 'claude-sonnet-4-6',
              max_tokens: 4096,
              tools: [{ type: 'web_search_20250305', name: 'web_search' }],
              messages,
              betas: ['web-search-2025-03-05'],
            });

            if (response.stop_reason === 'end_turn') {
              newsContext = response.content
                .filter(b => b.type === 'text')
                .map(b => b.text ?? '')
                .join('\n');
              newsSourced = newsContext.length > 0;
              break;
            }

            if (response.stop_reason === 'tool_use') {
              messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlock[] });
              const toolResults = response.content
                .filter(b => b.type === 'tool_result' && b.tool_use_id)
                .map(b => ({
                  type: 'tool_result' as const,
                  tool_use_id: b.tool_use_id!,
                  content: JSON.stringify(b),
                }));
              if (toolResults.length > 0) {
                messages.push({ role: 'user', content: toolResults });
              } else {
                break;
              }
            } else {
              break;
            }
          }
        } catch {
          // Web search unavailable — synthesis will note this
          newsContext = '';
          newsSourced = false;
        }

        // ── Phase 2: Synthesis ───────────────────────────────────────────────
        emit({ type: 'progress', message: 'Generating signals…' });

        const holdingsText = holdings
          .map(h => `  ${h.ticker}: ${h.units.toLocaleString()} units`)
          .join('\n');

        const contextSection = newsContext
          ? `\nRecent news and context (sourced via web search):\n${newsContext}\n`
          : '\nNote: Live news unavailable. Base analysis on training data knowledge and note any limitations.\n';

        const synthesisPrompt = `You are a senior ASX equity analyst generating a morning briefing for a long-term portfolio investor. Today is ${today}.

Portfolio:
${holdingsText}
${contextSection}
Signal definitions:
- ADD: Strengthen this position — thesis is building or entry point is attractive
- HOLD: Maintain — thesis intact, no action needed today
- TRIM: Reduce — thesis weakening, position oversized, or risk has increased meaningfully
- EXIT: Close — thesis is broken or the investment case has fundamentally changed

Confidence: High = strong evidence, Medium = reasonable evidence, Low = limited evidence.
Thesis status: intact = original reason still valid, developing = evolving closely, broken = case has changed.

Context:
- Long-term hold portfolio. Most signals should be HOLD unless there is a genuine reason to act.
- For ASX miners: China demand (iron ore, copper) is the key variable.
- For ETFs (VGS, VAS, VAE): evaluate on index trajectory and macro tailwinds/headwinds.
- Be direct. If information is limited, say so in the catalyst field.

Return ONLY valid JSON (no markdown, no code fences) matching this exact structure:
${OUTPUT_SCHEMA}`;

        const synthesis = await client.messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: synthesisPrompt }],
        });

        const raw = synthesis.content[0].type === 'text' ? synthesis.content[0].text : '{}';
        const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
        const result = JSON.parse(cleaned) as { stocks: StockSignal[]; overview: BriefingOverview };

        // Emit each stock card individually so the frontend can render progressively
        for (const stock of result.stocks) {
          emit({ type: 'stock', data: stock });
        }

        emit({ type: 'overview', data: result.overview });
        emit({ type: 'done', generated_at: new Date().toISOString(), news_sourced: newsSourced });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('Briefing stream error:', message);
        emit({ type: 'error', message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { 'Content-Type': 'application/x-ndjson' },
  });
}
