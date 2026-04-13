// GET /api/top-picks
// Returns today's cached top picks for any authenticated user.
// Picks are generated once per day by the morning cron and shared across all users.

import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const supabaseUrl     = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

export async function GET(req: Request) {
  const accessToken = req.headers.get('x-access-token') ?? '';

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: 'Supabase not configured' }, { status: 503 });
  }

  if (!accessToken) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Verify the access token by creating a user-scoped client
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });

  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 });
  }

  // Fetch today's picks (latest row from today)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data, error } = await userClient
    .from('top_picks')
    .select('picks_data, generated_at')
    .gte('generated_at', todayStart.toISOString())
    .order('generated_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('[top-picks] Query error:', error.code, error.message);
    return NextResponse.json({ error: 'Database error' }, { status: 500 });
  }

  if (!data) {
    // No picks generated yet today — cron hasn't run
    return NextResponse.json({ picks: null });
  }

  return NextResponse.json({ picks: data.picks_data, generated_at: data.generated_at });
}
