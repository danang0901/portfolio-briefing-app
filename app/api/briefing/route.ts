import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { kv } from '@vercel/kv';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const client = new Anthropic();
const isKvConfigured = !!(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

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

// 8-char hex SHA-256 of sorted holdings — used in cache key
function portfolioHash(holdings: Holding[]): string {
  const sorted = [...holdings].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 8);
}

// Today's date in AEST as YYYY-MM-DD (en-CA locale returns ISO-style date)
function todayAEST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

type AnyMessage = {
  stop_reason: string;
  content: Array<{ type: string; text?: string; tool_use_id?: string }>;
};

// Search news for a single ticker using Haiku (web_search beta, max 4 iterations)
async function searchTicker(ticker: string, today: string): Promise<string> {
  const prompt = `Search for recent ASX news for ${ticker}. Today is ${today}.
Include ALL of the following:
1. Price-moving events in the past 3 weeks (announcements, results, guidance changes) — include dates and figures
2. Upcoming catalysts in the next 2 months (earnings, AGM, capital events, macro data releases)
3. Recent analyst actions (upgrades, downgrades, price target changes)
For index ETFs (VGS, VAS, VAE): focus on index drivers and macro tailwinds/headwinds instead of #3.
Be specific — if you can't find recent information, say so explicitly.`;

  const betaCreate = client.beta.messages.create.bind(client.beta.messages) as (
    params: unknown
  ) => Promise<AnyMessage>;

  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: prompt }];

  for (let i = 0; i < 4; i++) {
    const response = await betaCreate({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages,
      betas: ['web-search-2025-03-05'],
    });

    const text = response.content
      .filter(b => b.type === 'text')
      .map(b => b.text ?? '')
      .join('\n');

    if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
      return text;
    }

    if (response.stop_reason === 'tool_use') {
      // Push assistant response; server handles web search tool execution automatically.
      // If no client-side tool_use blocks exist, the text so far is the result.
      messages.push({ role: 'assistant', content: response.content as Anthropic.ContentBlock[] });
      const hasClientTools = response.content.some(b => b.type === 'tool_use');
      if (!hasClientTools) {
        return text;
      }
    } else {
      return text;
    }
  }

  return '';
}

export async function POST(req: Request) {
  const body = await req.json();
  const holdings = (body.portfolio ?? []) as Holding[];
  const userId = (body.userId ?? '') as string;
  const isCron =
    !!process.env.CRON_SECRET &&
    req.headers.get('Authorization') === `Bearer ${process.env.CRON_SECRET}`;

  if (!holdings.length) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Portfolio is empty.' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  const pHash = portfolioHash(holdings);
  const dateKey = todayAEST();
  const cacheKey = userId ? `briefing:${userId}:${dateKey}:${pHash}` : null;
  const rateLimitKey = userId ? `ratelimit:${userId}:${dateKey}` : null;

  // ── Cache hit ────────────────────────────────────────────────────────────────
  if (cacheKey && isKvConfigured) {
    try {
      const cached = await kv.get<BriefingData>(cacheKey);
      if (cached) {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            for (const stock of cached.stocks) {
              controller.enqueue(encoder.encode(JSON.stringify({ type: 'stock', data: stock }) + '\n'));
            }
            controller.enqueue(encoder.encode(
              JSON.stringify({ type: 'overview', data: cached.overview }) + '\n'
            ));
            controller.enqueue(encoder.encode(
              JSON.stringify({ type: 'done', generated_at: cached.generated_at, news_sourced: cached.news_sourced }) + '\n'
            ));
            controller.close();
          },
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
      }
    } catch {
      // KV unavailable — proceed without cache
    }
  }

  // ── Rate limiting (skip for cron) ────────────────────────────────────────────
  if (rateLimitKey && isKvConfigured && !isCron) {
    try {
      const count = await kv.incr(rateLimitKey);
      if (count === 1) await kv.expire(rateLimitKey, 25 * 60 * 60);
      if (count > 3) {
        return new Response(
          JSON.stringify({
            type: 'error',
            message: 'Daily regeneration limit reached (3/day). Your briefing refreshes automatically each morning.',
          }) + '\n',
          { status: 429, headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
    } catch {
      // KV unavailable — skip rate limiting
    }
  }

  // ── Generation ───────────────────────────────────────────────────────────────
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      function emit(event: StreamEvent) {
        controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
      }

      try {
        // ── Phase 1: Parallel per-ticker search (Haiku) ──────────────────────
        emit({ type: 'progress', message: 'Starting news search…' });

        let newsContext = '';
        let newsSourced = false;

        try {
          const searchResults = await Promise.all(
            holdings.map(async (h) => {
              emit({ type: 'progress', message: `Searching ${h.ticker}…` });
              const summary = await searchTicker(h.ticker, today);
              emit({ type: 'progress', message: `✓ ${h.ticker} done` });
              return { ticker: h.ticker, summary };
            })
          );
          const withData = searchResults.filter(r => r.summary.length > 0);
          if (withData.length > 0) {
            newsContext = withData.map(r => `${r.ticker}:\n${r.summary}`).join('\n\n');
            newsSourced = true;
          }
        } catch {
          newsContext = '';
          newsSourced = false;
        }

        // ── Phase 2: Synthesis (Sonnet — unchanged) ───────────────────────────
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
${contextSection}Signal definitions:
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

        const generatedAt = new Date().toISOString();

        for (const stock of result.stocks) {
          emit({ type: 'stock', data: stock });
        }
        emit({ type: 'overview', data: result.overview });
        emit({ type: 'done', generated_at: generatedAt, news_sourced: newsSourced });

        // ── Write to cache ───────────────────────────────────────────────────
        if (cacheKey && isKvConfigured) {
          try {
            await kv.set(
              cacheKey,
              { stocks: result.stocks, overview: result.overview, generated_at: generatedAt, news_sourced: newsSourced } satisfies BriefingData,
              { ex: 25 * 60 * 60 },
            );
          } catch {
            // KV write failed — not critical, user already received their briefing
          }
        }
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
