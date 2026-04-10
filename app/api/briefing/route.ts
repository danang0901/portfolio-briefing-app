import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { generateBriefing } from '@/lib/briefing-generator';
import type { Holding } from '@/lib/briefing-generator';

export const dynamic = 'force-dynamic';
export const maxDuration = 90;

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';
const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

function getUserClient(accessToken: string) {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export type { Holding };

export type StockSignal = {
  ticker: string;
  signal: 'ADD' | 'HOLD' | 'TRIM' | 'EXIT';
  confidence: 'High' | 'Medium' | 'Low';
  thesis_status: 'intact' | 'developing' | 'broken';
  sector: string;
  country: string;
  catalyst: string;
  ta_context?: string;
  upcoming_catalyst: string;
  what_to_watch: string;
  risk_change: 'increased' | 'decreased' | 'unchanged';
  citations?: string[];
};

export type BriefingOverview = {
  executive_summary: string;
  watch_list: string[];
  priority_actions: string[];
  sector_breakdown: string;
  region_exposure: string;
  risk_profile: string;
  macro_note: string;
  macro_context?: {
    rba_next_decision?: string;
    us_fed_watch?: string;
    economic_calendar_7d?: string[];
  };
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
  | { type: 'done'; generated_at: string; news_sourced: boolean; from_cache: boolean; signal_count?: number }
  | { type: 'error'; message: string };

function portfolioHash(holdings: Holding[]): string {
  // Normalize key order before hashing so Supabase round-trips don't change the hash
  const sorted = [...holdings]
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map(h => ({ ticker: h.ticker, units: h.units, market: h.market ?? 'ASX' }));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex').slice(0, 8);
}

export async function POST(req: Request) {
  const body = await req.json();
  const holdings = (body.portfolio ?? []) as Holding[];
  const userId = (body.userId ?? '') as string;
  const accessToken = (body.accessToken ?? '') as string;

  if (!holdings.length) {
    return new Response(
      JSON.stringify({ type: 'error', message: 'Portfolio is empty.' }) + '\n',
      { status: 400, headers: { 'Content-Type': 'application/x-ndjson' } },
    );
  }

  const pHash = portfolioHash(holdings);
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  // ── Cache check + rate limiting ──────────────────────────────────────────────
  console.log('[briefing] userId:', userId || '(empty)', '| token:', accessToken ? 'present' : 'missing', '| supabaseConfigured:', isSupabaseConfigured);

  if (userId && accessToken && isSupabaseConfigured) {
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

        // Portfolio changed since last briefing — fall through to regenerate
      }
    } catch (e) {
      console.error('[briefing] Cache check exception:', String(e));
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
        emit({ type: 'progress', message: 'Gathering market intelligence…' });

        const briefing = await generateBriefing(holdings, {
          onProgress: (msg) => emit({ type: 'progress', message: msg }),
          onStock:    (stock) => emit({ type: 'stock', data: stock }),
        });

        emit({ type: 'overview', data: briefing.overview });

        // ── Store briefing + log signals ──────────────────────────────────────
        let signalCount = 0;
        if (userId && accessToken && isSupabaseConfigured) {
          const userClient = getUserClient(accessToken);

          try {
            const { error: insertError } = await userClient.from('briefings').insert({
              user_id:            userId,
              briefing_data:      briefing satisfies BriefingData,
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

          try {
            const signalRows = briefing.stocks
              .filter(s => s.signal && s.ticker)
              .map(s => ({
                user_id:         userId,
                ticker:          s.ticker,
                market:          holdings.find(h => h.ticker === s.ticker)?.market ?? 'ASX',
                signal:          s.signal,
                confidence:      s.confidence,
                price_at_signal: null as number | null,
              }));

            if (signalRows.length > 0) {
              const { error: logError } = await userClient.from('signal_logs').insert(signalRows);
              if (logError) {
                console.error('[briefing] Signal log error:', logError.code, logError.message);
              } else {
                signalCount = signalRows.length;
              }
            }
          } catch (e) {
            console.error('[briefing] Signal log exception:', String(e));
          }
        }

        emit({ type: 'done', generated_at: briefing.generated_at, news_sourced: briefing.news_sourced, from_cache: false, signal_count: signalCount });
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
