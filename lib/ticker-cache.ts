/**
 * Shared ticker data cache — Supabase Postgres table, date-keyed by AEST.
 *
 * Each popular ticker (BHP, CBA, NDQ) is fetched once per day and reused
 * across all user briefings, cutting data-gathering costs 60-70%.
 *
 * Cache rules:
 * - "Today" = calendar date in Australia/Sydney (AEST/AEDT).
 * - Stocktwits is US-only: ASX tickers always return '' without an API call.
 * - Partial write failures leave the row with a NULL field; on next read
 *   that field is re-fetched and backfilled (never throws).
 * - If Supabase is not configured, all functions fall through to live fetches.
 */

import { createClient } from '@supabase/supabase-js';
import { computeTAForTicker, type TAResult } from './technical-indicators';
import { fetchASXAnnouncements } from './asx-announcements';
import { fetchStocktwitsSentiment } from './stocktwits-sentiment';

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
// Prefer service role for server-side writes; fall back to anon key
const supabaseKey    = process.env.SUPABASE_SERVICE_ROLE_KEY
  ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ?? '';
const cacheEnabled   = Boolean(supabaseUrl && supabaseKey);

function getClient() {
  return createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
}

/** Returns YYYY-MM-DD in Australia/Sydney timezone — the daily cache key. */
function todayAEST(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Australia/Sydney' });
}

type CacheRow = {
  ta_data:               TAResult | null;
  asx_announcements:     string[] | null;
  stocktwits_sentiment:  string | null;
};

async function readCache(
  ticker: string,
  market: string,
  date: string,
): Promise<Partial<CacheRow> | null> {
  if (!cacheEnabled) return null;
  try {
    const { data, error } = await getClient()
      .from('ticker_daily_cache')
      .select('ta_data, asx_announcements, stocktwits_sentiment')
      .eq('ticker', ticker)
      .eq('market', market)
      .eq('date', date)
      .single();
    if (error && error.code !== 'PGRST116') {
      // PGRST116 = no rows found; other errors are unexpected but non-blocking
      console.warn(`[ticker-cache] read error ${ticker}/${market}: ${error.message}`);
    }
    return data ?? null;
  } catch {
    return null;
  }
}

async function writeCache(
  ticker: string,
  market: string,
  date: string,
  fields: Partial<CacheRow>,
): Promise<void> {
  if (!cacheEnabled) return;
  try {
    await getClient()
      .from('ticker_daily_cache')
      .upsert(
        { ticker, market, date, ...fields, computed_at: new Date().toISOString() },
        { onConflict: 'ticker,market,date' },
      );
  } catch {
    // Cache writes are non-blocking — a write failure never breaks a briefing
  }
}

// ── Public cached wrappers ────────────────────────────────────────────────────

/**
 * Returns today's TA result for the ticker, using the Supabase cache.
 * Cache miss → fetches from Yahoo Finance and stores the result.
 */
export async function getCachedTA(ticker: string, market: string): Promise<TAResult> {
  const date   = todayAEST();
  const cached = await readCache(ticker, market, date);
  if (cached?.ta_data != null) return cached.ta_data;

  const result = await computeTAForTicker(ticker, market);
  await writeCache(ticker, market, date, { ta_data: result });
  return result;
}

/**
 * Returns today's ASX announcements for an ASX ticker, using the Supabase cache.
 * Only call for ASX market tickers.
 */
export async function getCachedASXAnnouncements(ticker: string): Promise<string[]> {
  const date   = todayAEST();
  const cached = await readCache(ticker, 'ASX', date);
  if (cached?.asx_announcements != null) return cached.asx_announcements;

  const result = await fetchASXAnnouncements(ticker);
  await writeCache(ticker, 'ASX', date, { asx_announcements: result });
  return result;
}

/**
 * Returns today's Stocktwits divergence flag for a US ticker, using the Supabase cache.
 * ASX tickers always return '' — Stocktwits has no meaningful ASX coverage.
 * @param ta  Today's TA result — used to compute divergence on cache miss.
 */
export async function getCachedStocktwitsSentiment(
  ticker: string,
  market: string,
  ta: { rsi14: number | null; macdSignal: string | null },
): Promise<string> {
  // Stocktwits is US-only; ASX is NULL by design, not a failure state
  if (market === 'ASX') return '';

  const date   = todayAEST();
  const cached = await readCache(ticker, market, date);
  if (cached?.stocktwits_sentiment != null) return cached.stocktwits_sentiment;

  const result = await fetchStocktwitsSentiment(ticker, ta);
  // Write even if result is '' (empty string = no divergence, still a valid cache hit)
  // Use null to represent "fetch failed or not applicable"; '' = no divergence
  await writeCache(ticker, market, date, { stocktwits_sentiment: result });
  return result;
}

/**
 * Pre-warms the cache for a list of tickers.
 * Called by the 9:00am AEST warm-up cron, 30 minutes before user traffic arrives.
 * Uses Promise.allSettled — one ticker failing never blocks the others.
 */
export async function warmupTickers(
  tickers: Array<{ ticker: string; market: string }>,
): Promise<{ warmed: number; failed: number }> {
  const results = await Promise.allSettled(
    tickers.map(async ({ ticker, market }) => {
      const ta = await getCachedTA(ticker, market);
      if (market === 'ASX') {
        await getCachedASXAnnouncements(ticker);
      } else {
        await getCachedStocktwitsSentiment(ticker, market, ta);
      }
    }),
  );
  const failed = results.filter(r => r.status === 'rejected').length;
  return { warmed: results.length - failed, failed };
}
