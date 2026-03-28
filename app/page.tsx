'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { BriefingData, BriefingOverview, StockSignal } from '@/app/api/briefing/route';

type Holding = { ticker: string; units: number };
type HistoryEntry = { time: string; description: string };
type PriceMap = Record<string, { label: string; direction: 'up' | 'down' | 'flat' | null }>;

// ── Signal styling ────────────────────────────────────────────────────────────

const SIGNAL_STYLE: Record<string, React.CSSProperties> = {
  ADD:  { background: '#052e16', color: '#4ade80', border: '1px solid #166534' },
  HOLD: { background: '#1c1917', color: '#a8a29e', border: '1px solid #44403c' },
  TRIM: { background: '#431407', color: '#fb923c', border: '1px solid #9a3412' },
  EXIT: { background: '#450a0a', color: '#f87171', border: '1px solid #991b1b' },
};

const THESIS_STYLE: Record<string, React.CSSProperties> = {
  intact:    { color: '#4ade80' },
  developing:{ color: '#fb923c' },
  broken:    { color: '#f87171' },
};

const CONFIDENCE_DOTS: Record<string, string> = {
  High:   '●●●',
  Medium: '●●○',
  Low:    '●○○',
};

const CONFIDENCE_COLOR: Record<string, string> = {
  High:   '#4ade80',
  Medium: '#fb923c',
  Low:    '#f87171',
};

const RISK_ICON: Record<string, string> = {
  increased:  '↑',
  decreased:  '↓',
  unchanged:  '–',
};

const RISK_COLOR: Record<string, string> = {
  increased:  '#f87171',
  decreased:  '#4ade80',
  unchanged:  '#a8a29e',
};

// ── Storage helpers ───────────────────────────────────────────────────────────

const STORAGE_KEY  = 'portfolio-briefing-holdings';
const BRIEFING_KEY = 'portfolio-briefing-cached';

const DEFAULT_PORTFOLIO: Holding[] = [
  { ticker: 'BHP',  units: 100 },
  { ticker: 'CBA',  units: 50  },
  { ticker: 'TLS',  units: 200 },
  { ticker: 'WOW',  units: 75  },
  { ticker: 'VGS',  units: 100 },
  { ticker: 'VAS',  units: 50  },
];

function loadPortfolio(): Holding[] {
  if (typeof window === 'undefined') return DEFAULT_PORTFOLIO;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PORTFOLIO;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {}
  return DEFAULT_PORTFOLIO;
}

function savePortfolio(p: Holding[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); } catch {}
}

function loadCachedBriefing(): BriefingData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BRIEFING_KEY);
    if (!raw) return null;
    const { data, date } = JSON.parse(raw);
    const today = new Date().toDateString();
    if (date !== today) return null; // stale — different day
    return data as BriefingData;
  } catch {
    return null;
  }
}

function saveCachedBriefing(data: BriefingData) {
  try {
    localStorage.setItem(BRIEFING_KEY, JSON.stringify({
      data,
      date: new Date().toDateString(),
    }));
  } catch {}
}

// ── TradingView Chart ─────────────────────────────────────────────────────────

function TradingViewChart({ ticker }: { ticker: string }) {
  return (
    <div style={{ borderRadius: '8px', overflow: 'hidden', marginTop: '12px' }}>
      <iframe
        src={`https://www.tradingview.com/widgetembed/?symbol=ASX:${ticker}&interval=D&theme=dark&style=1&hide_side_toolbar=1&allow_symbol_change=0&save_image=0&calendar=0&hotlist=0&details=0&hide_top_toolbar=0&hide_legend=0`}
        width="100%"
        height="280"
        frameBorder="0"
        title={`${ticker} chart`}
        style={{ display: 'block' }}
      />
    </div>
  );
}

// ── Stock Signal Card ─────────────────────────────────────────────────────────

function StockCard({ stock, price }: { stock: StockSignal; price?: { label: string; direction: 'up' | 'down' | 'flat' | null } }) {
  const [chartOpen, setChartOpen] = useState(false);

  return (
    <div className="rounded-xl p-5 mb-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

      {/* Top row: ticker + signal badge */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="font-mono font-bold text-base" style={{ color: 'var(--text-primary)' }}>
            {stock.ticker}
          </span>
          {price?.label && (
            <span className="text-xs font-mono px-1.5 py-0.5 rounded"
              style={{
                background: price.direction === 'up' ? '#052e16' : price.direction === 'down' ? '#450a0a' : '#1c1917',
                color: price.direction === 'up' ? '#4ade80' : price.direction === 'down' ? '#f87171' : '#a8a29e',
              }}>
              {price.direction === 'up' ? '▲' : price.direction === 'down' ? '▼' : ''} {price.label}
            </span>
          )}
        </div>
        <span className="text-xs px-3 py-1 rounded-full font-bold tracking-wider"
          style={SIGNAL_STYLE[stock.signal] ?? SIGNAL_STYLE.HOLD}>
          {stock.signal}
        </span>
      </div>

      {/* Sector + country + confidence + risk row */}
      <div className="flex flex-wrap gap-2 mb-3">
        <span className="text-xs px-2 py-0.5 rounded-md font-medium"
          style={{ background: '#1e3a5f', color: '#93c5fd' }}>
          {stock.sector}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-md font-medium"
          style={{ background: '#14352a', color: '#6ee7b7' }}>
          {stock.country}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-md font-mono"
          style={{ background: '#1c1917', color: CONFIDENCE_COLOR[stock.confidence] ?? '#a8a29e' }}>
          {CONFIDENCE_DOTS[stock.confidence] ?? '○○○'} {stock.confidence}
        </span>
        <span className="text-xs px-2 py-0.5 rounded-md font-medium"
          style={{ background: '#1c1917', color: RISK_COLOR[stock.risk_change] ?? '#a8a29e' }}>
          Risk {RISK_ICON[stock.risk_change] ?? '–'}
        </span>
      </div>

      {/* Thesis status */}
      <div className="flex items-center gap-1.5 mb-3">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Thesis:</span>
        <span className="text-xs font-semibold capitalize"
          style={THESIS_STYLE[stock.thesis_status] ?? {}}>
          {stock.thesis_status}
        </span>
      </div>

      {/* Catalyst */}
      <p className="text-sm leading-relaxed mb-3" style={{ color: '#d1d5db' }}>
        {stock.catalyst}
      </p>

      {/* Upcoming catalyst */}
      {stock.upcoming_catalyst && (
        <div className="flex items-start gap-2 mb-3 text-xs rounded-lg px-3 py-2"
          style={{ background: '#1e293b', color: '#93c5fd', border: '1px solid #1e3a5f' }}>
          <span style={{ flexShrink: 0 }}>📅</span>
          <span>{stock.upcoming_catalyst}</span>
        </div>
      )}

      {/* What to watch */}
      {stock.what_to_watch && (
        <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-3"
          style={{ background: '#1c1207', color: '#fbbf24', border: '1px solid #451a03' }}>
          <span style={{ flexShrink: 0 }}>👀</span>
          <span>{stock.what_to_watch}</span>
        </div>
      )}

      {/* TradingView chart toggle */}
      <button
        onClick={() => setChartOpen(o => !o)}
        className="text-xs flex items-center gap-1.5 mt-1"
        style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        <span>{chartOpen ? '▲' : '▼'}</span>
        <span>{chartOpen ? 'Hide chart' : 'View chart'}</span>
      </button>

      {chartOpen && <TradingViewChart ticker={stock.ticker} />}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab]                   = useState<'briefing' | 'portfolio'>('briefing');
  const [portfolio, setPortfolio]       = useState<Holding[]>(DEFAULT_PORTFOLIO);
  const [history, setHistory]           = useState<HistoryEntry[]>([]);
  const [briefingData, setBriefingData]         = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading]   = useState(false);
  const [briefingError, setBriefingError]       = useState('');
  const [progressMessage, setProgressMessage]   = useState('');
  const [streamingStocks, setStreamingStocks]   = useState<StockSignal[]>([]);
  const [prices, setPrices]             = useState<PriceMap>({});
  const [nlInput, setNlInput]           = useState('');
  const [nlLoading, setNlLoading]       = useState(false);
  const [nlError, setNlError]           = useState('');
  const [user, setUser]                 = useState<User | null>(null);
  const [authLoading, setAuthLoading]   = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  const portfolioRef = useRef<Holding[]>(DEFAULT_PORTFOLIO);
  const userRef      = useRef<User | null>(null);
  const portfolioInitialized = useRef(false);

  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── Bootstrap ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const loaded = loadPortfolio();
    setPortfolio(loaded);

    // Restore today's cached briefing (avoids regenerating on refresh)
    const cached = loadCachedBriefing();
    if (cached) setBriefingData(cached);

    if (!isSupabaseConfigured) {
      setAuthLoading(false);
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        const currentUser = session?.user ?? null;
        setUser(currentUser);
        setAuthLoading(false);

        if (!currentUser) return;

        // Load portfolio from Supabase
        const { data: portData } = await supabase
          .from('portfolios')
          .select('holdings')
          .eq('user_id', currentUser.id)
          .single();

        if (portData != null && Array.isArray(portData.holdings) && portData.holdings.length > 0) {
          setPortfolio(portData.holdings);
        } else {
          await supabase.from('portfolios').upsert({
            user_id: currentUser.id,
            holdings: portfolioRef.current,
            updated_at: new Date().toISOString(),
          });
        }

        // Load today's stored briefing from Supabase if not already loaded
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: briefingRow } = await supabase
          .from('briefings')
          .select('briefing_data')
          .eq('user_id', currentUser.id)
          .gte('created_at', todayStart.toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (briefingRow?.briefing_data) {
          setBriefingData(briefingRow.briefing_data as BriefingData);
          saveCachedBriefing(briefingRow.briefing_data as BriefingData);
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── Persist portfolio ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!portfolioInitialized.current) {
      portfolioInitialized.current = true;
      return;
    }
    savePortfolio(portfolio);
    const currentUser = userRef.current;
    if (currentUser && isSupabaseConfigured) {
      supabase.from('portfolios').upsert({
        user_id: currentUser.id,
        holdings: portfolio,
        updated_at: new Date().toISOString(),
      });
    }
  }, [portfolio]);

  // ── Fetch prices whenever briefing data changes ────────────────────────────
  const fetchPrices = useCallback(async (tickers: string[]) => {
    try {
      const res = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tickers }),
      });
      if (!res.ok) return;
      const { prices: data } = await res.json();
      setPrices(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (briefingData?.stocks?.length) {
      fetchPrices(briefingData.stocks.map(s => s.ticker));
    }
  }, [briefingData, fetchPrices]);

  // ── Auth actions ───────────────────────────────────────────────────────────
  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
    setPortfolio(DEFAULT_PORTFOLIO);
    setBriefingData(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BRIEFING_KEY);
  }

  // ── Generate briefing (streaming) ─────────────────────────────────────────
  async function generateBriefing() {
    setBriefingLoading(true);
    setBriefingError('');
    setProgressMessage('');
    setStreamingStocks([]);

    const accumulatedStocks: StockSignal[] = [];
    let accumulatedOverview: BriefingOverview | null = null;
    let generatedAt = '';
    let newsSourced = false;

    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio }),
      });
      if (!res.ok || !res.body) throw new Error('API error');

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          try {
            const event = JSON.parse(trimmed) as
              | { type: 'progress'; message: string }
              | { type: 'stock'; data: StockSignal }
              | { type: 'overview'; data: BriefingOverview }
              | { type: 'done'; generated_at: string; news_sourced: boolean }
              | { type: 'error'; message: string };

            if (event.type === 'progress') {
              setProgressMessage(event.message);
            } else if (event.type === 'stock') {
              accumulatedStocks.push(event.data);
              setStreamingStocks([...accumulatedStocks]);
            } else if (event.type === 'overview') {
              accumulatedOverview = event.data;
            } else if (event.type === 'done') {
              generatedAt = event.generated_at;
              newsSourced = event.news_sourced;
            } else if (event.type === 'error') {
              throw new Error(event.message);
            }
          } catch (parseErr) {
            // Skip malformed lines
            if (parseErr instanceof SyntaxError) continue;
            throw parseErr;
          }
        }
      }

      if (!accumulatedStocks.length || !accumulatedOverview) {
        throw new Error('Incomplete briefing received.');
      }

      const briefing: BriefingData = {
        stocks: accumulatedStocks,
        overview: accumulatedOverview,
        generated_at: generatedAt || new Date().toISOString(),
        news_sourced: newsSourced,
      };

      setBriefingData(briefing);
      setStreamingStocks([]);
      setProgressMessage('');
      saveCachedBriefing(briefing);

      // Store in Supabase if signed in
      const currentUser = userRef.current;
      if (currentUser && isSupabaseConfigured) {
        await supabase.from('briefings').insert({
          user_id: currentUser.id,
          briefing_data: briefing,
          portfolio_snapshot: portfolio,
        });
      }
    } catch (err) {
      setBriefingError(
        err instanceof Error ? err.message : 'Failed to generate briefing.',
      );
      setStreamingStocks([]);
      setProgressMessage('');
    } finally {
      setBriefingLoading(false);
    }
  }

  // ── Portfolio NL update ────────────────────────────────────────────────────
  async function updatePortfolio() {
    const cmd = nlInput.trim();
    if (!cmd) return;
    setNlLoading(true);
    setNlError('');
    try {
      const res = await fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio, command: cmd }),
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (data.error) {
        setNlError(data.error);
      } else {
        setPortfolio(data.portfolio);
        setHistory(prev => [{
          time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
          description: data.description,
        }, ...prev]);
        setNlInput('');
      }
    } catch {
      setNlError('Something went wrong. Please try again.');
    } finally {
      setNlLoading(false);
      inputRef.current?.focus();
    }
  }

  function removeHolding(ticker: string) {
    setPortfolio(p => p.filter(h => h.ticker !== ticker));
    setHistory(prev => [{
      time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
      description: `Removed ${ticker}`,
    }, ...prev]);
  }

  const totalUnits = portfolio.reduce((s, h) => s + h.units, 0);
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

  const generatedTime = briefingData?.generated_at
    ? new Date(briefingData.generated_at).toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit',
      })
    : null;

  return (
    <main className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="max-w-xl mx-auto px-4 py-8">

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Portfolio Briefing
            </h1>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{today}</p>
          </div>

          {isSupabaseConfigured && !authLoading && (
            <div className="flex items-center gap-2 pt-1">
              {user ? (
                <>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {user.email?.split('@')[0]}
                  </span>
                  <button
                    onClick={signOut}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  onClick={signIn}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                  <svg viewBox="-3 -3 30 30" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
                    <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                    <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                    <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
                    <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                  </svg>
                  Sign in
                </button>
              )}
            </div>
          )}
        </div>

        {/* ── Tabs ── */}
        <div className="flex gap-1 p-1 rounded-xl mb-6"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          {(['briefing', 'portfolio'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className="flex-1 py-2 rounded-lg text-sm font-medium transition-all"
              style={tab === t
                ? { background: 'var(--accent)', color: '#fff' }
                : { color: 'var(--text-muted)' }}>
              {t === 'briefing' ? '📊  Briefing' : '💼  Portfolio'}
            </button>
          ))}
        </div>

        {/* ── BRIEFING TAB ── */}
        {tab === 'briefing' && (
          <div className="animate-fade-in">

            {/* Generate / regenerate button */}
            <button
              onClick={generateBriefing}
              disabled={briefingLoading}
              className="w-full py-3 rounded-xl text-sm font-semibold mb-2 transition-all"
              style={{
                background: briefingLoading ? 'var(--border)' : 'var(--accent)',
                color: briefingLoading ? 'var(--text-muted)' : '#fff',
                cursor: briefingLoading ? 'not-allowed' : 'pointer',
              }}>
              {briefingLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                  </svg>
                  {progressMessage || 'Starting…'}
                </span>
              ) : briefingData ? 'Regenerate Briefing' : 'Generate Briefing'}
            </button>

            {/* Streaming stock cards — visible during generation */}
            {briefingLoading && streamingStocks.length > 0 && (
              <div className="mb-2 animate-fade-in">
                {streamingStocks.map(stock => (
                  <StockCard key={stock.ticker} stock={stock} price={prices[stock.ticker]} />
                ))}
                <p className="text-xs text-center py-2" style={{ color: 'var(--text-muted)' }}>
                  Loading remaining holdings…
                </p>
              </div>
            )}

            {briefingError && (
              <p className="text-sm mb-4 px-4 py-3 rounded-lg"
                style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
                {briefingError}
              </p>
            )}

            {/* Completed briefing */}
            {!briefingLoading && briefingData ? (
              <div className="animate-fade-in">

                {/* Briefing meta */}
                <div className="flex items-center justify-between mb-4">
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {generatedTime ? `Generated ${generatedTime}` : 'Today\'s briefing'}
                    {briefingData.news_sourced && (
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs"
                        style={{ background: '#052e16', color: '#4ade80' }}>
                        ✓ live news
                      </span>
                    )}
                  </p>
                </div>

                {/* ── Priority Actions (only shown when non-empty) ── */}
                {briefingData.overview.priority_actions?.length > 0 && (
                  <div className="rounded-xl p-4 mb-4"
                    style={{ background: '#1c0a00', border: '1px solid #7c2d12' }}>
                    <p className="text-xs font-semibold tracking-wider mb-3"
                      style={{ color: '#fb923c' }}>
                      ⚡ PRIORITY ACTIONS
                    </p>
                    <div className="space-y-2">
                      {briefingData.overview.priority_actions.map((action, i) => (
                        <p key={i} className="text-sm" style={{ color: '#fed7aa' }}>{action}</p>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Watch List ── */}
                {briefingData.overview.watch_list?.length > 0 && (
                  <div className="rounded-xl p-4 mb-4"
                    style={{ background: '#0c1a2e', border: '1px solid #1e3a5f' }}>
                    <p className="text-xs font-semibold tracking-wider mb-3"
                      style={{ color: '#60a5fa' }}>
                      📋 THIS WEEK'S WATCH LIST
                    </p>
                    <div className="space-y-2">
                      {briefingData.overview.watch_list.map((item, i) => (
                        <div key={i} className="flex items-start gap-2">
                          <span className="text-xs mt-0.5" style={{ color: '#3b82f6', flexShrink: 0 }}>→</span>
                          <p className="text-sm" style={{ color: '#bfdbfe' }}>{item}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── Stock Signal Cards ── */}
                {briefingData.stocks.map(stock => (
                  <StockCard key={stock.ticker} stock={stock} price={prices[stock.ticker]} />
                ))}

                {/* ── Portfolio Overview ── */}
                <div className="rounded-xl p-5 mt-1"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold tracking-wider mb-4"
                    style={{ color: 'var(--text-muted)' }}>
                    PORTFOLIO OVERVIEW
                  </p>
                  <div className="space-y-4">
                    {[
                      { key: 'sector_breakdown', label: 'SECTOR BREAKDOWN'  },
                      { key: 'region_exposure',   label: 'REGION EXPOSURE'   },
                      { key: 'risk_profile',      label: 'RISK PROFILE'      },
                      { key: 'macro_note',        label: 'MACRO NOTE'        },
                    ].map(({ key, label }) => (
                      <div key={key}>
                        <p className="text-xs font-medium tracking-wider mb-1.5"
                          style={{ color: 'var(--accent)' }}>
                          {label}
                        </p>
                        <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>
                          {briefingData.overview[key as keyof typeof briefingData.overview] as string}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : !briefingLoading && (
              <div className="rounded-xl p-10 text-center"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="text-4xl mb-3">📊</div>
                <p className="text-sm mb-1" style={{ color: 'var(--text-primary)' }}>
                  Your morning briefing is ready to generate.
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Searches for current news · generates ADD/HOLD/TRIM/EXIT signals · takes ~60s
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── PORTFOLIO TAB ── */}
        {tab === 'portfolio' && (
          <div className="animate-fade-in">
            <div className="rounded-xl overflow-hidden mb-4"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="flex justify-between px-4 py-2 text-xs font-medium tracking-wider"
                style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>TICKER</span>
                <span>UNITS</span>
              </div>

              {portfolio.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No holdings. Use the box below to add some.
                </div>
              ) : (
                portfolio.map((h, i) => (
                  <div key={h.ticker}
                    className="flex items-center justify-between px-4 py-3 group"
                    style={{ borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
                    <span className="font-mono font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>
                      {h.ticker}
                    </span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm tabular-nums" style={{ color: '#9ca3af' }}>
                        {h.units.toLocaleString()}
                      </span>
                      <button
                        onClick={() => removeHolding(h.ticker)}
                        className="opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded transition-all text-xs"
                        style={{ color: 'var(--text-muted)' }}
                        onMouseOver={e => (e.currentTarget.style.color = 'var(--danger)')}
                        onMouseOut={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                        aria-label={`Remove ${h.ticker}`}>✕</button>
                    </div>
                  </div>
                ))
              )}

              {portfolio.length > 0 && (
                <div className="flex justify-between px-4 py-2 text-xs"
                  style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <span>{portfolio.length} holdings</span>
                  <span>{totalUnits.toLocaleString()} total units</span>
                </div>
              )}
            </div>

            {/* Natural language input */}
            <div className="flex gap-2 mb-2">
              <input
                ref={inputRef}
                value={nlInput}
                onChange={e => setNlInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !nlLoading && updatePortfolio()}
                placeholder='e.g. "Add 50 NDQ" or "Set TLS to 300" or "Remove VGS"'
                className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
              <button
                onClick={updatePortfolio}
                disabled={nlLoading || !nlInput.trim()}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold transition-all"
                style={{
                  background: nlLoading || !nlInput.trim() ? 'var(--border)' : 'var(--accent)',
                  color: nlLoading || !nlInput.trim() ? 'var(--text-muted)' : '#fff',
                  cursor: nlLoading || !nlInput.trim() ? 'not-allowed' : 'pointer',
                  minWidth: '72px',
                }}>
                {nlLoading ? '…' : 'Update'}
              </button>
            </div>

            {nlError && (
              <p className="text-xs mb-4 px-3 py-2 rounded-lg"
                style={{ background: '#450a0a', color: '#fca5a5' }}>
                {nlError}
              </p>
            )}

            {history.length > 0 && (
              <div className="mt-5">
                <p className="text-xs font-medium tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
                  HISTORY
                </p>
                <div className="space-y-1.5">
                  {history.map((h, i) => (
                    <div key={i} className="flex items-center gap-3 text-sm">
                      <span className="font-mono text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {h.time}
                      </span>
                      <span style={{ color: '#9ca3af' }}>{h.description}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
