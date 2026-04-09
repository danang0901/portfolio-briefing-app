// ── Top Picks — curated stock universe + category definitions ─────────────────
//
// REVIEW MONTHLY: add newly relevant stocks, remove delisted/illiquid.
// Last reviewed: April 2026.
//
// To update: edit STOCK_UNIVERSE below. No other changes needed.

export type PickCategory =
  | 'HIGHEST CONVICTION'
  | 'INCOME & YIELD'
  | 'GROWTH CATALYST'
  | 'DEFENSIVE ANCHOR'
  | 'SPECULATIVE EDGE';

export const PICK_CATEGORIES: PickCategory[] = [
  'HIGHEST CONVICTION',
  'INCOME & YIELD',
  'GROWTH CATALYST',
  'DEFENSIVE ANCHOR',
  'SPECULATIVE EDGE',
];

export const CATEGORY_DESCRIPTIONS: Record<PickCategory, string> = {
  'HIGHEST CONVICTION': 'The single strongest risk/reward opportunity in the universe right now — highest conviction across all signals.',
  'INCOME & YIELD':     'Best dividend or income-generating play for the next 6–12 months — yield, stability, and franking where applicable.',
  'GROWTH CATALYST':    'Highest near-term growth potential driven by a specific, identifiable catalyst — earnings, product cycle, or sector rotation.',
  'DEFENSIVE ANCHOR':   'Best capital preservation play for uncertain or volatile market conditions — low beta, strong balance sheet, pricing power.',
  'SPECULATIVE EDGE':   'An asymmetric risk/reward bet — elevated risk but materially higher potential upside than the broader market.',
};

export type PoolStock = {
  ticker: string;
  market: 'ASX' | 'NASDAQ' | 'NYSE';
  name: string;
};

export const STOCK_UNIVERSE: PoolStock[] = [
  // ── ASX Large-caps ────────────────────────────────────────────────────────
  { ticker: 'BHP',  market: 'ASX', name: 'BHP Group — diversified miner' },
  { ticker: 'CBA',  market: 'ASX', name: 'Commonwealth Bank — big four bank' },
  { ticker: 'ANZ',  market: 'ASX', name: 'ANZ Banking Group — big four bank' },
  { ticker: 'NAB',  market: 'ASX', name: 'National Australia Bank — big four bank' },
  { ticker: 'WBC',  market: 'ASX', name: 'Westpac Banking Corp — big four bank' },
  { ticker: 'CSL',  market: 'ASX', name: 'CSL Limited — global biotech/plasma' },
  { ticker: 'WES',  market: 'ASX', name: 'Wesfarmers — diversified retail/industrial' },
  { ticker: 'WOW',  market: 'ASX', name: 'Woolworths Group — supermarkets' },
  { ticker: 'FMG',  market: 'ASX', name: 'Fortescue Ltd — iron ore miner' },
  { ticker: 'RIO',  market: 'ASX', name: 'Rio Tinto — diversified miner' },
  { ticker: 'MQG',  market: 'ASX', name: 'Macquarie Group — investment bank/asset manager' },
  { ticker: 'GMG',  market: 'ASX', name: 'Goodman Group — industrial REIT/logistics' },
  { ticker: 'REA',  market: 'ASX', name: 'REA Group — property classifieds' },
  { ticker: 'TLS',  market: 'ASX', name: 'Telstra Group — telco' },
  { ticker: 'ORG',  market: 'ASX', name: 'Origin Energy — energy/LNG' },
  { ticker: 'PLS',  market: 'ASX', name: 'Pilbara Minerals — lithium miner' },
  { ticker: 'NST',  market: 'ASX', name: 'Northern Star Resources — gold miner' },
  { ticker: 'SHL',  market: 'ASX', name: 'Sonic Healthcare — medical diagnostics' },
  { ticker: 'TCL',  market: 'ASX', name: 'Transurban Group — toll roads' },
  { ticker: 'ALX',  market: 'ASX', name: 'Atlas Arteria — toll roads/infrastructure' },
  // ASX ETFs
  { ticker: 'VAS',  market: 'ASX', name: 'Vanguard Australian Shares ETF' },
  { ticker: 'VGS',  market: 'ASX', name: 'Vanguard International Shares ETF' },
  { ticker: 'NDQ',  market: 'ASX', name: 'BetaShares NASDAQ 100 ETF' },
  { ticker: 'GOLD', market: 'ASX', name: 'BetaShares Gold Bullion ETF (AUD hedged)' },

  // ── US Large-caps ─────────────────────────────────────────────────────────
  { ticker: 'AAPL',  market: 'NASDAQ', name: 'Apple Inc. — consumer tech/services' },
  { ticker: 'MSFT',  market: 'NASDAQ', name: 'Microsoft Corp. — cloud/enterprise software' },
  { ticker: 'NVDA',  market: 'NASDAQ', name: 'NVIDIA Corp. — AI chips/data centre' },
  { ticker: 'GOOGL', market: 'NASDAQ', name: 'Alphabet Inc. — search/cloud/AI' },
  { ticker: 'AMZN',  market: 'NASDAQ', name: 'Amazon.com Inc. — e-commerce/AWS' },
  { ticker: 'META',  market: 'NASDAQ', name: 'Meta Platforms Inc. — social media/AI' },
  { ticker: 'TSLA',  market: 'NASDAQ', name: 'Tesla Inc. — EVs/energy/autonomy' },
  { ticker: 'JPM',   market: 'NYSE',   name: 'JPMorgan Chase & Co. — global bank' },
  { ticker: 'JNJ',   market: 'NYSE',   name: 'Johnson & Johnson — pharma/medtech' },
  { ticker: 'XOM',   market: 'NYSE',   name: 'Exxon Mobil Corp. — integrated oil & gas' },
  { ticker: 'V',     market: 'NYSE',   name: 'Visa Inc. — payments network' },
  { ticker: 'BRK-B', market: 'NYSE',   name: 'Berkshire Hathaway B — diversified conglomerate' },
  // US ETFs
  { ticker: 'SPY',  market: 'NYSE',   name: 'SPDR S&P 500 ETF' },
  { ticker: 'QQQ',  market: 'NASDAQ', name: 'Invesco QQQ Trust — NASDAQ 100' },
  { ticker: 'GLD',  market: 'NYSE',   name: 'SPDR Gold Shares ETF' },
];

export type TopPick = {
  category: PickCategory;
  ticker: string;
  market: 'ASX' | 'NASDAQ' | 'NYSE';
  signal: 'ADD' | 'HOLD' | 'TRIM' | 'EXIT';
  confidence: 'High' | 'Medium' | 'Low';
  time_horizon: string;
  advisory_thesis: string;
  thesis_status: 'intact' | 'developing' | 'broken';
  sector: string;
  country: string;
  catalyst: string;
  ta_context?: string;
  upcoming_catalyst: string;
  what_to_watch: string;
  risk_change: 'increased' | 'decreased' | 'unchanged';
  citations?: string[];
};

export type TopPicksData = {
  picks: TopPick[];
  market_overview: string;
  generated_at: string;
};
