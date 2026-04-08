/**
 * Cache warm-up cron — runs at 9:00am AEST (23:00 UTC) daily, 30 min before
 * the morning briefing cron at 9:30am AEST. Pre-fetches TA + announcements /
 * sentiment for the top 10 most-held tickers across all user portfolios so the
 * first briefing of the day hits the cache instead of calling external APIs.
 */
import { createClient } from '@supabase/supabase-js';
import { warmupTickers } from '@/lib/ticker-cache';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
// Must use the service role key — this route reads ALL users' portfolios.
// Never fall back to the anon key: with RLS enabled, the anon key would return
// zero rows (silent failure); without RLS it would expose all user data.
const supabaseKey    = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

export async function GET(request: Request) {
  // Vercel cron auth
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!supabaseUrl || !supabaseKey) {
    const missing = !supabaseUrl ? 'NEXT_PUBLIC_SUPABASE_URL' : 'SUPABASE_SERVICE_ROLE_KEY';
    console.error(`[cache-warmup] ${missing} is not set — aborting`);
    return NextResponse.json({ error: `Missing env var: ${missing}` }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });

  // Fetch all portfolios, flatten holdings, count by ticker+market
  const { data: rows, error } = await supabase
    .from('portfolios')
    .select('holdings');

  if (error) {
    console.error('[cache-warmup] failed to fetch portfolios:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const counts = new Map<string, { ticker: string; market: string; count: number }>();

  for (const row of rows ?? []) {
    const holdings = Array.isArray(row.holdings) ? row.holdings : [];
    for (const h of holdings) {
      if (!h.ticker || !h.market) continue;
      const key = `${h.ticker}:${h.market}`;
      const existing = counts.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(key, { ticker: h.ticker, market: h.market, count: 1 });
      }
    }
  }

  // Top 10 tickers by portfolio count
  const top10 = [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 10)
    .map(({ ticker, market }) => ({ ticker, market }));

  const result = await warmupTickers(top10);

  console.log(`[cache-warmup] warmed ${result.warmed}/${top10.length}, failed ${result.failed}`);

  return NextResponse.json({
    tickers: top10,
    warmed: result.warmed,
    failed: result.failed,
  });
}
