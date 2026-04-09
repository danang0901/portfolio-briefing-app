/**
 * Resend webhook handler — bounce + unsubscribe events.
 *
 * Configure in Resend dashboard:
 *   URL: https://portfoliobriefing.com.au/api/webhooks/resend
 *   Events to send: email.bounced, email.complained
 *
 * Security: we verify a shared secret passed as ?secret=... query param.
 * Set RESEND_WEBHOOK_SECRET in Vercel env vars and in the Resend webhook URL.
 *
 * On hard bounce or spam complaint: set email_briefing_enabled = false for the
 * affected user so we stop sending and protect sender reputation.
 */

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

const DISABLE_ON_EVENTS = new Set([
  'email.bounced',
  'email.complained',
]);

export async function POST(req: Request) {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (secret) {
    const { searchParams } = new URL(req.url);
    if (searchParams.get('secret') !== secret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // ── Parse ────────────────────────────────────────────────────────────────────
  let payload: { type?: string; data?: { to?: string[] } };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { type, data } = payload;

  // Unknown or non-actionable event — return 200 so Resend doesn't retry.
  if (!type || !DISABLE_ON_EVENTS.has(type)) {
    return NextResponse.json({ ok: true, action: 'ignored' });
  }

  const bouncedEmail = data?.to?.[0];
  if (!bouncedEmail) {
    return NextResponse.json({ ok: true, action: 'no_email' });
  }

  // ── Supabase ─────────────────────────────────────────────────────────────────
  const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn('[webhook/resend] Supabase not configured — cannot disable email for', bouncedEmail);
    return NextResponse.json({ ok: true, action: 'supabase_not_configured' });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  // Find user by email (listUsers + filter — getUserByEmail not reliably available)
  const { data: { users }, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    console.error('[webhook/resend] listUsers failed:', listErr.message);
    return NextResponse.json({ error: 'auth lookup failed' }, { status: 500 });
  }

  const user = users.find(u => u.email?.toLowerCase() === bouncedEmail.toLowerCase());
  if (!user) {
    // Not a registered user — nothing to disable.
    return NextResponse.json({ ok: true, action: 'user_not_found' });
  }

  // Disable email for this user
  const { error: updateErr } = await admin
    .from('portfolios')
    .update({ email_briefing_enabled: false })
    .eq('user_id', user.id);

  if (updateErr) {
    console.error('[webhook/resend] Failed to disable email for', user.id, updateErr.message);
    return NextResponse.json({ error: 'update failed' }, { status: 500 });
  }

  console.log(`[webhook/resend] ${type} — disabled email for user ${user.id} (${bouncedEmail})`);
  return NextResponse.json({ ok: true, action: 'disabled', user_id: user.id });
}
