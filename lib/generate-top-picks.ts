// ── Top Picks generation — one Claude call per day for all users ───────────────
//
// Fetches TA + news for every stock in the curated universe in parallel,
// then asks Claude (top-0.1%-advisory persona) to pick the best stock per
// category and write an opinionated advisory thesis for each.

import Anthropic from '@anthropic-ai/sdk';
import { computeTAForTicker, formatTA } from './technical-indicators';
import {
  STOCK_UNIVERSE,
  PICK_CATEGORIES,
  CATEGORY_DESCRIPTIONS,
  type TopPick,
  type TopPicksData,
} from './top-picks-universe';

const client = new Anthropic();

// ── ETF query overrides (same pattern as briefing route) ──────────────────────
const ETF_QUERIES: Record<string, string> = {
  VAS:  'VAS Vanguard ASX 300 ETF Australia',
  VGS:  'VGS Vanguard international shares ETF MSCI World',
  NDQ:  'NDQ BetaShares NASDAQ 100 ETF ASX',
  GOLD: 'GOLD BetaShares gold bullion ETF AUD hedged ASX',
  SPY:  'SPY SPDR S&P 500 ETF',
  QQQ:  'QQQ Invesco NASDAQ 100 ETF',
  GLD:  'GLD SPDR gold shares ETF',
};

type YahooNewsItem = { title: string; publisher: string; providerPublishTime: number };
type YahooSearchResponse = { news?: YahooNewsItem[] };

async function fetchTickerNews(ticker: string, market: string): Promise<string> {
  try {
    const suffix = market === 'ASX' ? '.AX' : '';
    const query  = ETF_QUERIES[ticker] ?? `${ticker}${suffix}`;
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=5&quotesCount=0`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-briefing/1.0)' },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return '';
    const data = await res.json() as YahooSearchResponse;
    return (data.news ?? []).slice(0, 5).map(item => {
      const date = new Date(item.providerPublishTime * 1000)
        .toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Australia/Sydney' });
      return `[${date}] ${item.title} (${item.publisher})`;
    }).join('\n');
  } catch {
    return '';
  }
}

const OUTPUT_SCHEMA = `{
  "picks": [
    {
      "category": "HIGHEST CONVICTION" | "INCOME & YIELD" | "GROWTH CATALYST" | "DEFENSIVE ANCHOR" | "SPECULATIVE EDGE",
      "ticker": "TICKER",
      "market": "ASX" | "NASDAQ" | "NYSE",
      "signal": "ADD" | "HOLD" | "TRIM" | "EXIT",
      "confidence": "High" | "Medium" | "Low",
      "time_horizon": "1–3 months" | "3–6 months" | "6–12 months" | "1–2 years",
      "advisory_thesis": "2–3 sentences: why you'd own this right now. Specific, opinionated, cites a concrete reason.",
      "thesis_status": "intact" | "developing" | "broken",
      "sector": "e.g. Materials, Financials, Technology",
      "country": "e.g. Australia, United States, Global",
      "catalyst": "2–3 sentences on recent events driving the view. Cite inline: [Source: Yahoo Finance 2026-04-09]",
      "ta_context": "RSI level (label), MACD direction, DMA position — 1 sentence. Omit field entirely if TA data unavailable.",
      "upcoming_catalyst": "Next known event to watch",
      "what_to_watch": "Single most important risk or trigger",
      "risk_change": "increased" | "decreased" | "unchanged",
      "citations": ["Source: Yahoo Finance [date] — [headline]"]
    }
  ],
  "market_overview": "2–3 sentences on the current market regime and what it means for equity positioning right now."
}`;

export async function generateTopPicks(today: string): Promise<TopPicksData> {
  // ── Phase 1: fetch TA + news for entire universe in parallel ─────────────
  const universeData = await Promise.all(
    STOCK_UNIVERSE.map(async (stock) => {
      const [news, ta] = await Promise.all([
        fetchTickerNews(stock.ticker, stock.market),
        computeTAForTicker(stock.ticker, stock.market),
      ]);
      return { ...stock, news, ta };
    })
  );

  // ── Phase 2: build per-stock context block ────────────────────────────────
  const stockContext = universeData.map(s => {
    const taStr = formatTA(s.ta);
    const lines = [
      `## ${s.ticker} (${s.market}) — ${s.name}`,
      s.news ? `News:\n${s.news}` : 'News: No recent news.',
      taStr ? `Technical Analysis: ${taStr}` : 'Technical Analysis: Insufficient data.',
    ];
    return lines.join('\n');
  }).join('\n\n');

  // ── Phase 3: category descriptions for the prompt ─────────────────────────
  const categoryBlock = PICK_CATEGORIES.map((cat, i) =>
    `${i + 1}. ${cat} — ${CATEGORY_DESCRIPTIONS[cat]}`
  ).join('\n');

  // ── Phase 4: Claude synthesis ─────────────────────────────────────────────
  const prompt = `You are a managing partner at a top-tier private wealth advisory — ranked in the 0.1% of investment advisors globally by track record and assets under management. Your clients are sophisticated high-net-worth individuals who expect specific, high-conviction recommendations with unambiguous reasoning. You do not hedge excessively or give generic guidance. You take positions and defend them with evidence.

Today is ${today}.

YOUR TASK
Select exactly 5 stocks from the universe below — one per category. Each pick must be a different stock (no repeats across categories). For each, provide a complete advisory recommendation.

CATEGORIES (select exactly one stock per category):
${categoryBlock}

UNIVERSE OF STOCKS TO SELECT FROM (${STOCK_UNIVERSE.length} stocks):
${STOCK_UNIVERSE.map(s => `${s.ticker} (${s.market}) — ${s.name}`).join('\n')}

─────────────────────────────────────────────
PER-STOCK MARKET DATA
─────────────────────────────────────────────
${stockContext}

─────────────────────────────────────────────
YOUR STANDARDS
─────────────────────────────────────────────
1. advisory_thesis: 2–3 sentences. Specific and opinionated — state WHY you'd own this right now, not just what the company does. Reference the current market context.
2. catalyst: 2–3 sentences. Cite every claim inline: [Source: Yahoo Finance 2026-04-09].
3. ta_context: 1 sentence on RSI (with overbought/neutral/oversold label), MACD direction, and DMA position. Omit entirely if TA fields are null — do NOT fabricate.
4. time_horizon: Must be one of "1–3 months", "3–6 months", "6–12 months", "1–2 years".
5. signal: For top picks this should almost always be ADD or HOLD — justify any TRIM/EXIT pick explicitly in advisory_thesis.
6. market_overview: 2–3 sentences on the current regime (rates, growth, risk-off/risk-on) and what it means for equity positioning.
7. citations: 1–3 most important sources per pick.
8. No stock may appear in more than one category.

Return ONLY valid JSON (no markdown, no code fences) matching this exact structure:
${OUTPUT_SCHEMA}`;

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    messages: [{ role: 'user', content: prompt }],
  });

  const raw = response.content[0].type === 'text' ? response.content[0].text : '';
  const cleaned = raw.replace(/^```(?:json)?\n?/m, '').replace(/\n?```$/m, '').trim();
  const result = JSON.parse(cleaned) as { picks: TopPick[]; market_overview: string };

  const generated_at = new Date().toISOString();
  return { picks: result.picks, market_overview: result.market_overview, generated_at };
}
