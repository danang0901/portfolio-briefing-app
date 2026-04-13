'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { validateTicker, validateUnits } from '@/lib/portfolio-validators';
import { supabase, isSupabaseConfigured } from '@/lib/supabase';
import type { User } from '@supabase/supabase-js';
import type { BriefingData, BriefingOverview, StockSignal } from '@/app/api/briefing/route';
import type { InvestorProfile } from '@/lib/briefing-generator';
import type { TopPicksData, TopPick, PickCategory } from '@/lib/top-picks-universe';

type Holding = { ticker: string; units: number; market: 'ASX' | 'NASDAQ' | 'NYSE' };
type HistoryEntry = { time: string; description: string };
type PriceMap = Record<string, { label: string; direction: 'up' | 'down' | 'flat' | null }>;
type EditingState = { index: number; field: 'ticker' | 'units' | 'market'; previousValue: string | number };

// ── Signal styling ────────────────────────────────────────────────────────────

const SIGNAL_STYLE: Record<string, React.CSSProperties> = {
  ADD:  { background: 'rgba(34,197,94,0.1)',   color: '#4ade80', border: '1px solid rgba(34,197,94,0.22)',   fontWeight: 600 },
  HOLD: { background: 'rgba(148,163,184,0.08)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.18)', fontWeight: 600 },
  TRIM: { background: 'rgba(251,146,60,0.1)',  color: '#fb923c', border: '1px solid rgba(251,146,60,0.22)',  fontWeight: 600 },
  EXIT: { background: 'rgba(248,113,113,0.1)', color: '#f87171', border: '1px solid rgba(248,113,113,0.22)', fontWeight: 600 },
};

// Left border accent color per signal
const SIGNAL_ACCENT: Record<string, string> = {
  ADD:  '#22c55e',
  HOLD: '#64748b',
  TRIM: '#fb923c',
  EXIT: '#f87171',
};

// Market badge styles
const MARKET_STYLE: Record<string, React.CSSProperties> = {
  ASX:    { background: 'rgba(59,130,246,0.1)',  color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)'  },
  NASDAQ: { background: 'rgba(139,92,246,0.1)',  color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)'  },
  NYSE:   { background: 'rgba(251,146,60,0.1)',  color: '#fb923c', border: '1px solid rgba(251,146,60,0.2)'  },
};

const SIGNAL_LABEL: Record<string, string> = {
  ADD:  'Accumulate Thesis',
  HOLD: 'Monitor',
  TRIM: 'Review Exposure',
  EXIT: 'Thesis Broken',
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

// ── Beginner-mode plain-English signal summaries ──────────────────────────────

const SIGNAL_BEGINNER_SUMMARY: Record<string, string> = {
  ADD:  'The data suggests this holding is worth building on.',
  HOLD: 'Nothing urgent — the investment case looks intact.',
  TRIM: 'Risk has increased — worth reviewing your position size.',
  EXIT: 'The original investment case has changed materially.',
};

const BEGINNER_VIEW_KEY = 'portfolio-beginner-view';

// ── Picks: signal + confidence priority ──────────────────────────────────────

const SIGNAL_PRIORITY: Record<string, number> = { ADD: 0, TRIM: 1, EXIT: 2, HOLD: 3 };
const CONFIDENCE_PRIORITY: Record<string, number> = { High: 0, Medium: 1, Low: 2 };

function sortByActionPriority(stocks: StockSignal[]): StockSignal[] {
  return [...stocks].sort((a, b) => {
    const sigDiff = (SIGNAL_PRIORITY[a.signal] ?? 3) - (SIGNAL_PRIORITY[b.signal] ?? 3);
    if (sigDiff !== 0) return sigDiff;
    return (CONFIDENCE_PRIORITY[a.confidence] ?? 2) - (CONFIDENCE_PRIORITY[b.confidence] ?? 2);
  });
}

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

// Stable fingerprint for portfolio comparison — order-independent.
function portfolioFingerprint(holdings: Holding[]): string {
  return [...holdings]
    .sort((a, b) => a.ticker.localeCompare(b.ticker))
    .map(h => `${h.ticker}:${h.market ?? 'ASX'}:${h.units}`)
    .join(',');
}

function loadCachedBriefing(currentPortfolio?: Holding[]): BriefingData | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BRIEFING_KEY);
    if (!raw) return null;
    const { data, date, portfolioFp } = JSON.parse(raw);
    const today = new Date().toDateString();
    if (date !== today) return null; // stale — different day
    // If we know the current portfolio and the cache has a fingerprint, verify they match
    if (currentPortfolio && portfolioFp && portfolioFingerprint(currentPortfolio) !== portfolioFp) return null;
    return data as BriefingData;
  } catch {
    return null;
  }
}

function saveCachedBriefing(data: BriefingData, portfolio?: Holding[]) {
  try {
    localStorage.setItem(BRIEFING_KEY, JSON.stringify({
      data,
      date: new Date().toDateString(),
      portfolioFp: portfolio ? portfolioFingerprint(portfolio) : undefined,
    }));
  } catch {}
}

function loadBeginnerView(): boolean {
  if (typeof window === 'undefined') return true;
  const raw = localStorage.getItem(BEGINNER_VIEW_KEY);
  // null = never set → default to beginner view (true)
  return raw === null || raw === 'true';
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

function StockCard({ stock, price, market = 'ASX', beginnerView = true }: {
  stock: StockSignal;
  price?: { label: string; direction: 'up' | 'down' | 'flat' | null };
  market?: string;
  beginnerView?: boolean;
}) {
  const [chartOpen, setChartOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);
  const accent = SIGNAL_ACCENT[stock.signal] ?? '#64748b';

  return (
    <div className="rounded-xl mb-3 overflow-hidden transition-colors"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderLeft: `3px solid ${accent}` }}>
      <div className="p-4">

        {/* Top row: ticker + price + signal badge */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <span className="font-mono font-bold text-lg tracking-tight" style={{ color: 'var(--text-primary)', lineHeight: 1 }}>
              {stock.ticker}
            </span>
            {price?.label && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded-md"
                style={{
                  background: price.direction === 'up' ? 'rgba(34,197,94,0.1)' : price.direction === 'down' ? 'rgba(248,113,113,0.1)' : 'rgba(148,163,184,0.08)',
                  color: price.direction === 'up' ? '#4ade80' : price.direction === 'down' ? '#f87171' : '#94a3b8',
                  border: `1px solid ${price.direction === 'up' ? 'rgba(34,197,94,0.2)' : price.direction === 'down' ? 'rgba(248,113,113,0.2)' : 'rgba(148,163,184,0.15)'}`,
                }}>
                {price.direction === 'up' ? '▲' : price.direction === 'down' ? '▼' : ''} {price.label}
              </span>
            )}
          </div>
          <span className="text-xs px-3 py-1.5 rounded-full font-bold tracking-wide"
            style={SIGNAL_STYLE[stock.signal] ?? SIGNAL_STYLE.HOLD}>
            {SIGNAL_LABEL[stock.signal] ?? stock.signal}
          </span>
        </div>

        {/* Beginner-mode: plain-English signal summary */}
        {beginnerView && (
          <p className="text-xs mb-3 leading-relaxed" style={{ color: '#7c8fa8', fontStyle: 'italic' }}>
            {SIGNAL_BEGINNER_SUMMARY[stock.signal] ?? ''}
          </p>
        )}

        {/* Detail-mode: sector + country + confidence + risk + thesis */}
        {!beginnerView && (
          <>
            <div className="flex flex-wrap gap-1.5 mb-3">
              <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                style={{ background: 'rgba(30,58,95,0.6)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.15)' }}>
                {stock.sector}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md font-medium"
                style={{ background: 'rgba(20,53,42,0.6)', color: '#6ee7b7', border: '1px solid rgba(34,197,94,0.15)' }}>
                {stock.country}
              </span>
              <span className="text-xs px-2 py-0.5 rounded-md flex items-center gap-1.5"
                style={{ background: 'rgba(255,255,255,0.03)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                <span className="font-mono text-xs" style={{ color: CONFIDENCE_COLOR[stock.confidence] ?? '#a8a29e', letterSpacing: '-1px' }}>
                  {CONFIDENCE_DOTS[stock.confidence] ?? '○○○'}
                </span>
                <span style={{ color: 'var(--border-strong)' }}>·</span>
                Risk <span style={{ color: RISK_COLOR[stock.risk_change] ?? '#a8a29e', fontWeight: 600 }}>
                  {RISK_ICON[stock.risk_change] ?? '–'}
                </span>
              </span>
            </div>
            <div className="flex items-center gap-1.5 mb-3">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Thesis</span>
              <span style={{ color: 'var(--border)' }}>·</span>
              <span className="text-xs font-semibold capitalize"
                style={THESIS_STYLE[stock.thesis_status] ?? {}}>
                {stock.thesis_status}
              </span>
            </div>
          </>
        )}

        {/* Technical analysis — shown in both modes */}
        {stock.ta_context && (
          <TechnicalBar taContext={stock.ta_context} ticker={stock.ticker} />
        )}

        {/* Catalyst — main text */}
        <p className="text-sm leading-relaxed mb-3" style={{ color: '#cbd5e1', lineHeight: '1.6' }}>
          {stock.catalyst}
        </p>

        {/* Upcoming catalyst */}
        {stock.upcoming_catalyst && (
          <div className="flex items-start gap-2.5 mb-2.5 text-xs rounded-lg px-3 py-2.5"
            style={{ background: 'rgba(30,41,59,0.7)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.12)' }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span className="leading-relaxed">{stock.upcoming_catalyst}</span>
          </div>
        )}

        {/* What to watch */}
        {stock.what_to_watch && (
          <div className="flex items-start gap-2.5 mb-2.5 text-xs rounded-lg px-3 py-2.5"
            style={{ background: 'rgba(28,18,7,0.8)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.12)' }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <span className="leading-relaxed">{stock.what_to_watch}</span>
          </div>
        )}

        {/* Bottom actions row */}
        <div className="flex items-center gap-3 mt-3 pt-2.5"
          style={{ borderTop: '1px solid var(--border)' }}>
          {/* Chart toggle */}
          <button
            onClick={() => setChartOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
            style={{ color: chartOpen ? '#60a5fa' : 'var(--text-muted)', background: chartOpen ? 'rgba(59,130,246,0.08)' : 'transparent', border: `1px solid ${chartOpen ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`, cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            {chartOpen ? 'Hide chart' : 'Chart'}
          </button>

          {/* Citations toggle — detail mode only */}
          {!beginnerView && stock.citations && stock.citations.length > 0 && (
            <button
              onClick={() => setCitationsOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5 transition-colors"
              style={{ color: citationsOpen ? '#60a5fa' : 'var(--text-muted)', background: citationsOpen ? 'rgba(59,130,246,0.08)' : 'transparent', border: `1px solid ${citationsOpen ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`, cursor: 'pointer' }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>
              </svg>
              {stock.citations.length} {stock.citations.length === 1 ? 'source' : 'sources'}
            </button>
          )}
        </div>

        {/* Citations expanded */}
        {citationsOpen && stock.citations && (
          <ul className="mt-2.5 space-y-1 pl-3" style={{ borderLeft: '2px solid var(--border)' }}>
            {stock.citations.map((c, i) => (
              <li key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>{c}</li>
            ))}
          </ul>
        )}

        {chartOpen && <TradingViewChart ticker={stock.ticker} market={market} />}
      </div>
    </div>
  );
}

// ── Picks Card (compact, actionable-focused) ─────────────────────────────────

function PicksCard({ stock, price, market = 'ASX' }: {
  stock: StockSignal;
  price?: { label: string; direction: 'up' | 'down' | 'flat' | null };
  market?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);

  const accent = ({ ADD: '#22c55e', TRIM: '#fb923c', EXIT: '#f87171' } as Record<string, string>)[stock.signal] ?? '#94a3b8';
  const accentBg = ({ ADD: 'rgba(34,197,94,0.05)', TRIM: 'rgba(251,146,60,0.05)', EXIT: 'rgba(248,113,113,0.05)' } as Record<string, string>)[stock.signal] ?? 'rgba(148,163,184,0.04)';

  return (
    <div className="rounded-xl mb-3"
      style={{ background: accentBg, border: `1px solid ${accent}28`, borderLeft: `3px solid ${accent}` }}>
      <div className="p-4">

        {/* Top row: ticker + price + signal badge */}
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              {stock.ticker}
            </span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded font-medium"
              style={{ ...(MARKET_STYLE[market] ?? MARKET_STYLE.ASX) }}>
              {market}
            </span>
            {price?.label && (
              <span className="text-xs font-mono px-1.5 py-0.5 rounded"
                style={{
                  background: price.direction === 'up' ? 'rgba(34,197,94,0.1)' : price.direction === 'down' ? 'rgba(248,113,113,0.1)' : 'rgba(148,163,184,0.08)',
                  color: price.direction === 'up' ? '#4ade80' : price.direction === 'down' ? '#f87171' : '#a8a29e',
                }}>
                {price.direction === 'up' ? '▲' : price.direction === 'down' ? '▼' : ''} {price.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-mono" style={{ color: CONFIDENCE_COLOR[stock.confidence] ?? '#a8a29e' }}>
              {CONFIDENCE_DOTS[stock.confidence] ?? '○○○'}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full font-bold"
              style={SIGNAL_STYLE[stock.signal] ?? SIGNAL_STYLE.HOLD}>
              {stock.signal}
            </span>
          </div>
        </div>

        {/* TA context */}
        {stock.ta_context && (
          <div className="text-xs mb-2.5 font-mono px-2 py-1.5 rounded"
            style={{ background: 'rgba(15,23,42,0.8)', color: '#7dd3fc', border: '1px solid rgba(30,58,95,0.5)' }}>
            {stock.ta_context}
          </div>
        )}

        {/* Catalyst — clamps to 3 lines unless expanded */}
        <p className="text-sm leading-relaxed mb-1.5"
          style={{
            color: '#cbd5e1',
            display: '-webkit-box',
            WebkitLineClamp: expanded ? undefined : 3,
            WebkitBoxOrient: 'vertical',
            overflow: expanded ? 'visible' : 'hidden',
          } as React.CSSProperties}>
          {stock.catalyst}
        </p>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs mb-2.5"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? '▲ Less' : '▼ More'}
        </button>

        {/* Upcoming catalyst — only when expanded */}
        {expanded && stock.upcoming_catalyst && (
          <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-2.5"
            style={{ background: 'rgba(30,41,59,0.7)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.12)' }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
              <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
            </svg>
            <span>{stock.upcoming_catalyst}</span>
          </div>
        )}

        {/* Bottom row: chart + sector/country */}
        <div className="flex items-center justify-between pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setChartOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5"
            style={{ color: chartOpen ? '#60a5fa' : 'var(--text-muted)', background: chartOpen ? 'rgba(59,130,246,0.08)' : 'transparent', border: `1px solid ${chartOpen ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`, cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            {chartOpen ? 'Hide chart' : 'Chart'}
          </button>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {stock.sector}{stock.country ? ` · ${stock.country}` : ''}
          </span>
        </div>

        {chartOpen && <TradingViewChart ticker={stock.ticker} market={market} />}
      </div>
    </div>
  );
}

// ── Top Picks — category styling ─────────────────────────────────────────────

const CATEGORY_STYLE: Record<PickCategory, { color: string; bg: string; border: string; label: string }> = {
  'HIGHEST CONVICTION': { color: '#a78bfa', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.25)', label: 'Highest Conviction' },
  'INCOME & YIELD':     { color: '#34d399', bg: 'rgba(52,211,153,0.08)', border: 'rgba(52,211,153,0.25)', label: 'Income & Yield' },
  'GROWTH CATALYST':    { color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.25)', label: 'Growth Catalyst' },
  'DEFENSIVE ANCHOR':   { color: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.22)', label: 'Defensive Anchor' },
  'SPECULATIVE EDGE':   { color: '#fb923c', bg: 'rgba(251,146,60,0.08)', border: 'rgba(251,146,60,0.25)', label: 'Speculative Edge' },
};

// ── Top Picks Card ────────────────────────────────────────────────────────────

function TopPicksCard({ pick }: { pick: TopPick }) {
  const [expanded, setExpanded] = useState(false);
  const [chartOpen, setChartOpen] = useState(false);
  const [citationsOpen, setCitationsOpen] = useState(false);

  const cat = CATEGORY_STYLE[pick.category] ?? CATEGORY_STYLE['HIGHEST CONVICTION'];
  const signalAccent = ({ ADD: '#22c55e', TRIM: '#fb923c', EXIT: '#f87171' } as Record<string, string>)[pick.signal] ?? '#94a3b8';

  return (
    <div className="rounded-xl mb-3 overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

      {/* Category header strip */}
      <div className="px-4 py-2 flex items-center gap-2"
        style={{ background: cat.bg, borderBottom: `1px solid ${cat.border}` }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cat.color }} />
        <span className="text-xs font-semibold tracking-wider" style={{ color: cat.color }}>
          {cat.label.toUpperCase()}
        </span>
      </div>

      <div className="p-4">
        {/* Top row: ticker + market + price direction + signal badge */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono font-bold text-base" style={{ color: 'var(--text-primary)' }}>
              {pick.ticker}
            </span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded font-medium"
              style={{ ...(MARKET_STYLE[pick.market] ?? MARKET_STYLE.ASX) }}>
              {pick.market}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-md font-medium"
              style={{ background: '#1c1917', color: '#a8a29e' }}>
              {pick.sector}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className="text-xs font-mono" style={{ color: CONFIDENCE_COLOR[pick.confidence] ?? '#a8a29e' }}>
              {CONFIDENCE_DOTS[pick.confidence] ?? '○○○'}
            </span>
            <span className="text-xs px-2.5 py-1 rounded-full font-bold"
              style={SIGNAL_STYLE[pick.signal] ?? SIGNAL_STYLE.HOLD}>
              {pick.signal}
            </span>
          </div>
        </div>

        {/* Time horizon + thesis status row */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span className="text-xs px-2 py-0.5 rounded-md font-medium"
            style={{ background: `${cat.color}15`, color: cat.color, border: `1px solid ${cat.border}` }}>
            {pick.time_horizon}
          </span>
          <span className="text-xs flex items-center gap-1">
            <span style={{ color: 'var(--text-muted)' }}>Thesis:</span>
            <span className="font-semibold capitalize"
              style={{ color: THESIS_STYLE[pick.thesis_status]?.color ?? '#a8a29e' }}>
              {pick.thesis_status}
            </span>
          </span>
          <span className="text-xs flex items-center gap-1">
            <span style={{ color: 'var(--text-muted)' }}>Risk:</span>
            <span style={{ color: RISK_COLOR[pick.risk_change] ?? '#a8a29e' }}>
              {RISK_ICON[pick.risk_change] ?? '–'}
            </span>
          </span>
        </div>

        {/* Advisory thesis — the "why I'd own this" section */}
        <div className="rounded-lg px-3 py-2.5 mb-3"
          style={{ background: `${cat.color}0d`, border: `1px solid ${cat.border}` }}>
          <p className="text-xs font-semibold mb-1 tracking-wide" style={{ color: cat.color }}>
            ADVISORY THESIS
          </p>
          <p className="text-sm leading-relaxed" style={{ color: '#e2e8f0' }}>
            {pick.advisory_thesis}
          </p>
        </div>

        {/* TA context */}
        {pick.ta_context && (
          <div className="text-xs mb-3 font-mono px-2 py-1.5 rounded"
            style={{ background: 'rgba(15,23,42,0.8)', color: '#7dd3fc', border: '1px solid rgba(30,58,95,0.5)' }}>
            {pick.ta_context}
          </div>
        )}

        {/* Catalyst — clamped unless expanded */}
        <p className="text-sm leading-relaxed mb-1.5"
          style={{
            color: '#cbd5e1',
            display: '-webkit-box',
            WebkitLineClamp: expanded ? undefined : 3,
            WebkitBoxOrient: 'vertical',
            overflow: expanded ? 'visible' : 'hidden',
          } as React.CSSProperties}>
          {pick.catalyst}
        </p>
        <button
          onClick={() => setExpanded(e => !e)}
          className="text-xs mb-3"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>
          {expanded ? '▲ Less' : '▼ More'}
        </button>

        {/* Expanded details */}
        {expanded && (
          <>
            {pick.upcoming_catalyst && (
              <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-2.5"
                style={{ background: 'rgba(30,41,59,0.7)', color: '#93c5fd', border: '1px solid rgba(59,130,246,0.12)' }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
                </svg>
                <span>{pick.upcoming_catalyst}</span>
              </div>
            )}
            {pick.what_to_watch && (
              <div className="flex items-start gap-2 text-xs rounded-lg px-3 py-2 mb-2.5"
                style={{ background: 'rgba(28,18,7,0.8)', color: '#fbbf24', border: '1px solid rgba(251,191,36,0.12)' }}>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                <span>{pick.what_to_watch}</span>
              </div>
            )}
          </>
        )}

        {/* Bottom row: chart + citations */}
        <div className="flex items-center gap-2 pt-2.5" style={{ borderTop: '1px solid var(--border)' }}>
          <button
            onClick={() => setChartOpen(o => !o)}
            className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5"
            style={{ color: chartOpen ? '#60a5fa' : 'var(--text-muted)', background: chartOpen ? 'rgba(59,130,246,0.08)' : 'transparent', border: `1px solid ${chartOpen ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`, cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
            </svg>
            {chartOpen ? 'Hide chart' : 'Chart'}
          </button>
          {pick.citations && pick.citations.length > 0 && (
            <button
              onClick={() => setCitationsOpen(o => !o)}
              className="flex items-center gap-1.5 text-xs rounded-lg px-2.5 py-1.5"
              style={{ color: citationsOpen ? '#60a5fa' : 'var(--text-muted)', background: citationsOpen ? 'rgba(59,130,246,0.08)' : 'transparent', border: `1px solid ${citationsOpen ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`, cursor: 'pointer' }}>
              <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/>
              </svg>
              {pick.citations.length} {pick.citations.length === 1 ? 'source' : 'sources'}
            </button>
          )}
          <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
            {pick.country}
          </span>
        </div>

        {citationsOpen && pick.citations && (
          <ul className="mt-2.5 space-y-1 pl-3" style={{ borderLeft: `2px solid ${cat.color}40` }}>
            {pick.citations.map((c, i) => (
              <li key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>{c}</li>
            ))}
          </ul>
        )}

        {chartOpen && <TradingViewChart ticker={pick.ticker} market={pick.market} />}
      </div>
    </div>
  );
}

// ── Blurred placeholder cards for non-signed-in users ────────────────────────

const PLACEHOLDER_PICKS: Partial<TopPick>[] = [
  { category: 'HIGHEST CONVICTION', ticker: 'NVDA', market: 'NASDAQ', signal: 'ADD', confidence: 'High', time_horizon: '6–12 months', sector: 'Technology', advisory_thesis: 'Placeholder advisory thesis for blurred preview.', catalyst: 'Placeholder catalyst text for preview display only.', ta_context: 'RSI 61 (neutral). MACD bullish. +9.4% vs 200DMA.' },
  { category: 'INCOME & YIELD',     ticker: 'CBA',  market: 'ASX',    signal: 'HOLD', confidence: 'High', time_horizon: '6–12 months', sector: 'Financials', advisory_thesis: 'Placeholder thesis.', catalyst: 'Placeholder catalyst.', ta_context: 'RSI 54 (neutral). MACD flat. +2.1% vs 200DMA.' },
  { category: 'GROWTH CATALYST',    ticker: 'AMZN', market: 'NASDAQ', signal: 'ADD',  confidence: 'Medium', time_horizon: '3–6 months', sector: 'Consumer', advisory_thesis: 'Placeholder thesis.', catalyst: 'Placeholder catalyst.', ta_context: 'RSI 58 (neutral). MACD bullish crossover. +5.3% vs 200DMA.' },
  { category: 'DEFENSIVE ANCHOR',   ticker: 'VAS',  market: 'ASX',    signal: 'HOLD', confidence: 'High', time_horizon: '1–2 years', sector: 'ETF', advisory_thesis: 'Placeholder thesis.', catalyst: 'Placeholder catalyst.', ta_context: 'RSI 50 (neutral). MACD flat. +1.2% vs 200DMA.' },
  { category: 'SPECULATIVE EDGE',   ticker: 'PLS',  market: 'ASX',    signal: 'ADD',  confidence: 'Low', time_horizon: '1–3 months', sector: 'Materials', advisory_thesis: 'Placeholder thesis.', catalyst: 'Placeholder catalyst.', ta_context: 'RSI 44 (neutral). MACD bearish. -8.2% vs 200DMA.' },
];

function PlaceholderPickCard({ pick }: { pick: Partial<TopPick> }) {
  const cat = CATEGORY_STYLE[pick.category as PickCategory] ?? CATEGORY_STYLE['HIGHEST CONVICTION'];
  return (
    <div className="rounded-xl mb-3 overflow-hidden"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="px-4 py-2 flex items-center gap-2"
        style={{ background: cat.bg, borderBottom: `1px solid ${cat.border}` }}>
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: cat.color }} />
        <span className="text-xs font-semibold tracking-wider" style={{ color: cat.color }}>
          {cat.label.toUpperCase()}
        </span>
      </div>
      <div className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <span className="font-mono font-bold text-base" style={{ color: 'var(--text-primary)' }}>{pick.ticker}</span>
            <span className="text-xs font-mono px-1.5 py-0.5 rounded font-medium"
              style={{ ...(MARKET_STYLE[pick.market ?? 'ASX'] ?? MARKET_STYLE.ASX) }}>{pick.market}</span>
            <span className="text-xs px-2 py-0.5 rounded-md" style={{ background: '#1c1917', color: '#a8a29e' }}>{pick.sector}</span>
          </div>
          <span className="text-xs px-2.5 py-1 rounded-full font-bold"
            style={SIGNAL_STYLE[pick.signal ?? 'HOLD'] ?? SIGNAL_STYLE.HOLD}>{pick.signal}</span>
        </div>
        <div className="rounded-lg px-3 py-2.5 mb-3"
          style={{ background: `${cat.color}0d`, border: `1px solid ${cat.border}` }}>
          <p className="text-xs font-semibold mb-1 tracking-wide" style={{ color: cat.color }}>ADVISORY THESIS</p>
          <div className="h-10 rounded" style={{ background: 'rgba(255,255,255,0.06)' }} />
        </div>
        {pick.ta_context && (
          <div className="text-xs mb-3 font-mono px-2 py-1.5 rounded"
            style={{ background: 'rgba(15,23,42,0.8)', color: '#7dd3fc', border: '1px solid rgba(30,58,95,0.5)' }}>
            {pick.ta_context}
          </div>
        )}
        <div className="h-12 rounded mb-2" style={{ background: 'rgba(255,255,255,0.04)' }} />
      </div>
    </div>
  );
}

// ── Investor Profile Trust Signal ─────────────────────────────────────────────

const PROFILE_LABEL: Record<string, string> = {
  'INCOME-FOCUSED': 'income-focused',
  'GROWTH': 'growth',
  'SPECULATIVE': 'speculative',
};

// ── TechnicalBar — RSI meter + DMA badge (replaces ta_context prose) ──────────

function TechnicalBar({ taContext, ticker }: { taContext: string; ticker: string }) {
  const rsiMatch = taContext.match(/RSI[:\s]+(\d+(?:\.\d+)?)/i);
  const dmaMatch = taContext.match(/([+-]?\d+(?:\.\d+)?)%.*?200[-\s]?d/i);

  if (!rsiMatch && !dmaMatch) {
    // Parse miss — fall back to prose
    console.log(`[TechnicalBar] parse miss: ${ticker}`);
    return (
      <div className="text-xs mb-3 font-mono px-3 py-2 rounded-lg flex items-start gap-2"
        style={{ background: 'rgba(15,23,42,0.8)', color: '#7dd3fc', border: '1px solid rgba(59,130,246,0.12)' }}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1, color: '#3b82f6' }}>
          <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>
        </svg>
        {taContext}
      </div>
    );
  }

  const rsi = rsiMatch ? parseFloat(rsiMatch[1]) : null;
  const dma = dmaMatch ? parseFloat(dmaMatch[1]) : null;

  let rsiColor = '#64748b';
  let rsiLabel = 'Neutral';
  if (rsi !== null) {
    if (rsi < 30) { rsiColor = '#4ade80'; rsiLabel = 'Oversold'; }
    else if (rsi >= 70) { rsiColor = '#f59e0b'; rsiLabel = 'Overbought'; }
  }

  const dmaAbove = dma !== null && dma >= 0;

  return (
    <div className="mb-3 px-3 py-2.5 rounded-lg"
      style={{ background: 'rgba(15,23,42,0.8)', border: '1px solid rgba(59,130,246,0.12)' }}>
      {rsi !== null && (
        <div className="mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-mono" style={{ color: '#7dd3fc' }}>RSI</span>
            <span className="text-xs font-mono font-semibold" style={{ color: rsiColor }}>{Math.round(rsi)} · {rsiLabel}</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(100,116,139,0.25)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(100, Math.max(0, rsi))}%`, background: rsiColor }} />
          </div>
        </div>
      )}
      {dma !== null && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-mono" style={{ color: '#7dd3fc' }}>200D</span>
          <span className="text-xs font-mono font-semibold" style={{ color: dmaAbove ? '#4ade80' : '#f87171' }}>
            {dmaAbove ? '↑' : '↓'} {dma > 0 ? '+' : ''}{dma.toFixed(1)}%
          </span>
          <span className="text-xs" style={{ color: '#475569' }}>vs 200-day MA</span>
        </div>
      )}
    </div>
  );
}

// ── TextBarChart — horizontal bars parsed from sector/region text ──────────────

function TextBarChart({ text, fieldName }: { text: string; fieldName: string }) {
  const entries: Array<{ label: string; value: number }> = [];
  const re = /(\w[\w\s]+?)\s+(?:at\s+)?(\d+)%/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = m[1].trim().replace(/\s+/g, ' ');
    const value = parseInt(m[2], 10);
    if (label.length > 0 && value > 0 && value <= 100) {
      entries.push({ label, value });
    }
  }

  if (entries.length === 0) {
    console.log(`[TextBarChart] parse miss: ${fieldName}`);
    return <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>{text}</p>;
  }

  const max = Math.max(...entries.map(e => e.value));

  return (
    <div className="space-y-1.5">
      {entries.map((e, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-xs w-24 shrink-0 truncate" style={{ color: '#94a3b8' }}>{e.label}</span>
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(100,116,139,0.2)' }}>
            <div className="h-full rounded-full" style={{ width: `${(e.value / max) * 100}%`, background: '#3b82f6' }} />
          </div>
          <span className="text-xs font-mono w-8 text-right shrink-0" style={{ color: '#60a5fa' }}>{e.value}%</span>
        </div>
      ))}
    </div>
  );
}

// ── CompactDisclaimer — single-line notice with expandable popover ─────────────

function CompactDisclaimer() {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative rounded-xl px-4 py-2.5 mb-4 flex items-center gap-2"
      style={{ background: '#0f172a', border: '1px solid #1e3a5f' }}>
      <span className="text-xs" style={{ color: '#60a5fa', flexShrink: 0 }}>ⓘ</span>
      <p className="text-xs flex-1" style={{ color: '#94a3b8' }}>
        AI perspective only — not financial advice
      </p>
      <button
        onClick={() => setOpen(v => !v)}
        className="text-xs px-1.5 py-0.5 rounded opacity-60 hover:opacity-100 transition-opacity shrink-0"
        style={{ color: '#60a5fa', border: '1px solid rgba(59,130,246,0.2)' }}
        aria-label="Full disclaimer">
        ?
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 z-10 rounded-xl px-4 py-3 shadow-xl"
          style={{ top: 'calc(100% + 4px)', background: '#0f172a', border: '1px solid #1e3a5f' }}
          onClick={e => e.stopPropagation()}>
          <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
            <strong style={{ color: '#cbd5e1' }}>AI Perspective only.</strong> This briefing is generated by an AI analyst and is for informational purposes. It does not constitute financial advice. Always consult a qualified financial adviser before making investment decisions.
          </p>
          <button onClick={() => setOpen(false)} className="mt-2 text-xs underline opacity-60 hover:opacity-100" style={{ color: '#60a5fa' }}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function ProfileTrustSignal({ profile }: { profile: InvestorProfile }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const label = PROFILE_LABEL[profile] ?? profile.toLowerCase();
  return (
    <div className="flex items-center gap-2 mb-4">
      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs"
        style={{ background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)' }}>
        <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        Briefing tuned for {label} investors
        <button
          onClick={() => setShowTooltip(v => !v)}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
          aria-label="What does this mean?">
          [?]
        </button>
      </div>
      {showTooltip && (
        <div className="absolute z-10 mt-8 ml-2 max-w-xs rounded-xl px-4 py-3 text-xs leading-relaxed shadow-xl"
          style={{ background: '#1e1b4b', color: '#c7d2fe', border: '1px solid rgba(99,102,241,0.3)' }}>
          We infer your investor profile from your portfolio composition. This shapes how we frame signals — not which stocks we cover.
          <button onClick={() => setShowTooltip(false)} className="block mt-2 underline opacity-70">Close</button>
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function Home() {
  const [tab, setTab]                   = useState<'briefing' | 'top-picks' | 'picks' | 'portfolio'>('briefing');
  const [picksFilter, setPicksFilter]   = useState<'all' | 'add' | 'review'>('all');
  const [topPicksData, setTopPicksData] = useState<TopPicksData | null>(null);
  const [topPicksLoading, setTopPicksLoading] = useState(false);
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
  const [beginnerView, setBeginnerView] = useState<boolean>(true);
  const [showEmailOptIn, setShowEmailOptIn] = useState(false);

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
    setBeginnerView(loadBeginnerView());

    // Restore today's cached briefing (avoids regenerating on refresh)
    const cached = loadCachedBriefing(loaded);
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

        // Load portfolio from Supabase (also checks email_briefing_enabled for opt-in)
        let coerced: Holding[] = portfolioRef.current;
        const { data: portData } = await supabase
          .from('portfolios')
          .select('holdings, email_briefing_enabled')
          .eq('user_id', currentUser.id)
          .single();

        if (portData != null && Array.isArray(portData.holdings) && portData.holdings.length > 0) {
          // Coerce legacy holdings without market field to ASX
          coerced = portData.holdings.map((h: Partial<Holding>) => ({ ...h, market: h.market ?? 'ASX' })) as Holding[];
          setPortfolio(coerced);
        } else {
          await supabase.from('portfolios').upsert({
            user_id: currentUser.id,
            holdings: portfolioRef.current,
            updated_at: new Date().toISOString(),
          });
        }

        // NULL = never asked → show opt-in modal
        // Use strict equality: undefined (no row / query failed) must NOT trigger the modal,
        // only an explicit null in the DB column means "not yet asked".
        if (portData?.email_briefing_enabled === null) {
          setShowEmailOptIn(true);
        }

        // Load today's stored briefing from Supabase if not already loaded
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);

        const { data: briefingRow } = await supabase
          .from('briefings')
          .select('briefing_data, portfolio_snapshot')
          .eq('user_id', currentUser.id)
          .gte('created_at', todayStart.toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .single();

        if (briefingRow?.briefing_data) {
          // Only serve cached briefing if it was generated for the same portfolio.
          // If the user changed their holdings since the cron ran, discard the stale cache.
          const snapshot = briefingRow.portfolio_snapshot as Holding[] | null;
          const portfolioMatches = !snapshot || portfolioFingerprint(snapshot) === portfolioFingerprint(coerced);
          if (portfolioMatches) {
            setBriefingData(briefingRow.briefing_data as BriefingData);
            saveCachedBriefing(briefingRow.briefing_data as BriefingData, coerced);
          }
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

  // ── Persist beginner view preference ──────────────────────────────────────
  useEffect(() => {
    try { localStorage.setItem(BEGINNER_VIEW_KEY, String(beginnerView)); } catch {}
  }, [beginnerView]);

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

  // ── Fetch top picks when user is signed in ────────────────────────────────
  useEffect(() => {
    if (!accessToken || topPicksData) return;
    setTopPicksLoading(true);
    fetch('/api/top-picks', { headers: { 'x-access-token': accessToken } })
      .then(r => r.json())
      .then((json: { picks: TopPicksData | null; generated_at?: string }) => {
        if (json.picks) setTopPicksData(json.picks as TopPicksData);
      })
      .catch(() => {})
      .finally(() => setTopPicksLoading(false));
  }, [accessToken]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function saveEmailPreference(enabled: boolean) {
    setShowEmailOptIn(false);
    const currentUser = userRef.current;
    if (!currentUser || !isSupabaseConfigured) return;
    await supabase.from('portfolios').update({
      email_briefing_enabled: enabled,
      updated_at: new Date().toISOString(),
    }).eq('user_id', currentUser.id);
  }

  async function signOut() {
    // Clear local state immediately — do not wait for the API call.
    // This gives instant visual feedback and prevents the modal from
    // blocking the header if showEmailOptIn was true.
    setUser(null);
    setAccessToken('');
    setPortfolio(DEFAULT_PORTFOLIO);
    setBriefingData(null);
    setShowEmailOptIn(false);
    setSignalCount(null);
    setTopPicksData(null);
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(BRIEFING_KEY);
    // Invalidate server-side session in the background
    supabase.auth.signOut().catch(() => {});
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
    let investorProfile: InvestorProfile | undefined;

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
              | { type: 'done'; generated_at: string; news_sourced: boolean; from_cache: boolean; signal_count?: number; investor_profile?: InvestorProfile }
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
              investorProfile = event.investor_profile;
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
        investor_profile: investorProfile,
      };

      setBriefingData(briefing);
      setStreamingStocks([]);
      setProgressMessage('');
      saveCachedBriefing(briefing, portfolio);

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

      {/* ── Sticky glass header ── */}
      <header className="sticky top-0 z-40 w-full"
        style={{ background: 'rgba(5,10,20,0.88)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)', borderBottom: '1px solid var(--border)' }}>
        <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">

          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' }}>
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
                <polyline points="16 7 22 7 22 13"/>
              </svg>
            </div>
            <span className="font-semibold text-sm tracking-tight" style={{ color: 'var(--text-primary)' }}>
              Portfolio Briefing
            </span>
          </div>

          {/* Auth button */}
          {isSupabaseConfigured && !authLoading && (
            <div className="flex items-center gap-2">
              {user ? (
                <>
                  <span className="text-xs hidden sm:block" style={{ color: 'var(--text-muted)' }}>
                    {user.email?.split('@')[0]}
                  </span>
                  <button
                    onClick={signOut}
                    className="text-xs px-3 py-1.5 rounded-lg"
                    style={{ background: 'var(--bg-card)', color: 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>
                    Sign out
                  </button>
                </>
              ) : (
                <button
                  onClick={signIn}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium flex items-center gap-1.5"
                  style={{ background: 'var(--bg-card)', color: 'var(--text-primary)', border: '1px solid var(--border-strong)', cursor: 'pointer' }}>
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
      </header>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {/* Date context */}
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>{today}</p>

        {/* ── Tabs ── */}
        <div className="flex items-center gap-1 p-1 rounded-xl mb-6"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>

          {/* Advisory tab — Today's Picks */}
          <button
            onClick={() => setTab('top-picks')}
            className="flex-none py-2 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1"
            style={tab === 'top-picks'
              ? { background: 'var(--accent)', color: '#fff' }
              : { color: 'var(--text-muted)', cursor: 'pointer' }}>
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
            </svg>
            Today&apos;s Picks
          </button>

          {/* Separator */}
          <div className="self-stretch w-px mx-1" style={{ background: 'var(--border)' }} />

          {/* Personal tabs group */}
          <div className="flex flex-col flex-1 min-w-0">
            <span className="text-center mb-0.5 tracking-widest uppercase font-medium"
              style={{ fontSize: '9px', color: 'var(--text-muted)', opacity: 0.6 }}>
              Your Portfolio
            </span>
            <div className="flex gap-1">
              {([
                { key: 'briefing',  label: 'Briefing',  icon: <><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></> },
                { key: 'picks',     label: 'Picks',     icon: <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/> },
                { key: 'portfolio', label: 'Portfolio', icon: <><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></> },
              ] as const).map(({ key, label, icon }) => (
                <button
                  key={key}
                  onClick={() => setTab(key)}
                  className="flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1"
                  style={tab === key
                    ? { background: 'var(--accent)', color: '#fff' }
                    : { color: 'var(--text-muted)', cursor: 'pointer' }}>
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    {icon}
                  </svg>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── BRIEFING TAB ── */}
        {tab === 'briefing' && (
          <div className="animate-fade-in">

            {/* Generate / regenerate button — or sign-in gate with hero */}
            {isSupabaseConfigured && !user && !authLoading ? (
              <div className="animate-fade-in">
                {/* Hero */}
                <div className="text-center mb-8 pt-4">
                  {/* Eyebrow */}
                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs mb-5"
                    style={{ background: 'rgba(59,130,246,0.08)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.18)' }}>
                    <span className="w-1.5 h-1.5 rounded-full inline-block flex-shrink-0" style={{ background: '#3b82f6' }} />
                    AI-powered · ASX &amp; US markets
                  </div>
                  {/* Headline */}
                  <h2 className="text-2xl sm:text-3xl font-bold mb-3 leading-tight tracking-tight" style={{ color: 'var(--text-primary)' }}>
                    Stop researching every holding<br/>
                    <span style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #818cf8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
                      before market open.
                    </span>
                  </h2>
                  {/* Subtext */}
                  <p className="text-sm mb-5 max-w-sm mx-auto leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                    ADD/HOLD/TRIM/EXIT signals with technical analysis and live news — delivered daily.
                  </p>
                  {/* Feature chips */}
                  <div className="flex flex-wrap justify-center gap-2 mb-7">
                    {['Technical analysis', 'Live news', 'ASX + US stocks', '~60s to generate'].map(f => (
                      <span key={f} className="text-xs px-2.5 py-1 rounded-full"
                        style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        {f}
                      </span>
                    ))}
                  </div>
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
                  className="w-full py-3.5 rounded-xl text-sm font-semibold mb-3 transition-all flex items-center justify-center gap-2"
                  style={{ background: '#f0f6fc', color: '#050a14', cursor: 'pointer', fontWeight: 600 }}>
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
                  style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-muted)', cursor: 'not-allowed', border: '1px solid var(--border)' }}>
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
                  background: briefingLoading ? 'rgba(255,255,255,0.04)' : 'var(--accent)',
                  color: briefingLoading ? 'var(--text-muted)' : '#fff',
                  cursor: briefingLoading ? 'not-allowed' : 'pointer',
                  border: briefingLoading ? '1px solid var(--border)' : 'none',
                  boxShadow: briefingLoading ? 'none' : '0 0 24px rgba(59,130,246,0.28)',
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
                  <StockCard key={stock.ticker} stock={stock} price={prices[stock.ticker]} market={marketMap[stock.ticker] ?? 'ASX'} beginnerView={beginnerView} />
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
                      <span className="ml-2 px-1.5 py-0.5 rounded text-xs font-medium"
                        style={{ background: 'rgba(34,197,94,0.1)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.2)' }}>
                        live news
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

                {/* ── Investor profile trust signal ── */}
                {briefingData.investor_profile && briefingData.investor_profile !== 'BALANCED' && (
                  <ProfileTrustSignal profile={briefingData.investor_profile} />
                )}

                {/* ── Disclaimer banner ── */}
                <CompactDisclaimer />

                {/* ── Executive Summary ── */}
                {briefingData.overview.executive_summary && (
                  <div className="rounded-xl p-4 mb-4"
                    style={{ background: '#0f0f23', border: '1px solid #312e81' }}>
                    <p className="text-xs font-semibold tracking-wider mb-2"
                      style={{ color: '#818cf8' }}>
                      AI PERSPECTIVE — THIS WEEK
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: '#e0e7ff' }}>
                      {briefingData.overview.executive_summary}
                    </p>
                  </div>
                )}

                {/* ── Priority Actions (only shown when non-empty) ── */}
                {briefingData.overview.priority_actions?.length > 0 && (
                  <div className="rounded-xl p-4 mb-4"
                    style={{ background: 'rgba(28,10,0,0.7)', border: '1px solid rgba(124,45,18,0.5)' }}>
                    <div className="flex items-center gap-2 mb-3">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="#fb923c" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
                      </svg>
                      <p className="text-xs font-semibold tracking-wider" style={{ color: '#fb923c' }}>
                        PRIORITY ACTIONS
                      </p>
                    </div>
                    <div className="space-y-2.5">
                      {briefingData.overview.priority_actions.map((action, i) => (
                        <div key={i} className="flex items-start gap-3">
                          <span className="text-xs font-bold flex-shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5"
                            style={{ background: 'rgba(251,146,60,0.15)', color: '#fb923c', fontSize: '10px' }}>
                            {i + 1}
                          </span>
                          <p className="text-sm leading-relaxed" style={{ color: '#fed7aa' }}>{action}</p>
                        </div>
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
                      THIS WEEK'S WATCH LIST
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

                {/* ── Signal Summary Bar ── */}
                {(() => {
                  const counts = briefingData.stocks.reduce((acc, s) => {
                    acc[s.signal] = (acc[s.signal] ?? 0) + 1;
                    return acc;
                  }, {} as Record<string, number>);
                  const items = [
                    { signal: 'ADD',  label: 'Add',  color: '#4ade80', bg: 'rgba(34,197,94,0.08)'  },
                    { signal: 'HOLD', label: 'Hold', color: '#94a3b8', bg: 'rgba(148,163,184,0.06)' },
                    { signal: 'TRIM', label: 'Trim', color: '#fb923c', bg: 'rgba(251,146,60,0.08)' },
                    { signal: 'EXIT', label: 'Exit', color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
                  ].filter(i => (counts[i.signal] ?? 0) > 0);
                  if (!items.length) return null;
                  return (
                    <div className="flex items-center gap-2 mb-4 flex-wrap">
                      {items.map(({ signal, label, color, bg }) => (
                        <div key={signal} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: bg, color, border: `1px solid ${color}22` }}>
                          <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: color }} />
                          {counts[signal]} {label}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* ── Stock Signal Cards header + view toggle ── */}
                <div className="flex items-center justify-between mb-3">
                  <p className="text-xs font-medium tracking-wider" style={{ color: 'var(--text-muted)' }}>
                    PER HOLDING
                  </p>
                  <button
                    onClick={() => setBeginnerView(v => !v)}
                    className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg transition-colors"
                    style={{ background: beginnerView ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.04)', color: beginnerView ? '#60a5fa' : 'var(--text-muted)', border: `1px solid ${beginnerView ? 'rgba(59,130,246,0.2)' : 'var(--border)'}`, cursor: 'pointer' }}>
                    <svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      {beginnerView
                        ? <><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></>
                        : <><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></>
                      }
                    </svg>
                    {beginnerView ? 'Full analysis' : 'Simple view'}
                  </button>
                </div>
                {briefingData.stocks.map(stock => (
                  <StockCard key={stock.ticker} stock={stock} price={prices[stock.ticker]} market={marketMap[stock.ticker] ?? 'ASX'} beginnerView={beginnerView} />
                ))}

                {/* ── Portfolio Overview ── */}
                <div className="rounded-xl overflow-hidden mt-1"
                  style={{ border: '1px solid var(--border)' }}>
                  <div className="px-4 py-3"
                    style={{ background: 'rgba(59,130,246,0.05)', borderBottom: '1px solid var(--border)' }}>
                    <p className="text-xs font-semibold tracking-wider" style={{ color: '#60a5fa' }}>
                      PORTFOLIO OVERVIEW
                    </p>
                  </div>
                  <div style={{ background: 'var(--bg-card)' }}>
                    {[
                      { key: 'sector_breakdown', label: 'Sectors',  visual: true  },
                      { key: 'region_exposure',   label: 'Regions',  visual: true  },
                      { key: 'risk_profile',      label: 'Risk',     visual: false },
                      { key: 'macro_note',        label: 'Macro',    visual: false },
                    ].map(({ key, label, visual }, idx, arr) => {
                      const value = briefingData.overview[key as keyof typeof briefingData.overview] as string;
                      return (
                        <div key={key} className="px-4 py-3"
                          style={{ borderBottom: idx < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
                          <p className="text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                            {label}
                          </p>
                          {visual ? (
                            <TextBarChart text={value} fieldName={key} />
                          ) : (
                            <p className="text-sm leading-relaxed" style={{ color: '#cbd5e1' }}>
                              {value}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ) : !briefingLoading && (
              <div className="rounded-xl p-10 text-center"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%)' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                  Your morning briefing is ready to generate.
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Searches for current news · generates an AI perspective on each holding · takes ~60s
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── TOP PICKS TAB ── */}
        {tab === 'top-picks' && (
          <div className="animate-fade-in">

            {/* Not signed in — blurred preview + sign-in overlay */}
            {!user && !authLoading ? (
              <div className="relative">
                <div style={{ filter: 'blur(5px)', pointerEvents: 'none', userSelect: 'none' }}>
                  {PLACEHOLDER_PICKS.map((p, i) => (
                    <PlaceholderPickCard key={i} pick={p} />
                  ))}
                </div>
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
                  <div className="rounded-2xl p-6 text-center w-full max-w-xs"
                    style={{ background: 'rgba(5,10,20,0.92)', border: '1px solid var(--border)', backdropFilter: 'blur(12px)' }}>
                    <div className="w-10 h-10 rounded-xl mx-auto mb-3 flex items-center justify-center"
                      style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)' }}>
                      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
                      </svg>
                    </div>
                    <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                      Sign in to view Top Picks
                    </p>
                    <p className="text-xs mb-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                      Daily advisory recommendations from our AI analyst — 5 high-conviction picks across key categories.
                    </p>
                    <button
                      onClick={signIn}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                      style={{ background: '#f0f6fc', color: '#050a14', cursor: 'pointer', fontWeight: 600 }}>
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      Sign in with Google
                    </button>
                  </div>
                </div>
              </div>
            ) : topPicksLoading ? (
              /* Loading state */
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <svg className="animate-spin w-6 h-6" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.3"/>
                  <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
                </svg>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading today&apos;s picks…</p>
              </div>
            ) : !topPicksData ? (
              /* No picks yet — cron hasn't run */
              <div className="rounded-xl p-10 text-center"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #7c3aed 0%, #4f46e5 100%)' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                  Today&apos;s picks aren&apos;t ready yet.
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  The advisory runs each weekday morning at 7am AEST. Check back then.
                </p>
              </div>
            ) : (
              /* Picks available */
              <>
                {/* Header */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-semibold tracking-wider" style={{ color: 'var(--text-muted)' }}>
                      TODAY&apos;S PICK — ASX &amp; NASDAQ
                    </p>
                    <span className="text-xs px-2 py-0.5 rounded"
                      style={{ background: 'rgba(139,92,246,0.1)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.2)' }}>
                      {new Date(topPicksData.generated_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit' })} AEST
                    </span>
                  </div>
                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    One AI advisory pick per category per market — refreshed daily. Not financial advice.
                  </p>
                </div>

                {/* Market overview */}
                {topPicksData.market_overview && (
                  <div className="rounded-xl p-4 mb-5"
                    style={{ background: '#0f0f23', border: '1px solid #312e81' }}>
                    <p className="text-xs font-semibold tracking-wider mb-2" style={{ color: '#818cf8' }}>
                      MARKET REGIME
                    </p>
                    <p className="text-sm leading-relaxed" style={{ color: '#e0e7ff' }}>
                      {topPicksData.market_overview}
                    </p>
                  </div>
                )}

                {/* ── ASX Picks ── */}
                {(() => {
                  const asxPicks = topPicksData.picks.filter(p => p.market === 'ASX');
                  return asxPicks.length > 0 ? (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                        <span className="text-xs font-bold tracking-widest px-2 py-0.5 rounded"
                          style={{ background: '#052e16', color: '#4ade80', border: '1px solid #166534' }}>
                          ASX
                        </span>
                        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                      </div>
                      {asxPicks.map(pick => (
                        <TopPicksCard key={`asx-${pick.ticker}`} pick={pick} />
                      ))}
                    </div>
                  ) : null;
                })()}

                {/* ── NASDAQ Picks ── */}
                {(() => {
                  const nasdaqPicks = topPicksData.picks.filter(p => p.market === 'NASDAQ');
                  return nasdaqPicks.length > 0 ? (
                    <div className="mb-2">
                      <div className="flex items-center gap-2 mb-3">
                        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                        <span className="text-xs font-bold tracking-widest px-2 py-0.5 rounded"
                          style={{ background: '#0c1a2e', color: '#60a5fa', border: '1px solid #1e3a5f' }}>
                          NASDAQ
                        </span>
                        <div className="h-px flex-1" style={{ background: 'var(--border)' }} />
                      </div>
                      {nasdaqPicks.map(pick => (
                        <TopPicksCard key={`nasdaq-${pick.ticker}`} pick={pick} />
                      ))}
                    </div>
                  ) : null;
                })()}

                {/* Disclaimer */}
                <div className="rounded-xl px-4 py-3 mt-2 flex items-start gap-2"
                  style={{ background: '#0f172a', border: '1px solid #1e3a5f' }}>
                  <span className="text-xs mt-0.5 flex-shrink-0" style={{ color: '#60a5fa' }}>ℹ</span>
                  <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                    <strong style={{ color: '#cbd5e1' }}>AI Perspective only.</strong> These picks are generated by an AI advisory and are for informational purposes only. They do not constitute financial advice. Always consult a qualified financial adviser before investing.
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── PICKS TAB ── */}
        {tab === 'picks' && (
          <div className="animate-fade-in">
            {!briefingData ? (
              <div className="rounded-xl p-10 text-center"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                  style={{ background: 'linear-gradient(135deg, #22c55e 0%, #15803d 100%)' }}>
                  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                  </svg>
                </div>
                <p className="text-sm font-semibold mb-1.5" style={{ color: 'var(--text-primary)' }}>
                  No picks yet.
                </p>
                <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                  Generate your briefing to see actionable ADD and TRIM/EXIT signals surfaced here.
                </p>
                <button
                  onClick={() => setTab('briefing')}
                  className="text-sm px-4 py-2 rounded-lg font-medium"
                  style={{ background: 'var(--accent)', color: '#fff', border: 'none', cursor: 'pointer' }}>
                  Go to Briefing
                </button>
              </div>
            ) : (() => {
              const actionable = briefingData.stocks.filter(s => s.signal !== 'HOLD');
              const sorted = sortByActionPriority(actionable);
              const addCount = actionable.filter(s => s.signal === 'ADD').length;
              const reviewCount = actionable.filter(s => s.signal === 'TRIM' || s.signal === 'EXIT').length;
              const filtered = picksFilter === 'add'
                ? sorted.filter(s => s.signal === 'ADD')
                : picksFilter === 'review'
                ? sorted.filter(s => s.signal === 'TRIM' || s.signal === 'EXIT')
                : sorted;

              return (
                <>
                  {/* Header */}
                  <div className="mb-4">
                    <p className="text-xs font-semibold tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                      ACTIONABLE SIGNALS
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      ADD and TRIM/EXIT signals from today&apos;s briefing, ranked by confidence.
                    </p>
                  </div>

                  {/* Signal summary chips */}
                  <div className="flex items-center gap-2 mb-4 flex-wrap">
                    {addCount > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(34,197,94,0.08)', color: '#4ade80', border: '1px solid rgba(34,197,94,0.22)' }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#22c55e' }} />
                        {addCount} Accumulate
                      </div>
                    )}
                    {reviewCount > 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(251,146,60,0.08)', color: '#fb923c', border: '1px solid rgba(251,146,60,0.22)' }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#fb923c' }} />
                        {reviewCount} Review
                      </div>
                    )}
                    {actionable.length === 0 && (
                      <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold"
                        style={{ background: 'rgba(148,163,184,0.06)', color: '#94a3b8', border: '1px solid rgba(148,163,184,0.18)' }}>
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#64748b' }} />
                        No actionable signals
                      </div>
                    )}
                  </div>

                  {/* Filter bar */}
                  {actionable.length > 0 && (
                    <div className="flex gap-1 p-1 rounded-xl mb-4"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      {([
                        { key: 'all',    label: 'All picks' },
                        { key: 'add',    label: `Accumulate${addCount ? ` (${addCount})` : ''}` },
                        { key: 'review', label: `Review${reviewCount ? ` (${reviewCount})` : ''}` },
                      ] as const).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setPicksFilter(key)}
                          className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-all"
                          style={picksFilter === key
                            ? { background: 'var(--accent)', color: '#fff' }
                            : { color: 'var(--text-muted)', cursor: 'pointer' }}>
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Cards */}
                  {filtered.length > 0 ? (
                    filtered.map(stock => (
                      <PicksCard
                        key={stock.ticker}
                        stock={stock}
                        price={prices[stock.ticker]}
                        market={marketMap[stock.ticker] ?? 'ASX'}
                      />
                    ))
                  ) : actionable.length > 0 ? (
                    <div className="rounded-xl p-8 text-center"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
                        No signals in this filter.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-xl p-10 text-center"
                      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                      <div className="text-3xl mb-3">✓</div>
                      <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                        Portfolio looks stable.
                      </p>
                      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        No ADD, TRIM, or EXIT signals today — all holdings are Monitor (Hold).
                      </p>
                    </div>
                  )}

                  {/* Disclaimer */}
                  <div className="rounded-xl px-4 py-3 mt-4 flex items-start gap-2"
                    style={{ background: '#0f172a', border: '1px solid #1e3a5f' }}>
                    <span className="text-xs mt-0.5 flex-shrink-0" style={{ color: '#60a5fa' }}>ℹ</span>
                    <p className="text-xs leading-relaxed" style={{ color: '#94a3b8' }}>
                      <strong style={{ color: '#cbd5e1' }}>AI Perspective only.</strong> Not financial advice. Consult a qualified adviser before acting on any signal.
                    </p>
                  </div>
                </>
              );
            })()}
          </div>
        )}

        {/* ── PORTFOLIO TAB ── */}
        {tab === 'portfolio' && (
          <div className="animate-fade-in">
            <div className="rounded-xl overflow-hidden mb-4"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              {/* Header */}
              <div className="grid px-4 py-2.5 text-xs font-medium tracking-wider"
                style={{ gridTemplateColumns: '1fr 96px 64px 32px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'rgba(255,255,255,0.02)' }}>
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
                    style={{ gridTemplateColumns: '1fr 96px 64px 32px', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>

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
                        className="text-xs font-mono cursor-pointer px-2 py-0.5 rounded-md inline-block font-medium"
                        style={{ ...(MARKET_STYLE[h.market] ?? MARKET_STYLE.ASX) }}
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
                <div className="flex items-center justify-between px-4 py-2.5"
                  style={{ borderTop: '1px solid var(--border)', background: 'rgba(255,255,255,0.01)' }}>
                  <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>
                      {portfolio.filter(h => h.ticker !== '').length} holdings
                    </span>
                    <span style={{ color: 'var(--border-strong)' }}>·</span>
                    <span>{totalUnits.toLocaleString()} units</span>
                  </div>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Tap to edit</span>
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

      {/* ── Email opt-in modal ── */}
      {showEmailOptIn && (
        <div className="fixed inset-0 z-50 flex items-end justify-center pb-6 px-4"
          style={{ background: 'rgba(0,0,0,0.7)' }}
          onClick={(e) => { if (e.target === e.currentTarget) setShowEmailOptIn(false); }}>
          <div className="w-full max-w-sm rounded-2xl p-6"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
              Get your briefing by email
            </p>
            <p className="text-sm mb-4 leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Receive today's AI perspective on your portfolio every morning at 9:30am AEST — straight to your inbox.
            </p>
            <button
              onClick={() => saveEmailPreference(true)}
              className="w-full py-3 rounded-xl text-sm font-semibold mb-2"
              style={{ background: 'var(--accent)', color: '#fff', cursor: 'pointer', border: 'none' }}>
              Yes, email me my briefing
            </button>
            <button
              onClick={() => saveEmailPreference(false)}
              className="w-full py-2 text-sm"
              style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>
              No thanks
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
