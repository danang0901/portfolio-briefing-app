import {
  sortCards,
  buildSubject,
  buildFailureSubject,
  buildEmailHtml,
  buildFailureEmailHtml,
} from '../lib/email-template';
import type { StockSignal, BriefingOverview } from '../app/api/briefing/route';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeStock(overrides: Partial<StockSignal>): StockSignal {
  return {
    ticker: 'BHP',
    signal: 'HOLD',
    confidence: 'High',
    thesis_status: 'intact',
    sector: 'Materials',
    country: 'Australia',
    catalyst: 'No material events this week.',
    upcoming_catalyst: 'Q2 results next month',
    what_to_watch: 'China PMI Wednesday',
    risk_change: 'unchanged',
    ...overrides,
  };
}

const OVERVIEW: BriefingOverview = {
  executive_summary: 'Broad market stable. BHP holding thesis.',
  watch_list: ['China PMI Wednesday'],
  priority_actions: [],
  sector_breakdown: 'Materials heavy',
  region_exposure: 'Australia 80%, US 20%',
  risk_profile: 'Moderate',
  macro_note: 'RBA on hold.',
};

const APP_URL = 'https://portfoliobriefing.com.au';

// ── sortCards ─────────────────────────────────────────────────────────────────

describe('sortCards', () => {
  it('orders ADD before TRIM before HOLD before EXIT', () => {
    const stocks = [
      makeStock({ ticker: 'HOLD1', signal: 'HOLD' }),
      makeStock({ ticker: 'EXIT1', signal: 'EXIT' }),
      makeStock({ ticker: 'TRIM1', signal: 'TRIM' }),
      makeStock({ ticker: 'ADD1',  signal: 'ADD'  }),
    ];
    const sorted = sortCards(stocks);
    expect(sorted.map(s => s.signal)).toEqual(['ADD', 'TRIM', 'HOLD', 'EXIT']);
  });

  it('preserves relative order within the same signal tier', () => {
    const stocks = [
      makeStock({ ticker: 'HOLD2', signal: 'HOLD' }),
      makeStock({ ticker: 'HOLD1', signal: 'HOLD' }),
    ];
    const sorted = sortCards(stocks);
    expect(sorted[0].ticker).toBe('HOLD2');
    expect(sorted[1].ticker).toBe('HOLD1');
  });

  it('does not mutate the original array', () => {
    const stocks = [makeStock({ signal: 'HOLD' }), makeStock({ signal: 'ADD' })];
    const original = [...stocks];
    sortCards(stocks);
    expect(stocks[0].signal).toBe(original[0].signal);
  });
});

// ── buildSubject ──────────────────────────────────────────────────────────────

describe('buildSubject', () => {
  const monday = new Date('2026-04-06T21:00:00Z'); // Mon 6 Apr AEST

  it('includes ADD tickers in subject', () => {
    const stocks = [makeStock({ ticker: 'AAPL', signal: 'ADD', country: 'United States' })];
    expect(buildSubject(stocks, monday)).toContain('ADD: AAPL');
  });

  it('includes TRIM tickers in subject', () => {
    const stocks = [makeStock({ ticker: 'BHP', signal: 'TRIM' })];
    expect(buildSubject(stocks, monday)).toContain('TRIM: BHP');
  });

  it('says "All holds" when no ADD or TRIM signals', () => {
    const stocks = [makeStock({ signal: 'HOLD' })];
    expect(buildSubject(stocks, monday)).toContain('All holds');
  });

  it('lists multiple ADD signals separated by comma', () => {
    const stocks = [
      makeStock({ ticker: 'AAPL', signal: 'ADD', country: 'United States' }),
      makeStock({ ticker: 'MSFT', signal: 'ADD', country: 'United States' }),
    ];
    const subject = buildSubject(stocks, monday);
    expect(subject).toContain('ADD: AAPL');
    expect(subject).toContain('ADD: MSFT');
  });

  it('includes the date in the subject', () => {
    const subject = buildSubject([], monday);
    // Should contain something like "Mon" or "6" or "Apr"
    expect(subject).toMatch(/Mon|6|Apr/);
  });
});

// ── buildFailureSubject ───────────────────────────────────────────────────────

describe('buildFailureSubject', () => {
  it('contains "Generation issue"', () => {
    expect(buildFailureSubject(new Date())).toContain('Generation issue');
  });
});

// ── buildEmailHtml ────────────────────────────────────────────────────────────

describe('buildEmailHtml', () => {
  const stocks = [
    makeStock({ ticker: 'AAPL', signal: 'ADD', country: 'United States' }),
    makeStock({ ticker: 'BHP',  signal: 'HOLD' }),
  ];

  const html = buildEmailHtml(stocks, OVERVIEW, new Date().toISOString(), APP_URL);

  it('contains no class= attributes (Gmail strips class-based CSS)', () => {
    expect(html).not.toMatch(/class="/);
  });

  it('contains no <style> block (Gmail strips style blocks)', () => {
    expect(html).not.toContain('<style>');
    expect(html).not.toContain('<style ');
  });

  it('places the ADD card before the HOLD card', () => {
    const addPos  = html.indexOf('AAPL');
    const holdPos = html.indexOf('BHP');
    expect(addPos).toBeLessThan(holdPos);
  });

  it('renders ADD signal badge for ADD stock', () => {
    // Signal badge text present
    expect(html).toContain('>ADD<');
  });

  it('renders the Watch row for each card', () => {
    expect(html).toContain('China PMI Wednesday');
  });

  it('uses APP_URL for the CTA link', () => {
    expect(html).toContain(`href="${APP_URL}"`);
  });

  it('escapes HTML entities in user content', () => {
    const xssStock = makeStock({ catalyst: '<script>alert(1)</script>' });
    const xssHtml  = buildEmailHtml([xssStock], OVERVIEW, new Date().toISOString(), APP_URL);
    expect(xssHtml).not.toContain('<script>');
    expect(xssHtml).toContain('&lt;script&gt;');
  });

  it('appends ta_context to catalyst when present', () => {
    const stockWithTA = makeStock({ catalyst: 'Iron ore down.', ta_context: 'RSI 42 — oversold.' });
    const taHtml = buildEmailHtml([stockWithTA], OVERVIEW, new Date().toISOString(), APP_URL);
    expect(taHtml).toContain('Iron ore down. RSI 42');
  });

  it('renders market tag from country field', () => {
    expect(html).toContain('ASX');  // BHP is Australia
    expect(html).toContain('US');   // AAPL is United States
  });
});

// ── buildFailureEmailHtml ─────────────────────────────────────────────────────

describe('buildFailureEmailHtml', () => {
  const html = buildFailureEmailHtml(APP_URL);

  it('contains "couldn\'t be generated" or equivalent language', () => {
    expect(html).toMatch(/couldn't be generated|couldn.t be generated/i);
  });

  it('contains no class= attributes', () => {
    expect(html).not.toMatch(/class="/);
  });

  it('contains no <style> block', () => {
    expect(html).not.toContain('<style>');
  });

  it('uses APP_URL for the CTA link', () => {
    expect(html).toContain(`href="${APP_URL}"`);
  });
});
