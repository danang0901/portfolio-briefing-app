import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const maxDuration = 300; // 5 min — allow for multiple users

// Vercel cron schedule (vercel.json): "30 23 * * *"
// That's 23:30 UTC = 09:30 AEST (UTC+10) = 10:30 AEDT (UTC+11 in summer).
// The cron runs daily, 30 minutes before ASX open.

export async function GET(req: Request) {
  // Verify this is a legitimate Vercel cron request
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl       = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey    = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[cron] Supabase not configured — skipping morning briefing generation.');
    return NextResponse.json({ skipped: true, reason: 'supabase not configured' });
  }

  // Use service role client to bypass RLS and read all users' portfolios
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Fetch all portfolios with at least one holding
  const { data: portfolios, error } = await admin
    .from('portfolios')
    .select('user_id, holdings')
    .not('holdings', 'is', null);

  if (error) {
    console.error('[cron] Failed to fetch portfolios:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!portfolios?.length) {
    return NextResponse.json({ generated: 0, message: 'No portfolios found.' });
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let generated = 0;
  let skipped   = 0;
  const errors: string[] = [];

  for (const row of portfolios) {
    if (!row.holdings?.length) { skipped++; continue; }

    // Skip if a briefing was already generated today for this user
    const { data: existing } = await admin
      .from('briefings')
      .select('id')
      .eq('user_id', row.user_id)
      .gte('created_at', todayStart.toISOString())
      .limit(1)
      .single();

    if (existing) { skipped++; continue; }

    try {
      // Call the briefing API internally
      const origin = process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : 'http://localhost:3000';

      const res = await fetch(`${origin}/api/briefing`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio: row.holdings }),
      });

      if (!res.ok) throw new Error(`Briefing API returned ${res.status}`);
      if (!res.body) throw new Error('No response body from briefing API');

      // Consume NDJSON stream — the briefing API streams events, not a single JSON blob
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      const stocks: unknown[] = [];
      let overview: unknown = null;
      let generatedAt = '';
      let newsSourced = false;
      let streamError: string | null = null;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as { type: string; [key: string]: unknown };
            if (event.type === 'stock') stocks.push(event.data);
            else if (event.type === 'overview') overview = event.data;
            else if (event.type === 'done') {
              generatedAt = event.generated_at as string;
              newsSourced = event.news_sourced as boolean;
            } else if (event.type === 'error') {
              streamError = event.message as string;
            }
          } catch { /* skip malformed lines */ }
        }
      }

      if (streamError) throw new Error(streamError);
      if (!stocks.length || !overview) throw new Error('Incomplete briefing received from API');

      const briefingData = { stocks, overview, generated_at: generatedAt, news_sourced: newsSourced };

      // Store briefing for this user
      const { error: insertErr } = await admin.from('briefings').insert({
        user_id:            row.user_id,
        briefing_data:      briefingData,
        portfolio_snapshot: row.holdings,
      });

      if (insertErr) throw new Error(insertErr.message);
      generated++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron] Failed for user ${row.user_id}:`, msg);
      errors.push(`${row.user_id}: ${msg}`);
    }

    // Small delay between users to avoid rate-limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`[cron] Morning briefing complete — generated: ${generated}, skipped: ${skipped}, errors: ${errors.length}`);

  return NextResponse.json({ generated, skipped, errors });
}
