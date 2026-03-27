'use client';

import { useState, useEffect, useRef } from 'react';

type Holding = { ticker: string; units: number };
type HistoryEntry = { time: string; description: string };

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
  const [briefing, setBriefing] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [briefingError, setBriefingError] = useState('');
  const [nlInput, setNlInput] = useState('');
  const [nlLoading, setNlLoading] = useState(false);
  const [nlError, setNlError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setPortfolio(loadPortfolio()); }, []);
  useEffect(() => { savePortfolio(portfolio); }, [portfolio]);

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
      setBriefing(data.briefing);
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

        <div className="mb-8">
          <h1 className="text-xl font-semibold tracking-tight" style={{ color: 'var(--text-primary)' }}>
            Portfolio Briefing
          </h1>
          <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{today}</p>
        </div>

        {/* Tabs */}
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
              ) : briefing ? 'Regenerate Briefing' : 'Generate Briefing'}
            </button>

            {briefingError && (
              <p className="text-sm mb-4 px-4 py-3 rounded-lg"
                style={{ background: '#450a0a', color: '#fca5a5', border: '1px solid #7f1d1d' }}>
                {briefingError}
              </p>
            )}

            {briefing ? (
              <div className="rounded-xl p-5 text-sm leading-relaxed whitespace-pre-wrap animate-fade-in"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: '#d1d5db' }}>
                {briefing}
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
                placeholder='e.g. "Add 20 NDQ" or "Set TLS to 200"'
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
