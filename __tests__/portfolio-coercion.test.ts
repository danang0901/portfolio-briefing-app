// Tests the market coercion logic applied in loadPortfolio() and onAuthStateChange.
// The coercion pattern: holdings.map(h => ({ ...h, market: h.market ?? 'ASX' }))

type Holding = { ticker: string; units: number; market: 'ASX' | 'NASDAQ' | 'NYSE' };
type LegacyHolding = { ticker: string; units: number; market?: 'ASX' | 'NASDAQ' | 'NYSE' };

function coerceHoldings(holdings: LegacyHolding[]): Holding[] {
  return holdings.map(h => ({ ...h, market: h.market ?? 'ASX' })) as Holding[];
}

describe('portfolio market coercion', () => {
  it('adds market:ASX to legacy holdings without market field', () => {
    const result = coerceHoldings([{ ticker: 'BHP', units: 100 }]);
    expect(result[0].market).toBe('ASX');
  });

  it('preserves NASDAQ market on existing holdings', () => {
    const result = coerceHoldings([{ ticker: 'AAPL', units: 30, market: 'NASDAQ' }]);
    expect(result[0].market).toBe('NASDAQ');
  });

  it('preserves NYSE market on existing holdings', () => {
    const result = coerceHoldings([{ ticker: 'JNJ', units: 10, market: 'NYSE' }]);
    expect(result[0].market).toBe('NYSE');
  });

  it('preserves ASX market when explicitly set', () => {
    const result = coerceHoldings([{ ticker: 'CBA', units: 50, market: 'ASX' }]);
    expect(result[0].market).toBe('ASX');
  });

  it('handles mixed legacy and current portfolio', () => {
    const result = coerceHoldings([
      { ticker: 'BHP', units: 100 },           // legacy — no market
      { ticker: 'AAPL', units: 30, market: 'NASDAQ' },
      { ticker: 'JNJ', units: 10, market: 'NYSE' },
      { ticker: 'VGS', units: 50, market: 'ASX' },
    ]);
    expect(result[0].market).toBe('ASX');
    expect(result[1].market).toBe('NASDAQ');
    expect(result[2].market).toBe('NYSE');
    expect(result[3].market).toBe('ASX');
  });

  it('does not mutate input holdings', () => {
    const input: LegacyHolding[] = [{ ticker: 'BHP', units: 100 }];
    coerceHoldings(input);
    expect(input[0].market).toBeUndefined();
  });

  it('returns empty array for empty input', () => {
    expect(coerceHoldings([])).toEqual([]);
  });
});
