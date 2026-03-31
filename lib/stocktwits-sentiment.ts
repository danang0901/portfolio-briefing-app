/**
 * Stocktwits sentiment divergence layer — US (NASDAQ/NYSE) tickers only.
 *
 * Public API, no auth required. Returns a divergence flag string when
 * retail sentiment strongly disagrees with the TA signal, or '' if silent.
 *
 * Divergence rules:
 *  - RSI > 70 AND bull% > 80%   → crowd top risk (overbought + euphoric)
 *  - RSI < 30 AND bull% < 20%   → capitulation (oversold + panic)
 *  - MACD bearish AND bull% > 75% → crowd buying into downtrend
 *  - MACD bullish AND bull% < 25% → crowd selling into uptrend
 *  - total < 10                  → insufficient data, return ''
 *  - No divergence               → return '' (silent)
 *
 * Rate limit: ~200 req/hour unauthenticated. Register a free API key at
 * api.stocktwits.com before user count reaches 15 (conservative: 10 US tickers/user).
 */

type StocktwitsMessage = {
  entities?: {
    sentiment?: { basic: 'Bullish' | 'Bearish' } | null;
  };
};

type StocktwitsResponse = {
  messages?: StocktwitsMessage[];
  errors?: { message: string }[];
};

// macdSignal values from TAResult: 'bullish crossover' | 'bullish' | 'bearish crossover' | 'bearish' | null
type SentimentInput = { rsi14: number | null; macdSignal: string | null };

function isMacdBullish(sig: string | null): boolean {
  return sig === 'bullish' || sig === 'bullish crossover';
}

function isMacdBearish(sig: string | null): boolean {
  return sig === 'bearish' || sig === 'bearish crossover';
}

/**
 * Fetch Stocktwits sentiment for a US ticker and return a divergence flag string.
 * Returns '' if no divergence, insufficient data, or on any error.
 * Only call for NASDAQ/NYSE tickers — ASX has no meaningful Stocktwits coverage.
 */
export async function fetchStocktwitsSentiment(
  ticker: string,
  ta: SentimentInput,
): Promise<string> {
  try {
    const url = `https://api.stocktwits.com/api/2/streams/symbol/${encodeURIComponent(ticker)}.json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PortfolioBriefing/1.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.warn(`[stocktwits] ${ticker}: HTTP ${res.status} — skipping`);
      return '';
    }

    const data = await res.json() as StocktwitsResponse;
    const messages = data.messages ?? [];

    let bullish = 0;
    let bearish = 0;
    for (const msg of messages) {
      const basic = msg.entities?.sentiment?.basic;
      if (basic === 'Bullish') bullish++;
      else if (basic === 'Bearish') bearish++;
    }
    const total = bullish + bearish;
    if (total < 10) return ''; // insufficient tagged data

    const bullPct = Math.round((bullish / total) * 100);
    const { rsi14, macdSignal } = ta;

    // Rule 1: Overbought + euphoric crowd → top risk
    if (rsi14 !== null && rsi14 > 70 && bullPct > 80) {
      return `⚠️ Crowd top risk: ${bullPct}% Stocktwits bullish despite RSI ${Math.round(rsi14)} (overbought)`;
    }

    // Rule 2: Oversold + panic crowd → potential bottom
    if (rsi14 !== null && rsi14 < 30 && bullPct < 20) {
      return `⚠️ Capitulation signal: ${bullPct}% Stocktwits bullish with RSI ${Math.round(rsi14)} (oversold) — potential bottom`;
    }

    // Rule 3: MACD bearish + crowd buying → crowd chasing into downtrend
    if (isMacdBearish(macdSignal) && bullPct > 75) {
      return `⚠️ Crowd buying into downtrend: ${bullPct}% bullish on Stocktwits, MACD ${macdSignal}`;
    }

    // Rule 4: MACD bullish + crowd selling → crowd capitulating into uptrend
    if (isMacdBullish(macdSignal) && bullPct < 25) {
      return `⚠️ Crowd selling into uptrend: ${bullPct}% bullish on Stocktwits, MACD ${macdSignal}`;
    }

    return ''; // no meaningful divergence
  } catch {
    return ''; // timeout, parse error, or network failure — never throw
  }
}
