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

export const maxDuration = 60; // Hobby plan cap

// Vercel cron schedule (vercel.json): "5 21 * * 0-4"
// That's 21:05 UTC Sun–Thu = 07:05 AEST Mon–Fri.
// Runs 5 minutes after morning-briefing (0 21) has stored all briefings.

export async function GET(req: Request) {
  const authHeader = req.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const resendApiKey   = process.env.RESEND_API_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[email-cron] Supabase not configured — skipping.');
    return NextResponse.json({ skipped: true, reason: 'supabase not configured' });
  }

  if (!resendApiKey) {
    console.warn('[email-cron] RESEND_API_KEY not set — skipping.');
    return NextResponse.json({ skipped: true, reason: 'resend not configured' });
  }

  const admin  = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const resend = new Resend(resendApiKey);
  const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'brief@portfoliobriefing.com.au';
  const appUrl    = process.env.APP_URL ?? 'https://portfoliobriefing.com.au';
  const listUnsub = '<mailto:unsubscribe@portfoliobriefing.com.au>';

  // Find today's briefings for opted-in users that haven't been emailed yet
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: briefings, error } = await admin
    .from('briefings')
    .select('id, user_id, briefing_data')
    .gte('created_at', todayStart.toISOString())
    .is('notified_at', null)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('[email-cron] Failed to fetch briefings:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!briefings?.length) {
    return NextResponse.json({ emailed: 0, message: 'No unnotified briefings.' });
  }

  // Check which of these users have email opted in
  const userIds = briefings.map(b => b.user_id);
  const { data: portfolios, error: portErr } = await admin
    .from('portfolios')
    .select('user_id')
    .in('user_id', userIds)
    .eq('email_briefing_enabled', true);

  if (portErr) {
    console.error('[email-cron] Failed to fetch portfolios:', portErr.message);
    return NextResponse.json({ error: portErr.message }, { status: 500 });
  }

  const optedIn = new Set((portfolios ?? []).map(p => p.user_id));

  // Batch-fetch all user emails
  const emailMap = new Map<string, string>();
  try {
    const { data: { users } } = await admin.auth.admin.listUsers();
    for (const u of users) {
      if (u.email) emailMap.set(u.id, u.email);
    }
  } catch (authErr) {
    console.warn('[email-cron] listUsers failed — aborting:', authErr);
    return NextResponse.json({ error: 'listUsers failed' }, { status: 500 });
  }

  let emailed  = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (const briefing of briefings) {
    const userEmail = emailMap.get(briefing.user_id) ?? null;

    if (!optedIn.has(briefing.user_id) || !userEmail) {
      // Mark notified so we don't retry — user either opted out or has no email
      await admin.from('briefings').update({ notified_at: new Date().toISOString() }).eq('id', briefing.id);
      skipped++;
      continue;
    }

    try {
      const data        = briefing.briefing_data as { stocks: StockSignal[]; overview: BriefingOverview; generated_at: string };
      const sorted      = sortCards(data.stocks);

      await resend.emails.send({
        from:    fromEmail,
        to:      userEmail,
        subject: buildSubject(sorted, new Date()),
        html:    buildEmailHtml(data.stocks, data.overview, data.generated_at, appUrl),
        headers: { 'List-Unsubscribe': listUnsub },
      });

      await admin.from('briefings').update({ notified_at: new Date().toISOString() }).eq('id', briefing.id);
      emailed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[email-cron] Email failed for user ${briefing.user_id}:`, msg);
      errors.push(`${briefing.user_id}: ${msg}`);

      // Send failure notice so the user isn't silently skipped
      try {
        const userEmailForFailure = emailMap.get(briefing.user_id);
        if (userEmailForFailure) {
          await resend.emails.send({
            from:    fromEmail,
            to:      userEmailForFailure,
            subject: buildFailureSubject(new Date()),
            html:    buildFailureEmailHtml(appUrl),
            headers: { 'List-Unsubscribe': listUnsub },
          });
        }
      } catch {
        // Swallow — the briefing error is already recorded above.
      }
      // Mark notified to prevent retries on the next run
      await admin.from('briefings').update({ notified_at: new Date().toISOString() }).eq('id', briefing.id);
    }

    // Small delay to avoid Resend rate limits
    await new Promise(r => setTimeout(r, 300));
  }

  console.log(
    `[email-cron] Done — emailed: ${emailed}, skipped: ${skipped}, errors: ${errors.length}`,
  );

  return NextResponse.json({ emailed, skipped, errors });
}
