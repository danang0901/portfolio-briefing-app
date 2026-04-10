/**
 * Core briefing generation logic — shared between the streaming API route
 * (/api/briefing) and the cron route (/api/cron/morning-briefing).
 *
 * The API route wraps this with NDJSON streaming and uses the callbacks to
 * emit per-stock progress events. The cron calls it directly.
 */

import Anthropic from '@anthropic-ai/sdk';
import { formatTA } from '@/lib/technical-indicators';
import { getCachedTA, getCachedASXAnnouncements, getCachedStocktwitsSentiment } from '@/lib/ticker-cache';
import { buildEconomicCalendar } from '@/lib/economic-calendar';
import type { StockSignal, BriefingOverview, BriefingData } from '@/app/api/briefing/route';

const client = new Anthropic();

export type Holding = { ticker: string; units: number; market?: 'ASX' | 'NASDAQ' | 'NYSE' };

const OUTPUT_SCHEMA = `{
  "stocks": [
    {
      "ticker": "TICKER",
      "signal": "ADD" | "HOLD" | "TRIM" | "EXIT",
      "confidence": "High" | "Medium" | "Low",
      "thesis_status": "intact" | "developing" | "broken",
      "sector": "e.g. Materials, Financials, Consumer Staples, ETF — Global Equities",
      "country": "e.g. Australia, United States, Global",
      "catalyst": "2-3 sentences on recent news or events relevant to this holding. If no material events: set to 'No material events this week.' Cite sources inline.",
      "ta_context": "2 sentences: (1) What the RSI level means in plain English, e.g. 'RSI 67 suggests the stock is approaching overbought territory after a recent run.' (2) What the DMA position implies, e.g. 'Trading 8% above the 200-day moving average indicates momentum remains above the long-term trend.' Omit field entirely if TA data unavailable.",
      "upcoming_catalyst": "Next known event to watch",
      "what_to_watch": "Single most important risk or trigger right now",
      "risk_change": "increased" | "decreased" | "unchanged",
      "citations": ["Source Name, DD Mon YYYY — Exact Article Headline", "ASX Announcement, DD Mon YYYY — Exact Announcement Title"]
    }
  ],
  "overview": {
    "executive_summary": "2-3 sentences covering the most important portfolio-wide observation this week. Name specific holdings. Highlight any signals that changed from the prior week if known.",
    "watch_list": ["3-5 specific items to watch this week"],
    "priority_actions": ["One line per ADD/TRIM/EXIT signal only — empty array if all HOLD"],
    "sector_breakdown": "1-2 sentences on sector concentration and imbalances",
    "region_exposure": "1-2 sentences on geographic exposure",
    "risk_profile": "1-2 sentences on overall portfolio risk",
    "macro_note": "2-3 sentences naming at least 2 specific holdings from this portfolio and explaining how each upcoming macro event affects them specifically. Generic commentary is not acceptable.",
    "macro_context": {
      "rba_next_decision": "Date + expected outcome for AU bank/rate-sensitive holdings",
      "us_fed_watch": "Current Fed stance in 1 sentence",
      "economic_calendar_7d": ["Upcoming events from the calendar — include dates"]
    }
  }
}`;

type YahooNewsItem = { title: string; publisher: string; providerPublishTime: number };
type YahooSearchResponse = { news?: YahooNewsItem[] };

async function fetchTickerNews(ticker: string, market = 'ASX'): Promise<string> {
  try {
    const etfQueries: Record<string, string> = {
      VGS: 'VGS Vanguard global equities ETF MSCI World',
      VAS: 'VAS Vanguard ASX 300 ETF Australia market',
      VAE: 'VAE Vanguard Asian emerging markets ETF',
    };
    const suffix = market === 'ASX' ? '.AX' : '';
    const query = etfQueries[ticker] ?? `${ticker}${suffix}`;
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
        .toLocaleDateString('en-AU', {
          day: 'numeric', month: 'short', year: 'numeric',
          timeZone: 'Australia/Sydney',
        });
      return `[${date}] ${item.title} (${item.publisher})`;
    }).join('\n');
  } catch {
    return '';
  }
}

export async function generateBriefing(
  holdings: Holding[],
  callbacks?: {
    onProgress?: (msg: string) => void;
    onStock?: (stock: StockSignal) => void;
  },
): Promise<BriefingData> {
  const onProgress = callbacks?.onProgress ?? (() => {});
  const onStock    = callbacks?.onStock    ?? (() => {});

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  // ── Phase 1a: Per-ticker parallel data gathering ────────────────────────────
  const perTickerResults = await Promise.all(
    holdings.map(async (h) => {
      const market = h.market ?? 'ASX';
      onProgress(`Fetching ${h.ticker}…`);

      const [news, ta, announcements] = await Promise.all([
        fetchTickerNews(h.ticker, market),
        getCachedTA(h.ticker, market),
        market === 'ASX' ? getCachedASXAnnouncements(h.ticker) : Promise.resolve([]),
      ]);

      const sentimentFlag = await getCachedStocktwitsSentiment(h.ticker, market, ta);

      if (news || ta.currentPrice !== null) {
        onProgress(`✓ ${h.ticker}`);
      }
      return { ticker: h.ticker, market, units: h.units, news, ta, announcements, sentimentFlag };
    })
  );

  // ── Phase 1b: Portfolio-wide data ───────────────────────────────────────────
  onProgress('Fetching macro context…');
  const economicCalendar = buildEconomicCalendar(14);

  const newsSourced = perTickerResults.some(r => r.news.length > 0);
  const marketsInPortfolio = [...new Set(holdings.map(h => h.market ?? 'ASX'))];

  // ── Phase 2: Sonnet synthesis ───────────────────────────────────────────────
  onProgress('Generating signals…');

  const holdingsText = holdings
    .map(h => `  ${h.ticker} (${h.market ?? 'ASX'}): ${h.units.toLocaleString()} units`)
    .join('\n');

  const perTickerContext = perTickerResults.map(r => {
    const taStr = formatTA(r.ta);
    const lines: string[] = [`## ${r.ticker} (${r.market})`];
    lines.push(r.news ? `News:\n${r.news}` : 'News: No recent news available.');
    lines.push(taStr ? `Technical Analysis: ${taStr}` : 'Technical Analysis: Insufficient data.');
    if (r.announcements.length > 0) {
      lines.push(`Recent ASX Announcements:\n${r.announcements.join('\n')}`);
    }
    if (r.sentimentFlag) {
      lines.push(`Community Sentiment: ${r.sentimentFlag}`);
    }
    return lines.join('\n');
  }).join('\n\n');

  const synthesisPrompt = `You are a senior analyst preparing an information briefing for a portfolio manager who will make their own investment decisions. Your role is to surface relevant information, highlight data points worth monitoring, and identify where risk has changed — not to prescribe action.

Do NOT use imperative language. Use phrases like "the data suggests", "worth monitoring", "risk has increased", "the thesis remains intact". Never use "you should", "consider buying", "we recommend", or any other prescriptive language.

Today is ${today}. Markets in this portfolio: ${marketsInPortfolio.join(', ')}.

Portfolio:
${holdingsText}

─────────────────────────────────────────────
PER-HOLDING DATA
─────────────────────────────────────────────
${perTickerContext}

─────────────────────────────────────────────
ECONOMIC CALENDAR (next 14 days)
─────────────────────────────────────────────
${economicCalendar}

─────────────────────────────────────────────
YOUR STANDARDS
─────────────────────────────────────────────
1. Cite every catalyst claim inline. Format: "Source Name, DD Mon YYYY — Exact Headline". Do not use vague citations like "Yahoo Finance" alone.
2. "ta_context": 2 sentences — (1) plain-English RSI interpretation, (2) DMA position implication. Do NOT fabricate TA values. Omit field entirely if TA data is null.
3. "macro_note": name ≥2 specific holdings from this portfolio and explain how each upcoming event affects them. Generic macro commentary ("rates are a headwind for equities") is not acceptable.
4. Signals: ADD/HOLD/TRIM/EXIT only. Long-term hold portfolio — default to HOLD unless there is clear evidence of a meaningful change.
5. "citations" array: 1-3 sources per stock, most important first. Format each as "Source Name, DD Mon YYYY — Exact Headline".
6. If "Community Sentiment" is present in a ticker's data, include the flag verbatim as the final sentence of that ticker's "catalyst" field.
7. Quiet week rule: if a ticker has no news AND TA is neutral (RSI 40-60) AND no announcements, set "catalyst" to "No material events this week." and "confidence" to "Low".

Signal definitions:
- ADD: Strengthen position — thesis building or entry attractive
- HOLD: Maintain — thesis intact, no action
- TRIM: Reduce — thesis weakening, risk increased, or position oversized
- EXIT: Close — thesis broken or investment case fundamentally changed

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
    max_tokens: 6000,
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
                onStock(stock);
                emittedTickers.add(stock.ticker);
              }
            } catch {
              // partial — caught by fallback below
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
    if (!emittedTickers.has(stock.ticker)) onStock(stock);
  }

  return {
    stocks:       result.stocks,
    overview:     result.overview,
    generated_at: new Date().toISOString(),
    news_sourced: newsSourced,
  };
}
