import { createClient } from '@supabase/supabase-js';
import { Resend } from 'resend';
import { NextResponse } from 'next/server';
import {
  buildEmailHtml,
  buildFailureEmailHtml,
  buildSubject,
  buildFailureSubject,
  sortCards,
} from '@/lib/email-template';
import type { StockSignal, BriefingOverview } from '@/app/api/briefing/route';

export const maxDuration = 300; // 5 min — allow for multiple users

// Vercel cron schedule (vercel.json): "0 21 * * 0-4"
// That's 21:00 UTC Sun–Thu = 07:00 AEST Mon–Fri. No weekend sends.

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

  // Fetch all portfolios with at least one holding (include email opt-in flag)
  const { data: portfolios, error } = await admin
    .from('portfolios')
    .select('user_id, holdings, email_briefing_enabled')
    .not('holdings', 'is', null);

  if (error) {
    console.error('[cron] Failed to fetch portfolios:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!portfolios?.length) {
    return NextResponse.json({ generated: 0, message: 'No portfolios found.' });
  }

  // Debug: log the resolved origin so we can confirm which URL is being called
  const _debugOrigin =
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'http://localhost:3000');
  console.log('[cron] origin:', _debugOrigin, '| APP_URL:', process.env.APP_URL, '| VERCEL_PROJECT_PRODUCTION_URL:', process.env.VERCEL_PROJECT_PRODUCTION_URL, '| VERCEL_URL:', process.env.VERCEL_URL);

  // Batch-fetch all user emails once (avoids N+1 calls inside the loop)
  const emailMap = new Map<string, string>();
  try {
    const { data: { users } } = await admin.auth.admin.listUsers();
    for (const u of users) {
      if (u.email) emailMap.set(u.id, u.email);
    }
  } catch (authErr) {
    console.warn('[cron] listUsers failed — email delivery disabled for this run:', authErr);
  }

  // Email client (null if RESEND_API_KEY not set — gracefully skips send)
  const resendApiKey = process.env.RESEND_API_KEY;
  const fromEmail    = process.env.RESEND_FROM_EMAIL ?? 'brief@portfoliobriefing.com.au';
  const appUrl       = process.env.APP_URL ?? 'https://portfoliobriefing.com.au';
  const resend       = resendApiKey ? new Resend(resendApiKey) : null;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  let generated = 0;
  let skipped   = 0;
  let emailed   = 0;
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

    const userEmail   = emailMap.get(row.user_id) ?? null;
    const shouldEmail = Boolean(row.email_briefing_enabled && resend && userEmail);
    const listUnsub   = '<mailto:unsubscribe@portfoliobriefing.com.au>';

    try {
      // Call the briefing API internally.
      // VERCEL_PROJECT_PRODUCTION_URL is the canonical production domain (Vercel built-in).
      // VERCEL_URL is deployment-specific and may be behind Vercel protection — avoid it.
      const origin =
        process.env.APP_URL ??
        (process.env.VERCEL_PROJECT_PRODUCTION_URL
          ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
          : 'http://localhost:3000');

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

      // Send email to opted-in users
      if (shouldEmail && resend && userEmail) {
        try {
          const typedStocks   = briefingData.stocks as StockSignal[];
          const typedOverview = briefingData.overview as BriefingOverview;
          const sorted        = sortCards(typedStocks);

          await resend.emails.send({
            from:    fromEmail,
            to:      userEmail,
            subject: buildSubject(sorted, new Date()),
            html:    buildEmailHtml(typedStocks, typedOverview, generatedAt, appUrl),
            headers: { 'List-Unsubscribe': listUnsub },
          });
          emailed++;
        } catch (emailErr) {
          const msg = emailErr instanceof Error ? emailErr.message : String(emailErr);
          console.error(`[cron] Email send failed for user ${row.user_id}:`, msg);
          // Briefing was stored successfully — just the email failed. Not a hard error.
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[cron] Failed for user ${row.user_id}:`, msg);
      errors.push(`${row.user_id}: ${msg}`);

      // Send failure notice to opted-in users so they aren't silently skipped
      if (shouldEmail && resend && userEmail) {
        try {
          await resend.emails.send({
            from:    fromEmail,
            to:      userEmail,
            subject: buildFailureSubject(new Date()),
            html:    buildFailureEmailHtml(appUrl),
            headers: { 'List-Unsubscribe': listUnsub },
          });
        } catch {
          // Swallow — the briefing error is already recorded above.
        }
      }
    }

    // Small delay between users to avoid rate-limiting
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(
    `[cron] Morning briefing complete — generated: ${generated}, skipped: ${skipped}, emailed: ${emailed}, errors: ${errors.length}`,
  );

  return NextResponse.json({ generated, skipped, emailed, errors });
}
