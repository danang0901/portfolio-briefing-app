import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const client = new Anthropic();

// Use anon key + user JWT (same auth path the frontend uses — service role caused PGRST205)
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function getUserClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

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

type StreamEvent =
  | { type: 'progress'; message: string }
  | { type: 'stock'; data: StockSignal }
  | { type: 'overview'; data: BriefingOverview }
  | { type: 'done'; generated_at: string; news_sourced: boolean; from_cache: boolean }
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

function portfolioHash(holdings: Holding[]): string {
  const sorted = [...holdings].sort((a, b) => a.ticker.localeCompare(b.ticker));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 8);
}

type YahooNewsItem = { title: string; publisher: string; providerPublishTime: number };
type YahooSearchResponse = { news?: YahooNewsItem[] };

async function fetchTickerNews(ticker: string): Promise<string> {
  try {
    const etfQueries: Record<string, string> = {
      VGS: 'VGS Vanguard global equities ETF MSCI World',
      VAS: 'VAS Vanguard ASX 300 ETF Australia market',
      VAE: 'VAE Vanguard Asian emerging markets ETF',
    };
    const query = etfQueries[ticker] ?? `${ticker}.AX`;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=8&quotesCount=0`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-briefing/1.0)' },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return '';
    const data = await res.json() as YahooSearchResponse;
    const items = data.news ?? [];
    if (items.length === 0) return '';

    return items.slice(0, 8).map(item => {
      const date = new Date(item.providerPublishTime * 1000)
        .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
      return `[${date}] ${item.title} (${item.publisher})`;
    }).join('\n');
  } catch {
    return '';
  }
}

export async function POST(req: Request) {
  const body = await req.json();
  const holdings = (body.portfolio ?? []) as Holding[];
  const userId = (body.userId ?? '') as string;
  const accessToken = (body.accessToken ?? '') as string;
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
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── Cache check + rate limiting ──────────────────────────────────────────────
  console.log('[briefing] userId:', userId || '(empty)', '| token:', accessToken ? 'present' : 'missing', '| supabaseConfigured:', isSupabaseConfigured, '| isCron:', isCron);

  if (userId && accessToken && isSupabaseConfigured && !isCron) {
    try {
      const { data: cached, error: cacheError } = await getUserClient(accessToken)
        .from('briefings')
        .select('briefing_data, portfolio_snapshot')
        .eq('user_id', userId)
        .gte('created_at', twentyFourHoursAgo)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (cacheError && cacheError.code !== 'PGRST116') {
        console.error('[briefing] Cache query error:', cacheError.code, cacheError.message);
      } else {
        console.log('[briefing] Cache query ok, found:', !!cached);
      }

      if (cached) {
        const cachedHash = cached.portfolio_snapshot
          ? portfolioHash(cached.portfolio_snapshot as Holding[])
          : null;

        if (cachedHash === pHash) {
          console.log('[briefing] Cache hit — serving stored briefing');
          const briefing = cached.briefing_data as BriefingData;
          const encoder = new TextEncoder();
          const stream = new ReadableStream({
            start(controller) {
              try {
                for (const stock of (briefing.stocks ?? [])) {
                  controller.enqueue(encoder.encode(JSON.stringify({ type: 'stock', data: stock }) + '\n'));
                }
                controller.enqueue(encoder.encode(
                  JSON.stringify({ type: 'overview', data: briefing.overview }) + '\n'
                ));
                controller.enqueue(encoder.encode(
                  JSON.stringify({ type: 'done', generated_at: briefing.generated_at, news_sourced: briefing.news_sourced, from_cache: true }) + '\n'
                ));
              } catch (e) {
                controller.enqueue(encoder.encode(
                  JSON.stringify({ type: 'error', message: `Cache read error: ${String(e)}` }) + '\n'
                ));
              }
              controller.close();
            },
          });
          return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
        }

        console.log('[briefing] Portfolio changed — blocking regeneration');
        return new Response(
          JSON.stringify({
            type: 'error',
            message: 'Daily limit reached (1/day). Your briefing refreshes automatically each morning.',
          }) + '\n',
          { status: 429, headers: { 'Content-Type': 'application/x-ndjson' } },
        );
      }
    } catch (e) {
      console.error('[briefing] Cache check exception:', String(e));
      // Supabase unavailable — proceed without cache/rate limiting
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
        // ── Phase 1: Fetch news (parallel, 15s hard cap) ──────────────────────
        emit({ type: 'progress', message: 'Fetching market news…' });

        let newsContext = '';
        let newsSourced = false;

        try {
          const timeout = new Promise<{ ticker: string; news: string }[]>((resolve) =>
            setTimeout(() => resolve(holdings.map(h => ({ ticker: h.ticker, news: '' }))), 15000)
          );

          const fetches = Promise.all(
            holdings.map(async (h) => {
              emit({ type: 'progress', message: `Fetching ${h.ticker}…` });
              const news = await fetchTickerNews(h.ticker);
              if (news) emit({ type: 'progress', message: `✓ ${h.ticker}` });
              return { ticker: h.ticker, news };
            })
          );

          const newsResults = await Promise.race([fetches, timeout]);
          const withNews = newsResults.filter(r => r.news.length > 0);
          if (withNews.length > 0) {
            newsContext = withNews.map(r => `${r.ticker}:\n${r.news}`).join('\n\n');
            newsSourced = true;
          }
        } catch {
          newsContext = '';
          newsSourced = false;
        }

        // ── Phase 2: Streaming synthesis with Sonnet ──────────────────────────
        emit({ type: 'progress', message: 'Generating signals…' });

        const holdingsText = holdings
          .map(h => `  ${h.ticker}: ${h.units.toLocaleString()} units`)
          .join('\n');

        const contextSection = newsContext
          ? `\nRecent news headlines:\n${newsContext}\n`
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

        let parseState: 'before_stocks' | 'in_stocks' | 'after_stocks' = 'before_stocks';
        let accumulated = '';
        let inStr = false;
        let esc = false;
        let depth = 0;
        let objectStart = -1;
        const emittedTickers = new Set<string>();

        const synthStream = client.messages.stream({
          model: 'claude-sonnet-4-6',
          max_tokens: 4096,
          messages: [{ role: 'user', content: synthesisPrompt }],
        });

        for await (const chunk of synthStream) {
          if (chunk.type !== 'content_block_delta' || chunk.delta.type !== 'text_delta') continue;

          for (const ch of chunk.delta.text) {
            accumulated += ch;

            if (esc) { esc = false; continue; }
            if (ch === '\\' && inStr) { esc = true; continue; }
            if (ch === '"') { inStr = !inStr; continue; }
            if (inStr) continue;

            if (parseState === 'before_stocks') {
              if (ch === '[') {
                const tail = accumulated.slice(-40);
                if (/"stocks"\s*:\s*\[$/.test(tail)) {
                  parseState = 'in_stocks';
                  depth = 0;
                  objectStart = -1;
                }
              }
            } else if (parseState === 'in_stocks') {
              if (ch === '{') {
                if (depth === 0) objectStart = accumulated.length - 1;
                depth++;
              } else if (ch === '}') {
                depth--;
                if (depth === 0 && objectStart !== -1) {
                  const objStr = accumulated.slice(objectStart);
                  try {
                    const stock = JSON.parse(objStr) as StockSignal;
                    if (stock.ticker && !emittedTickers.has(stock.ticker)) {
                      emit({ type: 'stock', data: stock });
                      emittedTickers.add(stock.ticker);
                    }
                  } catch {
                    // Partial — caught by fallback below
                  }
                  objectStart = -1;
                }
              } else if (ch === ']' && depth === 0) {
                parseState = 'after_stocks';
              }
            }
          }
        }

        // Fallback: parse full accumulated text for missed stocks + overview
        const cleaned = accumulated.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
        const result = JSON.parse(cleaned) as { stocks: StockSignal[]; overview: BriefingOverview };

        for (const stock of result.stocks) {
          if (!emittedTickers.has(stock.ticker)) emit({ type: 'stock', data: stock });
        }

        const generatedAt = new Date().toISOString();
        emit({ type: 'overview', data: result.overview });
        emit({ type: 'done', generated_at: generatedAt, news_sourced: newsSourced, from_cache: false });

        // ── Store in Supabase so next request hits cache ───────────────────────
        if (userId && accessToken && isSupabaseConfigured) {
          try {
            const { error: insertError } = await getUserClient(accessToken).from('briefings').insert({
              user_id: userId,
              briefing_data: { stocks: result.stocks, overview: result.overview, generated_at: generatedAt, news_sourced: newsSourced } satisfies BriefingData,
              portfolio_snapshot: holdings,
            });
            if (insertError) {
              console.error('[briefing] Insert error:', insertError.code, insertError.message);
            } else {
              console.log('[briefing] Stored in Supabase for', userId);
            }
          } catch (e) {
            console.error('[briefing] Insert exception:', String(e));
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[briefing] Stream error:', message);
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
