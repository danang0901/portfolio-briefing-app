export function toYahooSymbol(ticker: string, market: string): string {
  switch (market) {
    case 'ASX':    return `${ticker}.AX`;
    case 'NASDAQ':
    case 'NYSE':
    default:       return ticker;
  }
}
