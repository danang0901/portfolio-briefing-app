import { toYahooSymbol } from '../lib/yahoo-symbol';

describe('toYahooSymbol', () => {
  it('appends .AX suffix for ASX tickers', () => {
    expect(toYahooSymbol('BHP', 'ASX')).toBe('BHP.AX');
    expect(toYahooSymbol('CBA', 'ASX')).toBe('CBA.AX');
    expect(toYahooSymbol('VGS', 'ASX')).toBe('VGS.AX');
  });

  it('returns bare ticker for NASDAQ', () => {
    expect(toYahooSymbol('AAPL', 'NASDAQ')).toBe('AAPL');
    expect(toYahooSymbol('TSLA', 'NASDAQ')).toBe('TSLA');
  });

  it('returns bare ticker for NYSE', () => {
    expect(toYahooSymbol('JNJ', 'NYSE')).toBe('JNJ');
    expect(toYahooSymbol('BRK', 'NYSE')).toBe('BRK');
  });

  it('falls through to bare ticker for unknown markets', () => {
    expect(toYahooSymbol('SHELL', 'LSE')).toBe('SHELL');
  });
});
