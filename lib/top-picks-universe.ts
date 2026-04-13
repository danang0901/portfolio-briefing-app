// ── Top Picks — curated stock universe + category definitions ─────────────────
//
// Markets: ASX + NASDAQ only (audience: Australian retail investors).
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
  'HIGHEST CONVICTION': 'The single strongest risk/reward opportunity right now — highest conviction across all signals.',
  'INCOME & YIELD':     'Best dividend or income-generating play — yield, stability, and franking where applicable.',
  'GROWTH CATALYST':    'Highest near-term growth potential driven by a specific, identifiable catalyst — earnings, product cycle, or sector rotation.',
  'DEFENSIVE ANCHOR':   'Best capital preservation play for uncertain or volatile conditions — low beta, strong balance sheet, pricing power.',
  'SPECULATIVE EDGE':   'An asymmetric risk/reward bet — elevated risk but materially higher potential upside than the broader market.',
};

export type PoolStock = {
  ticker: string;
  market: 'ASX' | 'NASDAQ';
  name: string;
};

export const ASX_UNIVERSE: PoolStock[] = [
  // Large-caps
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
  { ticker: 'GMG',  market: 'ASX', name: 'Goodman Group — industrial REIT/logistics/data centres' },
  { ticker: 'REA',  market: 'ASX', name: 'REA Group — property classifieds' },
  { ticker: 'TLS',  market: 'ASX', name: 'Telstra Group — telco' },
  { ticker: 'ORG',  market: 'ASX', name: 'Origin Energy — energy/LNG' },
  { ticker: 'SHL',  market: 'ASX', name: 'Sonic Healthcare — medical diagnostics' },
  { ticker: 'TCL',  market: 'ASX', name: 'Transurban Group — toll roads/infrastructure' },
  // Tech & Growth
  { ticker: 'WTC',  market: 'ASX', name: 'WiseTech Global — logistics software, ASX tech leader' },
  { ticker: 'PME',  market: 'ASX', name: 'Pro Medicus — radiology imaging software, high-margin SaaS' },
  { ticker: 'XRO',  market: 'ASX', name: 'Xero — cloud accounting software, SME focus' },
  { ticker: 'NXT',  market: 'ASX', name: 'NEXTDC — data centres, AI infrastructure play' },
  { ticker: 'CAR',  market: 'ASX', name: 'CAR Group — automotive classifieds, global expansion' },
  // Resources & Energy
  { ticker: 'PLS',  market: 'ASX', name: 'Pilbara Minerals — lithium miner' },
  { ticker: 'NST',  market: 'ASX', name: 'Northern Star Resources — gold miner' },
  { ticker: 'MIN',  market: 'ASX', name: 'Mineral Resources — lithium/iron ore/mining services' },
  { ticker: 'AGL',  market: 'ASX', name: 'AGL Energy — electricity/gas retailer' },
  // ETFs
  { ticker: 'VAS',  market: 'ASX', name: 'Vanguard Australian Shares ETF' },
  { ticker: 'VGS',  market: 'ASX', name: 'Vanguard International Shares ETF' },
  { ticker: 'NDQ',  market: 'ASX', name: 'BetaShares NASDAQ 100 ETF' },
  { ticker: 'GOLD', market: 'ASX', name: 'BetaShares Gold Bullion ETF (AUD hedged)' },
];

export const NASDAQ_UNIVERSE: PoolStock[] = [
  // Mega-cap tech
  { ticker: 'AAPL',  market: 'NASDAQ', name: 'Apple Inc. — consumer tech/services/ecosystem' },
  { ticker: 'MSFT',  market: 'NASDAQ', name: 'Microsoft Corp. — cloud/enterprise software/AI' },
  { ticker: 'NVDA',  market: 'NASDAQ', name: 'NVIDIA Corp. — AI chips/data centre/accelerated computing' },
  { ticker: 'GOOGL', market: 'NASDAQ', name: 'Alphabet Inc. — search/cloud/AI/YouTube' },
  { ticker: 'AMZN',  market: 'NASDAQ', name: 'Amazon.com Inc. — e-commerce/AWS/logistics' },
  { ticker: 'META',  market: 'NASDAQ', name: 'Meta Platforms Inc. — social media/AI/AR' },
  { ticker: 'TSLA',  market: 'NASDAQ', name: 'Tesla Inc. — EVs/energy/autonomy/robotics' },
  // Growth & software
  { ticker: 'ADBE',  market: 'NASDAQ', name: 'Adobe Inc. — creative software/AI design tools' },
  { ticker: 'CRM',   market: 'NASDAQ', name: 'Salesforce Inc. — CRM/enterprise cloud software' },
  { ticker: 'PANW',  market: 'NASDAQ', name: 'Palo Alto Networks — cybersecurity platform' },
  { ticker: 'CRWD',  market: 'NASDAQ', name: 'CrowdStrike Holdings — AI-native cybersecurity' },
  { ticker: 'PLTR',  market: 'NASDAQ', name: 'Palantir Technologies — AI/data analytics platforms' },
  // Defensive / yield
  { ticker: 'CSCO',  market: 'NASDAQ', name: 'Cisco Systems — networking/cybersecurity/dividend payer' },
  { ticker: 'COST',  market: 'NASDAQ', name: 'Costco Wholesale — warehouse retail, recession-resilient' },
  { ticker: 'SBUX',  market: 'NASDAQ', name: 'Starbucks Corp. — global coffee chain, turnaround play' },
  // Biotech / healthcare
  { ticker: 'AMGN',  market: 'NASDAQ', name: 'Amgen Inc. — large-cap biotech/dividend payer' },
  { ticker: 'ISRG',  market: 'NASDAQ', name: 'Intuitive Surgical — robotic surgery, durable moat' },
  // ETFs
  { ticker: 'QQQ',   market: 'NASDAQ', name: 'Invesco QQQ Trust — NASDAQ 100 ETF' },
];

// Combined universe (used for batch TA/news fetching)
export const STOCK_UNIVERSE: PoolStock[] = [...ASX_UNIVERSE, ...NASDAQ_UNIVERSE];

export type TopPick = {
  category: PickCategory;
  ticker: string;
  market: 'ASX' | 'NASDAQ';
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
  picks: TopPick[];             // 10 picks: 5 ASX + 5 NASDAQ, one per category each
  market_overview: string;
  generated_at: string;
};
