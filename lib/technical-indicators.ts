import { toYahooSymbol } from './yahoo-symbol';

export type TAResult = {
  rsi14: number | null;
  macdSignal: string | null; // 'bullish crossover' | 'bullish' | 'bearish crossover' | 'bearish'
  vs200dma: string | null;   // e.g. '+4.2% above 200DMA'
  vs50dma: string | null;
  currentPrice: number | null;
};

// ── Math helpers ──────────────────────────────────────────────────────────────

function ema(values: number[], period: number): number[] {
  if (values.length < period) return [];
  const k = 2 / (period + 1);
  let avg = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [avg];
  for (let i = period; i < values.length; i++) {
    avg = values[i] * k + avg * (1 - k);
    result.push(avg);
  }
  return result;
}

function rsi(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss += -diff;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 10) / 10;
}

function macdSignalString(closes: number[]): string | null {
  // ema12 starts at index 11, ema26 starts at index 25 → offset = 14
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  if (ema12.length < 15 || ema26.length < 1) return null; // need offset + at least 1 ema26 value

  const macdLine: number[] = [];
  for (let i = 0; i < ema26.length; i++) {
    macdLine.push(ema12[i + 14] - ema26[i]);
  }

  const signalLine = ema(macdLine, 9);
  if (signalLine.length < 2) return null;

  const lastMACD = macdLine[macdLine.length - 1];
  const lastSig = signalLine[signalLine.length - 1];
  const prevMACD = macdLine[macdLine.length - 2];
  const prevSig = signalLine[signalLine.length - 2];

  if (prevMACD <= prevSig && lastMACD > lastSig) return 'bullish crossover';
  if (prevMACD >= prevSig && lastMACD < lastSig) return 'bearish crossover';
  return lastMACD > lastSig ? 'bullish' : 'bearish';
}

function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  return values.slice(-period).reduce((a, b) => a + b, 0) / period;
}

// ── OHLCV fetch ───────────────────────────────────────────────────────────────

async function fetchCloses(ticker: string, market: string): Promise<number[]> {
  try {
    const symbol = toYahooSymbol(ticker, market);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-briefing/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const closes: (number | null)[] = data?.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? [];
    return closes.filter((c): c is number => c !== null && isFinite(c));
  } catch {
    return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function computeTAForTicker(ticker: string, market: string): Promise<TAResult> {
  const closes = await fetchCloses(ticker, market);

  if (closes.length < 2) {
    return { rsi14: null, macdSignal: null, vs200dma: null, vs50dma: null, currentPrice: null };
  }

  const current = closes[closes.length - 1];
  const sma200 = sma(closes, 200);
  const sma50 = sma(closes, 50);

  const pctDiff = (price: number, ma: number) => {
    const pct = ((price - ma) / ma) * 100;
    const r = Math.round(pct * 10) / 10;
    return r >= 0 ? `+${r}%` : `${r}%`;
  };

  return {
    rsi14: rsi(closes),
    macdSignal: macdSignalString(closes),
    vs200dma: sma200 ? `${pctDiff(current, sma200)} vs 200DMA` : null,
    vs50dma: sma50 ? `${pctDiff(current, sma50)} vs 50DMA` : null,
    currentPrice: Math.round(current * 100) / 100,
  };
}

export function formatTA(ta: TAResult): string {
  const parts: string[] = [];
  if (ta.rsi14 !== null) {
    const rsiLabel = ta.rsi14 >= 70 ? 'overbought' : ta.rsi14 <= 30 ? 'oversold' : 'neutral';
    parts.push(`RSI ${ta.rsi14} (${rsiLabel})`);
  }
  if (ta.macdSignal) parts.push(`MACD ${ta.macdSignal}`);
  if (ta.vs200dma) parts.push(ta.vs200dma);
  if (ta.vs50dma) parts.push(ta.vs50dma);
  return parts.join('. ');
}
