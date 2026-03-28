'use client';

import { useState, useEffect, useRef } from 'react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';

type Holding = { ticker: string; units: number };
type HistoryEntry = { time: string; description: string };

type StockCard = {
  ticker: string;
  sentiment: 'positive' | 'neutral' | 'negative';
  sector: string;
  country: string;
  commentary: string;
};

type BriefingData = {
  stocks: StockCard[];
  generalisation: {
    sectorBreakdown: string;
    regionExposure: string;
    riskProfile: string;
    actionableOutlook: string;
  };
};

const SENTIMENT_STYLE: Record<string, React.CSSProperties> = {
  positive: { background: '#14532d', color: '#86efac' },
  neutral:  { background: '#292524', color: '#a8a29e' },
  negative: { background: '#450a0a', color: '#fca5a5' },
};

const SENTIMENT_LABEL: Record<string, string> = {
  positive: '▲ Positive',
  neutral:  '● Neutral',
  negative: '▼ Negative',
};

const OVERVIEW_SECTIONS = [
  { key: 'sectorBreakdown',  label: 'SECTOR BREAKDOWN'  },
  { key: 'regionExposure',   label: 'REGION EXPOSURE'   },
  { key: 'riskProfile',      label: 'RISK PROFILE'      },
  { key: 'actionableOutlook', label: 'ACTIONABLE OUTLOOK' },
] as const;

const DEFAULT_PORTFOLIO: Holding[] = [
  { ticker: 'CQE',  units: 243 },
  { ticker: 'EBTC', units: 156 },
  { ticker: 'EETH', units: 695 },
  { ticker: 'MFF',  units: 581 },
  { ticker: 'TLS',  units: 180 },
  { ticker: 'WOW',  units: 50  },
  { ticker: 'VGS',  units: 163 },
  { ticker: 'VAS',  units: 54  },
  { ticker: 'VAE',  units: 105 },
];

const STORAGE_KEY = 'portfolio-briefing-holdings';

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

function savePortfolio(portfolio: Holding[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(portfolio)); } catch {}
}

export default function Home() {
  const [tab, setTab] = useState<'briefing' | 'portfolio'>('briefing');
  const [portfolio, setPortfolio] = useState<Holding[]>(DEFAULT_PORTFOLIO);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [briefingData, setBriefingData] = useState<BriefingData | null>(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState('');
  const [nlInput, setNlInput] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState('');
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Refs for stable access inside effects and callbacks
  const portfolioRef = useRef<Holding[]>(DEFAULT_PORTFOLIO);
  const userRef = useRef<User | null>(null);
  const portfolioInitialized = useRef(false);

  useEffect(() => { portfolioRef.current = portfolio; }, [portfolio]);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── Bootstrap: load portfolio from localStorage, then wire up Supabase auth ──
  useEffect(() => {
    setPortfolio(loadPortfolio());

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

        const { data } = await supabase
          .from('portfolios')
          .select('holdings')
          .eq('user_id', currentUser.id)
          .single();

        if (data?.holdings && Array.isArray(data.holdings) && data.holdings.length > 0) {
          // Returning user — restore their saved portfolio
          setPortfolio(data.holdings);
        } else {
          // New user — push the current (localStorage) portfolio to Supabase
          await supabase.from('portfolios').upsert({
            user_id: currentUser.id,
            holdings: portfolioRef.current,
            updated_at: new Date().toISOString(),
          });
        }
      },
    );

    return () => subscription.unsubscribe();
  }, []);

  // ── Persist portfolio to localStorage (and Supabase when signed in) ──
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

  async function signIn() {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  }

  async function signOut() {
    await supabase.auth.signOut();
    setUser(null);
  }

  async function generateBriefing() {
    setBriefingLoading(true);
    setBriefingError('');
    try {
      const res = await fetch('/api/briefing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ portfolio }),
      });
      if (!res.ok) throw new Error('API error');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setBriefingData(data.briefing);
    } catch {
      setBriefingError('Failed to generate briefing. Check your ANTHROPIC_API_KEY.');
    } finally {
      setBriefingLoading(false);
    }
  }

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
        setHistory(prev => [
          { time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }), description: data.description },
          ...prev,
        ]);
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
    setHistory(prev => [
      { time: new Date().toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' }), description: `Removed ${ticker}` },
      ...prev,
    ]);
  }

  const totalUnits = portfolio.reduce((s, h) => s + h.units, 0);
  const today = new Date().toLocaleDateString('en-AU', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  });

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
                    style={{ background: 'var(--bg-card)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                  >
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  onClick={signIn}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}
                >
                  {/* Google logo */}
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
              style={tab === t ? { background: 'var(--accent)', color: '#fff' } : { color: 'var(--text-muted)' }}
            >
              {t === 'briefing' ? '📊  Briefing' : '💼  Portfolio'}
            </button>
          ))}
        </div>

        {/* ── BRIEFING TAB ── */}
        {tab === 'briefing' && (
          <div className="animate-fade-in">
            <button
              onClick={generateBriefing}
              disabled={briefingLoading}
              className="w-full py-3 rounded-xl text-sm font-semibold mb-4 transition-all"
              style={{
                background: briefingLoading ? 'var(--border)' : 'var(--accent)',
                color: briefingLoading ? 'var(--text-muted)' : '#fff',
                cursor: briefingLoading ? 'not-allowed' : 'pointer',
              }}
            >
              {briefingLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3" />
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  </svg>
                  Generating your briefing…
                </span>
              ) : briefingData ? 'Regenerate Briefing' : 'Generate Briefing'}
            </button>

            {briefingError && (
              <p className="text-sm mb-4 px-4 py-3 rounded-lg"
                style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
                {briefingError}
              </p>
            )}

            {briefingData ? (
              <div className="animate-fade-in">
                {/* Per-stock cards */}
                {briefingData.stocks.map(stock => (
                  <div key={stock.ticker} className="rounded-xl p-5 mb-3"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    {/* Title row */}
                    <div className="flex items-center justify-between mb-3">
                      <span className="font-mono font-bold text-base" style={{ color: 'var(--text-primary)' }}>
                        {stock.ticker}
                      </span>
                      <span className="text-xs px-2.5 py-1 rounded-full font-medium"
                        style={SENTIMENT_STYLE[stock.sentiment] ?? SENTIMENT_STYLE.neutral}>
                        {SENTIMENT_LABEL[stock.sentiment] ?? stock.sentiment}
                      </span>
                    </div>
                    {/* Sector & country tags */}
                    <div className="flex gap-2 mb-3 flex-wrap">
                      <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                        style={{ background: '#1e3a5f', color: '#93c5fd' }}>
                        {stock.sector}
                      </span>
                      <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                        style={{ background: '#14352a', color: '#6ee7b7' }}>
                        {stock.country}
                      </span>
                    </div>
                    {/* Commentary */}
                    <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>
                      {stock.commentary}
                    </p>
                  </div>
                ))}

                {/* Portfolio generalisation */}
                <div className="rounded-xl p-5 mt-1"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                  <p className="text-xs font-semibold tracking-wider mb-4"
                    style={{ color: 'var(--text-muted)' }}>
                    PORTFOLIO OVERVIEW
                  </p>
                  <div className="space-y-4">
                    {OVERVIEW_SECTIONS.map(({ key, label }) => (
                      <div key={key}>
                        <p className="text-xs font-medium tracking-wider mb-1.5"
                          style={{ color: 'var(--accent)' }}>
                          {label}
                        </p>
                        <p className="text-sm leading-relaxed" style={{ color: '#d1d5db' }}>
                          {briefingData.generalisation[key]}
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
                <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  Tap Generate to receive your daily<br />AI analysis of your ASX holdings.
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
                  <div key={h.ticker} className="flex items-center justify-between px-4 py-3 group"
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
                        aria-label={`Remove ${h.ticker}`}
                      >✕</button>
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
                placeholder='e.g. "Add NDQ" or "Set TLS to 200" or "Remove VGS"'
                className="flex-1 px-4 py-2.5 rounded-xl text-sm outline-none transition-all"
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
                }}
              >{nlLoading ? '…' : 'Update'}</button>
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
