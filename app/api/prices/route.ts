import { NextResponse } from 'next/server';
import { toYahooSymbol } from '@/lib/yahoo-symbol';

export const revalidate = 3600; // cache 1 hour at edge

type HoldingInput = { ticker: string; market: string };

type PriceResult = {
  ticker: string;
  change5d: number | null;
  label: string;
  direction: 'up' | 'down' | 'flat' | null;
};

// Yahoo Finance unofficial chart API — no key required
async function fetchPrice(ticker: string, market: string): Promise<PriceResult> {
  const symbol = toYahooSymbol(ticker, market);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=7d`;

  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('no result');

    const closes: (number | null)[] = result.indicators?.quote?.[0]?.close ?? [];
    const valid = closes.filter((c): c is number => c !== null && isFinite(c));

    if (valid.length < 2) throw new Error('insufficient data');

    const latest = valid[valid.length - 1];
    const oldest = valid[0];
    const change5d = ((latest - oldest) / oldest) * 100;
    const rounded = Math.round(change5d * 10) / 10;
    const sign = rounded >= 0 ? '+' : '';

    return {
      ticker,
      change5d: rounded,
      label: `${sign}${rounded}% (5d)`,
      direction: rounded > 0.1 ? 'up' : rounded < -0.1 ? 'down' : 'flat',
    };
  } catch {
    return { ticker, change5d: null, label: '', direction: null };
  }
}

export async function POST(req: Request) {
  const body = await req.json();

  // Accept { holdings: [{ ticker, market }] } or legacy { tickers: string[] }
  let holdingsToFetch: HoldingInput[];
  if (Array.isArray(body.holdings)) {
    holdingsToFetch = body.holdings as HoldingInput[];
  } else if (Array.isArray(body.tickers)) {
    holdingsToFetch = (body.tickers as string[]).map(t => ({ ticker: t, market: 'ASX' }));
  } else {
    return NextResponse.json({ prices: {} });
  }

  if (holdingsToFetch.length === 0) {
    return NextResponse.json({ prices: {} });
  }

  const results = await Promise.all(holdingsToFetch.map(h => fetchPrice(h.ticker, h.market)));
  const prices: Record<string, PriceResult> = {};
  for (const r of results) {
    prices[r.ticker] = r;
  }

  return NextResponse.json({ prices });
}
