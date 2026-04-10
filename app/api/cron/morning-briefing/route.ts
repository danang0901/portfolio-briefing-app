import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { generateBriefing } from '@/lib/briefing-generator';
import { generateTopPicks } from '@/lib/generate-top-picks';

export const maxDuration = 300; // 5 min — allow for multiple users + top picks generation

// Vercel cron schedule (vercel.json): "0 21 * * 0-4"
// That's 21:00 UTC Sun–Thu = 07:00 AEST Mon–Fri. No weekend sends.
// Email dispatch is handled separately by /api/cron/morning-email (0 21+5min).

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

  // Fetch only email-opted-in portfolios — keeps each run within Hobby plan's 60s limit.
  // Web app users get on-demand briefings via /api/briefing instead.
  const { data: portfolios, error } = await admin
    .from('portfolios')
    .select('user_id, holdings')
    .eq('email_briefing_enabled', true)
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

  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  // ── Generate Top Picks (once per day, shared across all users) ────────────
  let topPicksGenerated = false;
  try {
    // Check if picks already exist for today
    const { data: existingPicks } = await admin
      .from('top_picks')
      .select('id')
      .gte('generated_at', todayStart.toISOString())
      .limit(1)
      .single();

    if (!existingPicks) {
      console.log('[cron] Generating daily top picks…');
      const picksData = await generateTopPicks(today);
      const { error: picksErr } = await admin.from('top_picks').insert({
        picks_data:   picksData,
        generated_at: picksData.generated_at,
      });
      if (picksErr) {
        console.error('[cron] Top picks insert error:', picksErr.message);
      } else {
        topPicksGenerated = true;
        console.log('[cron] Top picks generated and stored.');
      }
    } else {
      console.log('[cron] Top picks already exist for today — skipping generation.');
      topPicksGenerated = true;
    }
  } catch (picksErr) {
    console.error('[cron] Top picks generation failed:', picksErr instanceof Error ? picksErr.message : String(picksErr));
    // Non-fatal — continue with per-user briefings
  }

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
      const briefingData = await generateBriefing(row.holdings);

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
  }

  console.log(
    `[cron] Morning briefing complete — generated: ${generated}, skipped: ${skipped}, errors: ${errors.length}`,
  );

  return NextResponse.json({ generated, skipped, errors, topPicksGenerated });
}
