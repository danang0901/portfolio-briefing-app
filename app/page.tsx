'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { validateTicker, validateUnits } from '@/lib/portfolio-validators';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { BriefingData, BriefingOverview, StockSignal } from '@/app/api/briefing/route';

type Holding = { ticker: string; units: number; market: 'ASX' | 'NASDAQ' | 'NYSE' };
type HistoryEntry = { time: string; description: string };
type PriceMap = Record<string, { label: string; direction: 'up' | 'down' | 'flat' | null }>;
type EditingState = { index: number; field: 'ticker' | 'units' | 'market'; previousValue: string | number };

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
  { ticker: 'BHP',  units: 100, market: 'ASX' },
  { ticker: 'CBA',  units: 50,  market: 'ASX' },
  { ticker: 'TLS',  units: 200, market: 'ASX' },
  { ticker: 'WOW',  units: 75,  market: 'ASX' },
  { ticker: 'VGS',  units: 100, market: 'ASX' },
  { ticker: 'VAS',  units: 50,  market: 'ASX' },
];

function loadPortfolio(): Holding[] {
  if (typeof window === 'undefined') return DEFAULT_PORTFOLIO;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PORTFOLIO;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      // Coerce legacy holdings without market field to ASX
      return parsed.map((h: Partial<Holding>) => ({
        ...h,
        market: h.market ?? 'ASX',
      })) as Holding[];
    }
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

function TradingViewChart({ ticker, market = 'ASX' }: { ticker: string; market?: string }) {
  const symbol = `${market}:${ticker}`;
  return (
    <div style={{ borderRadius: '8px', overflow: 'hidden', marginTop: '12px' }}>
      <iframe
        src={`https://www.tradingview.com/widgetembed/?symbol=${symbol}&interval=D&theme=dark&style=1&hide_side_toolbar=1&allow_symbol_change=0&save_image=0&calendar=0&hotlist=0&details=0&hide_top_toolbar=0&hide_legend=0`}
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

function StockCard({ stock, price, market = 'ASX' }: { stock: StockSignal; price?: { label: string; direction: 'up' | 'down' | 'flat' | null }; market?: string }) {
  const [chartOpen, setChartOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);

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
        <span className="text-xs px-2 py-0.5 rounded-md"
          style={{ background: '#1c1917', color: '#a8a29e' }}>
          <span className="font-mono" style={{ color: CONFIDENCE_COLOR[stock.confidence] ?? '#a8a29e' }}>
            {CONFIDENCE_DOTS[stock.confidence] ?? '○○○'}
          </span>
          {' '}{stock.confidence}
          <span style={{ color: '#44403c', margin: '0 5px' }}>|</span>
          Risk{' '}
          <span style={{ color: RISK_COLOR[stock.risk_change] ?? '#a8a29e' }}>
            {RISK_ICON[stock.risk_change] ?? '–'}
          </span>
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

      {/* Technical analysis context */}
      {stock.ta_context && (
        <div className="text-xs mb-3 font-mono px-2 py-1.5 rounded"
          style={{ background: '#0f172a', color: '#7dd3fc', border: '1px solid #1e3a5f' }}>
          {stock.ta_context}
        </div>
      )}

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

      {/* Citations */}
      {stock.citations && stock.citations.length > 0 && (
        <div className="mt-2">
          <button
            onClick={() => setCitationsOpen(o => !o)}
            className="text-xs flex items-center gap-1 mb-1"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
            <span>{citationsOpen ? '▲' : '▼'}</span>
            <span>{citationsOpen ? 'Hide sources' : `Sources (${stock.citations.length})`}</span>
          </button>
          {citationsOpen && (
            <ul className="space-y-0.5 pl-3" style={{ borderLeft: '2px solid var(--border)' }}>
              {stock.citations.map((c, i) => (
                <li key={i} className="text-xs" style={{ color: '#6b7280' }}>{c}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* TradingView chart toggle */}
      <button
        onClick={() => setChartOpen(o => !o)}
        className="text-xs flex items-center gap-1.5 mt-2"
        style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
        <span>{chartOpen ? '▲' : '▼'}</span>
        <span>{chartOpen ? 'Hide chart' : 'View chart'}</span>
      </button>

      {chartOpen && <TradingViewChart ticker={stock.ticker} market={market} />}
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
  const [editing, setEditing]           = useState<EditingState | null>(null);
  const [user, setUser]                 = useState<User | null>(null);
  const [accessToken, setAccessToken]   = useState('');
  const [authLoading, setAuthLoading]   = useState(true);
  const [countdown, setCountdown]       = useState('');
  const [signalCount, setSignalCount]   = useState<number | null>(null);

  const portfolioRef = useRef<Holding[]>(DEFAULT_PORTFOLIO);
  const userRef      = useRef<User | null>(null);
  const portfolioInitialized = useRef(false);
  const editCancelledRef = useRef(false);

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
        setAccessToken(session?.access_token ?? '');
        setAuthLoading(false);

        if (!currentUser) return;

        // Load portfolio from Supabase
        const { data: portData } = await supabase
          .from('portfolios')
          .select('holdings')
          .eq('user_id', currentUser.id)
          .single();

        if (portData != null && Array.isArray(portData.holdings) && portData.holdings.length > 0) {
          // Coerce legacy holdings without market field to ASX
          const coerced = portData.holdings.map((h: Partial<Holding>) => ({ ...h, market: h.market ?? 'ASX' })) as Holding[];
          setPortfolio(coerced);
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
  const fetchPrices = useCallback(async (holdings: { ticker: string; market: string }[]) => {
    try {
      const res = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ holdings }),
      });
      if (!res.ok) return;
      const { prices: data } = await res.json();
      setPrices(data);
    } catch {}
  }, []);

  useEffect(() => {
    if (briefingData?.stocks?.length) {
      const holdingsForPrices = briefingData.stocks.map(s => ({
        ticker: s.ticker,
        market: portfolioRef.current.find(h => h.ticker === s.ticker)?.market ?? 'ASX',
      }));
      fetchPrices(holdingsForPrices);
    }
  }, [briefingData, fetchPrices]);

  // Countdown to next allowed regeneration (24h from last generated_at)
  useEffect(() => {
    const generatedAt = briefingData?.generated_at ?? '';
    if (!generatedAt) { setCountdown(''); return; }
    function tick() {
      const remaining = new Date(generatedAt).getTime() + 24 * 60 * 60 * 1000 - Date.now();
      if (remaining <= 0) { setCountdown(''); return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      setCountdown(`${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`);
    }
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [briefingData?.generated_at]);

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
    setAccessToken('');
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
    let fromCache = false;

    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          portfolio,
          userId: user?.id ?? '',
          accessToken,
        }),
      });
      if (!res.ok) {
        try {
          const errLine = await res.text();
          const errData = JSON.parse(errLine.trim().split('\n')[0]);
          throw new Error(errData.message ?? 'API error');
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== 'API error') throw parseErr;
          throw new Error('API error');
        }
      }
      if (!res.body) throw new Error('API error');

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
              | { type: 'done'; generated_at: string; news_sourced: boolean; from_cache: boolean; signal_count?: number }
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
              fromCache = event.from_cache;
              if (event.signal_count != null) setSignalCount(event.signal_count);
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

      // Route already stored the briefing server-side — skip client insert to avoid duplicates
      if (!fromCache && !isSupabaseConfigured) {
        // Supabase not configured server-side — store from client as fallback
        const currentUser = userRef.current;
        if (currentUser) {
          await supabase.from('briefings').insert({
            user_id: currentUser.id,
            briefing_data: briefing,
            portfolio_snapshot: portfolio,
          });
        }
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

  function removeHolding(index: number) {
    const ticker = portfolio[index]?.ticker;
    setPortfolio(p => p.filter((_, i) => i !== index));
    setEditing(null);
    if (ticker) {
      setHistory(prev => [{
        time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
        description: `Removed ${ticker}`,
      }, ...prev]);
    }
  }

  function addHolding() {
    const newIndex = portfolio.length;
    setPortfolio(p => [...p, { ticker: '', units: 1, market: 'ASX' }]);
    setEditing({ index: newIndex, field: 'ticker', previousValue: '' });
  }

  function startEdit(index: number, field: 'ticker' | 'units' | 'market', previousValue: string | number) {
    setEditing({ index, field, previousValue });
  }

  function commitEdit(index: number, field: 'ticker' | 'units' | 'market', rawValue: string) {
    if (editCancelledRef.current) { editCancelledRef.current = false; return; }
    editCancelledRef.current = false;
    const isNewRow = portfolio[index]?.ticker === '';
    if (field === 'ticker') {
      const ticker = validateTicker(rawValue);
      if (!ticker || portfolio.some((h, j) => j !== index && h.ticker === ticker)) {
        if (isNewRow) setPortfolio(p => p.filter((_, i) => i !== index));
        setEditing(null);
        return;
      }
      if (!isNewRow && ticker === portfolio[index].ticker) { setEditing(null); return; }
      setPortfolio(p => p.map((h, i) => i === index ? { ...h, ticker } : h));
      setHistory(prev => [{
        time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }),
        description: isNewRow ? `Added ${ticker}` : `Renamed to ${ticker}`,
      }, ...prev]);
    } else if (field === 'units') {
      const units = validateUnits(rawValue);
      if (!units || units === portfolio[index]?.units) { setEditing(null); return; }
      setPortfolio(p => p.map((h, i) => i === index ? { ...h, units } : h));
    } else if (field === 'market') {
      const market = rawValue as 'ASX' | 'NASDAQ' | 'NYSE';
      if (market === portfolio[index]?.market) { setEditing(null); return; }
      setPortfolio(p => p.map((h, i) => i === index ? { ...h, market } : h));
    }
    setEditing(null);
  }

  function cancelEdit() {
    editCancelledRef.current = true;
    if (editing && portfolio[editing.index]?.ticker === '') {
      setPortfolio(p => p.filter((_, i) => i !== editing!.index));
    }
    setEditing(null);
  }

  const totalUnits = portfolio.reduce((s, h) => s + h.units, 0);

  // Market lookup map for TradingView charts and price fetching
  const marketMap: Record<string, 'ASX' | 'NASDAQ' | 'NYSE'> = {};
  for (const h of portfolio) { marketMap[h.ticker] = h.market; }
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

            {/* Generate / regenerate button — or sign-in gate with hero */}
            {isSupabaseConfigured && !user && !authLoading ? (
              <div className="animate-fade-in">
                {/* Hero */}
                <div className="text-center mb-6">
                  <p className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                    Stop manually researching every holding before market open.
                  </p>
                  <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                    AI-powered fund manager briefings — ADD/HOLD/TRIM/EXIT signals with TA and live news, delivered daily.
                  </p>
                </div>

                {/* Static sample card */}
                <div className="rounded-xl p-5 mb-5"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', opacity: 0.85 }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono font-bold text-base" style={{ color: 'var(--text-primary)' }}>BHP</span>
                      <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                        style={{ background: '#052e16', color: '#4ade80' }}>▲ $44.32</span>
                    </div>
                    <span className="text-xs px-3 py-1 rounded-full font-bold tracking-wider"
                      style={SIGNAL_STYLE.HOLD}>HOLD</span>
                  </div>
                  <div className="flex flex-wrap gap-2 mb-3">
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                      style={{ background: '#1e3a5f', color: '#93c5fd' }}>Materials</span>
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                      style={{ background: '#14352a', color: '#6ee7b7' }}>AU</span>
                    <span className="text-xs px-2 py-0.5 rounded-md"
                      style={{ background: '#1c1917', color: '#a8a29e' }}>
                      <span className="font-mono" style={{ color: '#fb923c' }}>●●○</span>{' '}Medium
                      <span style={{ color: '#44403c', margin: '0 5px' }}>|</span>Risk <span style={{ color: '#a8a29e' }}>–</span>
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Thesis:</span>
                    <span className="text-xs font-semibold" style={{ color: '#fb923c' }}>developing</span>
                  </div>
                  <div className="text-xs mb-3 font-mono px-2 py-1.5 rounded"
                    style={{ background: '#0f172a', color: '#7dd3fc', border: '1px solid #1e3a5f' }}>
                    RSI 52 · MACD bullish · +3.1% vs 200DMA
                  </div>
                  <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>
                    Iron ore demand outlook softening on China construction data. Copper division provides partial offset — watch for Q2 production guidance revision at the upcoming results.
                  </p>
                  <div className="mt-3 text-xs italic" style={{ color: 'var(--text-muted)' }}>
                    — Sample briefing card. Sign in to generate yours.
                  </div>
                </div>

                {/* Sign-in CTA */}
                <button
                  onClick={signIn}
                  className="w-full py-3 rounded-xl text-sm font-semibold mb-2 transition-all flex items-center justify-center gap-2"
                  style={{ background: 'var(--accent)', color: '#fff', cursor: 'pointer' }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                  </svg>
                  Try free — sign in with Google, no credit card
                </button>
                <p className="text-xs text-center" style={{ color: 'var(--text-muted)' }}>
                  By continuing you agree to our{' '}
                  <a href="/privacy" style={{ color: '#6b7280', textDecoration: 'underline' }}>Privacy Policy</a>
                </p>
              </div>
            ) : countdown ? (
              <div className="mb-2">
                <button
                  disabled
                  className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
                  style={{ background: 'var(--border)', color: 'var(--text-muted)', cursor: 'not-allowed' }}>
                  <span className="flex items-center justify-center gap-2">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <polyline points="12 6 12 12 16 14"/>
                    </svg>
                    Next briefing in {countdown}
                  </span>
                </button>
                <p className="text-xs text-center mt-1" style={{ color: 'var(--text-muted)' }}>
                  Briefings refresh automatically every 24 hours
                </p>
              </div>
            ) : (
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
            )}

            {/* Streaming stock cards — visible during generation */}
            {briefingLoading && streamingStocks.length > 0 && (
              <div className="mb-2 animate-fade-in">
                {streamingStocks.map(stock => (
                  <StockCard key={stock.ticker} stock={stock} price={prices[stock.ticker]} market={marketMap[stock.ticker] ?? 'ASX'} />
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

            {/* Completed briefing — shown unless actively streaming new cards */}
            {briefingData && !(briefingLoading && streamingStocks.length > 0) ? (
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
                  {signalCount != null && signalCount > 0 && (
                    <span className="text-xs px-2 py-0.5 rounded"
                      style={{ background: '#1c1917', color: '#a8a29e', border: '1px solid #44403c' }}>
                      {signalCount} signal{signalCount !== 1 ? 's' : ''} tracked
                    </span>
                  )}
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
                  <StockCard key={stock.ticker} stock={stock} price={prices[stock.ticker]} market={marketMap[stock.ticker] ?? 'ASX'} />
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
              {/* Header */}
              <div className="grid px-4 py-2 text-xs font-medium tracking-wider"
                style={{ gridTemplateColumns: '1fr 88px 60px 32px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>
                <span>TICKER</span>
                <span>EXCHANGE</span>
                <span className="text-right">UNITS</span>
                <span />
              </div>

              {portfolio.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  No holdings yet. Tap + below to add one.
                </div>
              ) : (
                portfolio.map((h, i) => (
                  <div key={`${h.ticker}-${i}`}
                    className="grid items-center px-4 py-3"
                    style={{ gridTemplateColumns: '1fr 88px 60px 32px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>

                    {/* Ticker cell */}
                    {editing?.index === i && editing.field === 'ticker' ? (
                      <input
                        autoFocus
                        defaultValue={h.ticker}
                        placeholder="TICKER"
                        className="font-mono font-semibold text-sm bg-transparent outline-none border-b w-full"
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)' }}
                        onBlur={e => commitEdit(i, 'ticker', e.currentTarget.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                    ) : (
                      <span
                        className="font-mono font-semibold text-sm cursor-text"
                        style={{ color: 'var(--text-primary)' }}
                        onClick={() => startEdit(i, 'ticker', h.ticker)}>
                        {h.ticker}
                      </span>
                    )}

                    {/* Market badge / select */}
                    {editing?.index === i && editing.field === 'market' ? (
                      <select
                        autoFocus
                        value={h.market}
                        className="text-xs bg-transparent outline-none"
                        style={{ color: 'var(--text-primary)', border: '1px solid var(--accent)', borderRadius: '4px', padding: '2px 4px', background: 'var(--bg-card)' }}
                        onChange={e => commitEdit(i, 'market', e.target.value)}
                        onBlur={e => commitEdit(i, 'market', e.target.value)}
                        onKeyDown={e => e.key === 'Escape' && cancelEdit()}>
                        <option value="ASX">ASX</option>
                        <option value="NASDAQ">NASDAQ</option>
                        <option value="NYSE">NYSE</option>
                      </select>
                    ) : (
                      <span
                        className="text-xs font-mono cursor-pointer px-1.5 py-0.5 rounded inline-block"
                        style={{ background: '#1c1917', color: '#a8a29e' }}
                        onClick={() => startEdit(i, 'market', h.market)}>
                        {h.market}
                      </span>
                    )}

                    {/* Units cell */}
                    {editing?.index === i && editing.field === 'units' ? (
                      <input
                        autoFocus
                        type="number"
                        min="1"
                        step="1"
                        defaultValue={h.units}
                        className="text-sm tabular-nums text-right bg-transparent outline-none border-b w-full"
                        style={{ color: 'var(--text-primary)', borderColor: 'var(--accent)' }}
                        onBlur={e => commitEdit(i, 'units', e.currentTarget.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') e.currentTarget.blur();
                          if (e.key === 'Escape') cancelEdit();
                        }}
                      />
                    ) : (
                      <span
                        className="text-sm tabular-nums text-right cursor-text block"
                        style={{ color: '#9ca3af' }}
                        onClick={() => startEdit(i, 'units', h.units)}>
                        {h.units.toLocaleString()}
                      </span>
                    )}

                    {/* Delete — always visible */}
                    <button
                      onClick={() => removeHolding(i)}
                      className="w-5 h-5 flex items-center justify-center rounded text-xs ml-auto"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseOver={e => (e.currentTarget.style.color = 'var(--danger)')}
                      onMouseOut={e => (e.currentTarget.style.color = 'var(--text-muted)')}
                      aria-label={`Remove ${h.ticker}`}>✕</button>
                  </div>
                ))
              )}

              {/* Add holding */}
              <button
                onClick={addHolding}
                className="w-full py-3 text-sm flex items-center justify-center gap-1.5 transition-colors"
                style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)', background: 'none', cursor: 'pointer' }}
                onMouseOver={e => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseOut={e => (e.currentTarget.style.color = 'var(--text-muted)')}>
                + Add holding
              </button>

              {portfolio.filter(h => h.ticker !== '').length > 0 && (
                <div className="flex justify-between px-4 py-2 text-xs"
                  style={{ borderTop: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  <span>{portfolio.filter(h => h.ticker !== '').length} holdings</span>
                  <span>{totalUnits.toLocaleString()} total units</span>
                </div>
              )}
            </div>

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
