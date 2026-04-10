/**
 * Static ticker → investor profile sector mapping.
 *
 * Used by classifyPortfolio() in briefing-generator.ts to infer investor
 * profile from holdings composition — no API call, no LLM cost.
 *
 * MAINTENANCE: when adding a stock to top-picks-universe.ts, also add it here.
 * Tickers not in this map default to 'neutral'.
 *
 * Categories:
 *   income     — dividend-focused: banks, telcos, REITs, infrastructure
 *   growth     — reinvestment-focused: US/global tech, high-growth
 *   speculative — elevated risk/reward: small miners, lithium, high-beta
 *   neutral    — diversified ETFs, defensives, mixed-signal large caps
 */

export type SectorProfile = 'income' | 'growth' | 'speculative' | 'neutral';

export const SECTOR_MAP: Record<string, SectorProfile> = {
  // ── ASX Banks (income) ──────────────────────────────────────────────────────
  CBA:  'income',
  ANZ:  'income',
  NAB:  'income',
  WBC:  'income',
  MQG:  'income',  // high-yield relative to sector; infrastructure income
  BEN:  'income',
  BOQ:  'income',

  // ── ASX Telcos (income) ─────────────────────────────────────────────────────
  TLS:  'income',
  TPG:  'income',

  // ── ASX Infrastructure / Toll Roads / REITs (income) ───────────────────────
  TCL:  'income',
  ALX:  'income',
  APA:  'income',
  SYD:  'income',  // delisted but sometimes in legacy portfolios
  GMG:  'income',  // industrial REIT / logistics; some income
  SCG:  'income',  // Scentre Group — retail REIT
  SGP:  'income',  // Stockland — diversified REIT
  MGR:  'income',  // Mirvac — residential/commercial REIT
  GPT:  'income',  // GPT Group — office/retail REIT
  CHC:  'income',  // Charter Hall
  CLW:  'income',  // Charter Hall Long WALE REIT
  CIP:  'income',  // Centuria Industrial REIT
  COF:  'income',  // Centuria Office REIT

  // ── ASX Defensives / Consumer Staples (neutral-leaning income) ─────────────
  WOW:  'neutral',
  COL:  'neutral',  // Coles
  WES:  'neutral',  // Wesfarmers — too diversified to be pure income
  SHL:  'neutral',  // Sonic Healthcare — defensive but growth
  CSL:  'growth',   // biotech/plasma — reinvestment, not yield

  // ── ASX Industrials / Energy (neutral) ─────────────────────────────────────
  ORG:  'neutral',
  AGL:  'neutral',
  WPL:  'neutral',  // Woodside
  STO:  'neutral',  // Santos
  QAN:  'neutral',  // Qantas

  // ── ASX Miners — large diversified (neutral, not speculative) ───────────────
  BHP:  'neutral',
  RIO:  'neutral',
  FMG:  'neutral',  // pure iron ore but ASX 50 scale; neutral by size

  // ── ASX Gold Miners (neutral, often defensive) ──────────────────────────────
  NST:  'neutral',
  EVN:  'neutral',  // Evolution Mining
  NCM:  'neutral',  // Newcrest (merged into Newmont)

  // ── ASX Speculative — lithium / small resources / high-beta ────────────────
  PLS:  'speculative',  // Pilbara Minerals — lithium
  MIN:  'speculative',  // Mineral Resources — lithium/iron ore, high leverage
  LTR:  'speculative',  // Liontown Resources — lithium
  IGO:  'speculative',  // IGO — lithium/nickel exposure
  AKE:  'speculative',  // Allkem — lithium (now Arcadium)
  ZIP:  'speculative',  // Zip Co — buy-now-pay-later
  APT:  'speculative',  // Afterpay (historical)
  NIC:  'speculative',  // Nickel Industries
  SFR:  'speculative',  // Sandfire Resources — copper miner
  OZL:  'speculative',  // OZ Minerals (now BHP — historical)
  GDY:  'speculative',
  FFX:  'speculative',
  S32:  'speculative',  // South32 — diversified minor metals
  CLQ:  'speculative',
  DEG:  'speculative',
  RED:  'speculative',

  // ── ASX ETFs ────────────────────────────────────────────────────────────────
  VAS:  'neutral',   // Vanguard ASX 300 — broad market
  VGS:  'neutral',   // Vanguard International — mixed
  VAE:  'neutral',   // Vanguard Asian emerging — mixed
  VHY:  'income',    // Vanguard High Yield — explicit income ETF
  NDQ:  'growth',    // BetaShares NASDAQ 100 — tech-growth
  GOLD: 'speculative', // BetaShares Gold Bullion — commodity hedge
  HACK: 'growth',    // BetaShares Cybersecurity ETF
  ETHI: 'growth',    // BetaShares Global Sustainability — growth tilt
  FAIR: 'neutral',
  A200: 'neutral',   // BetaShares ASX 200
  IOZ:  'neutral',   // iShares ASX 200
  IVV:  'neutral',   // iShares S&P 500
  STW:  'neutral',   // SPDR ASX 200

  // ── US Tech / Growth ────────────────────────────────────────────────────────
  AAPL:  'growth',
  MSFT:  'growth',
  NVDA:  'growth',
  GOOGL: 'growth',
  GOOG:  'growth',
  AMZN:  'growth',
  META:  'growth',
  TSLA:  'speculative',  // high-beta, not a pure growth story anymore
  NFLX:  'growth',
  CRM:   'growth',
  ADBE:  'growth',
  AMD:   'growth',
  INTC:  'neutral',  // declining, transitional
  ORCL:  'growth',
  SNOW:  'growth',
  UBER:  'growth',
  LYFT:  'speculative',
  PLTR:  'speculative',
  COIN:  'speculative',
  MSTR:  'speculative',  // effectively a Bitcoin proxy
  RIVN:  'speculative',
  LCID:  'speculative',

  // ── US Financials (neutral-income) ─────────────────────────────────────────
  JPM:   'income',
  BAC:   'income',
  WFC:   'income',
  GS:    'neutral',
  MS:    'neutral',
  BRK_B: 'neutral',  // note: may appear as BRK-B; normalise on lookup

  // ── US Defensives / Healthcare / Consumer Staples ───────────────────────────
  JNJ:   'neutral',
  PFE:   'neutral',
  MRK:   'neutral',
  ABBV:  'income',   // high dividend yield
  MO:    'income',   // Altria — tobacco, high yield
  PG:    'neutral',
  KO:    'income',
  PEP:   'income',
  WMT:   'neutral',
  COST:  'neutral',

  // ── US Energy ────────────────────────────────────────────────────────────────
  XOM:   'income',
  CVX:   'income',

  // ── US Infrastructure / Payments ─────────────────────────────────────────────
  V:     'neutral',
  MA:    'neutral',

  // ── US ETFs ──────────────────────────────────────────────────────────────────
  SPY:   'neutral',
  QQQ:   'growth',
  GLD:   'speculative',  // gold commodity
  SLV:   'speculative',  // silver
  ARKK:  'speculative',  // ARK Innovation — high-beta
  VTI:   'neutral',
  VOO:   'neutral',
  VUG:   'growth',   // Vanguard Growth ETF
  VYM:   'income',   // Vanguard High Dividend Yield
  SCHD:  'income',   // Schwab US Dividend Equity
};
