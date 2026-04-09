/**
 * Email template generator — Portfolio Briefing morning emails.
 *
 * Rules enforced here (not in caller):
 * - No <style> blocks, no class attributes. Gmail/Outlook strip them.
 * - All CSS is inline on every element.
 * - Light mode only. No dark mode media queries.
 * - Min 15px body text, 44px CTA height. (Per approved design spec.)
 * - Card sort: ADD → TRIM → HOLD → EXIT (email-only; web app order unchanged).
 */

import type { StockSignal, BriefingOverview } from '@/app/api/briefing/route';

// ── Sort ─────────────────────────────────────────────────────────────────────

const SIGNAL_ORDER: Record<string, number> = { ADD: 0, TRIM: 1, HOLD: 2, EXIT: 3 };

export function sortCards(stocks: StockSignal[]): StockSignal[] {
  return [...stocks].sort(
    (a, b) => (SIGNAL_ORDER[a.signal] ?? 2) - (SIGNAL_ORDER[b.signal] ?? 2),
  );
}

// ── Subject line ─────────────────────────────────────────────────────────────

/**
 * "Portfolio brief — Mon 6 Apr | ADD: AAPL, TRIM: BHP"
 * "Portfolio brief — Mon 6 Apr | All holds"
 */
export function buildSubject(stocks: StockSignal[], now: Date): string {
  const date = now.toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney',
  });
  const actions = [
    ...stocks.filter(s => s.signal === 'ADD').map(s => `ADD: ${s.ticker}`),
    ...stocks.filter(s => s.signal === 'TRIM').map(s => `TRIM: ${s.ticker}`),
  ];
  return actions.length > 0
    ? `Portfolio brief \u2014 ${date} | ${actions.join(', ')}`
    : `Portfolio brief \u2014 ${date} | All holds`;
}

export function buildFailureSubject(now: Date): string {
  const date = now.toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Australia/Sydney',
  });
  return `Portfolio brief \u2014 ${date} | Generation issue`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function marketTag(country: string): string {
  if (country === 'Australia') return 'ASX';
  if (country === 'United States') return 'US';
  return country; // "Global" for ETFs
}

function signalBadgeStyle(signal: string): string {
  const base =
    'display:inline-block;font-size:10px;font-weight:800;padding:3px 9px;' +
    'border-radius:20px;letter-spacing:0.07em;';
  switch (signal) {
    case 'ADD':  return `${base}background:#dcfce7;color:#15803d;`;
    case 'TRIM': return `${base}background:#fef3c7;color:#b45309;`;
    case 'EXIT': return `${base}background:#fee2e2;color:#b91c1c;`;
    default:     return `${base}background:#f3f4f6;color:#6b7280;`;
  }
}

function actionBadgeStyle(signal: string): string {
  const base =
    'display:inline-block;font-size:11px;font-weight:800;padding:3px 10px;' +
    'border-radius:3px;letter-spacing:0.06em;';
  switch (signal) {
    case 'ADD':  return `${base}background:#14532d;color:#4ade80;`;
    case 'TRIM': return `${base}background:#92400e;color:#fcd34d;`;
    case 'EXIT': return `${base}background:#7f1d1d;color:#fca5a5;`;
    default:     return `${base}background:#374151;color:#9ca3af;`;
  }
}

function formatGenTime(generatedAt: string): string {
  try {
    return (
      new Date(generatedAt).toLocaleTimeString('en-AU', {
        hour: '2-digit', minute: '2-digit', timeZone: 'Australia/Sydney',
      }) + ' AEST'
    );
  } catch {
    return '07:00 AEST';
  }
}

// ── Stock card ────────────────────────────────────────────────────────────────

function renderCard(stock: StockSignal, isLast: boolean): string {
  const borderB = isLast ? '' : 'border-bottom:1px solid #f3f4f6;';
  // Append TA context to catalyst if available — matches web app behaviour.
  const body = stock.ta_context
    ? `${stock.catalyst} ${stock.ta_context}`
    : stock.catalyst;

  return `<div style="padding:15px 0;${borderB}">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px;">
    <div style="display:flex;align-items:baseline;gap:6px;">
      <span style="font-family:'Courier New',monospace;font-size:15px;font-weight:700;color:#111827;">${esc(stock.ticker)}</span>
      <span style="font-size:11px;color:#9ca3af;">${esc(marketTag(stock.country))}</span>
    </div>
    <span style="${signalBadgeStyle(stock.signal)}">${esc(stock.signal)}</span>
  </div>
  <p style="font-size:15px;line-height:1.6;color:#374151;margin:0 0 9px;">${esc(body)}</p>
  <div style="display:flex;align-items:flex-start;gap:8px;background:#fffbeb;border-left:3px solid #f59e0b;padding:7px 10px;border-radius:0 4px 4px 0;">
    <span style="font-size:10px;font-weight:800;color:#b45309;text-transform:uppercase;letter-spacing:0.08em;white-space:nowrap;padding-top:1px;">Watch</span>
    <span style="font-size:12px;color:#78350f;line-height:1.5;">${esc(stock.what_to_watch)}</span>
  </div>
</div>`;
}

// ── Action strip badges ───────────────────────────────────────────────────────

function renderActionBadges(stocks: StockSignal[]): string {
  const actions   = stocks.filter(s => s.signal !== 'HOLD');
  const holdCount = stocks.filter(s => s.signal === 'HOLD').length;
  const parts = actions.map(
    s => `<span style="${actionBadgeStyle(s.signal)}">${esc(s.signal)} &mdash; ${esc(s.ticker)}</span>`,
  );
  if (holdCount > 0) {
    const label = holdCount === 1 ? '1 other' : `${holdCount} others`;
    parts.push(`<span style="${actionBadgeStyle('HOLD')}">HOLD &mdash; ${label}</span>`);
  }
  return parts.join(' ');
}

// ── Shared wrapper ────────────────────────────────────────────────────────────

function emailShell(dateLabel: string, bodyRows: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="color-scheme" content="light">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Portfolio Briefing</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Inter',sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f0f0f0;">
<tr><td align="center" style="padding:0;">
<table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;">

<!-- Header -->
<tr><td style="padding:20px 24px 14px;border-bottom:1px solid #f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
    <td><span style="font-size:11px;font-weight:800;color:#111827;letter-spacing:0.12em;text-transform:uppercase;">Portfolio Briefing</span></td>
    <td align="right"><span style="font-size:11px;color:#9ca3af;">${esc(dateLabel)}</span></td>
  </tr></table>
</td></tr>

${bodyRows}

</table>
</td></tr>
</table>
</body>
</html>`;
}

function footerRow(appUrl: string, showUnsubscribe = true): string {
  return `<!-- Footer -->
<tr><td style="padding:20px 24px 24px;border-top:1px solid #f3f4f6;background:#fafafa;text-align:center;">
  <a href="${esc(appUrl)}" style="display:block;background:#111827;color:#ffffff;text-decoration:none;padding:14px 24px;border-radius:6px;font-size:14px;font-weight:700;margin-bottom:16px;min-height:44px;line-height:16px;box-sizing:border-box;">View full briefing</a>
  <div style="font-size:11px;color:#9ca3af;line-height:1.9;">
    AI perspectives, not personalised financial advice.<br>${
      showUnsubscribe
        ? `\n    <a href="mailto:unsubscribe@portfoliobriefing.com.au" style="color:#9ca3af;text-decoration:underline;">Unsubscribe</a>\n    &middot;\n    <a href="${esc(appUrl)}/privacy" style="color:#9ca3af;text-decoration:underline;">Privacy Policy</a>`
        : `\n    <a href="${esc(appUrl)}/privacy" style="color:#9ca3af;text-decoration:underline;">Privacy Policy</a>`
    }
  </div>
</td></tr>`;
}

// ── Main email ────────────────────────────────────────────────────────────────

export function buildEmailHtml(
  stocks:      StockSignal[],
  overview:    BriefingOverview,
  generatedAt: string,
  appUrl:      string,
): string {
  const sorted = sortCards(stocks);
  const dateLabel = new Date().toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  const bodyRows = `<!-- Action strip -->
<tr><td style="padding:14px 24px;background:#111827;">
  <div style="margin-bottom:8px;">
    <span style="font-size:10px;color:#6b7280;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;margin-right:4px;">Today</span>
    ${renderActionBadges(sorted)}
  </div>
  <div style="font-size:11px;color:#6b7280;line-height:1.4;">Sourced from Yahoo Finance, ASX announcements &amp; live news. Generated ${esc(formatGenTime(generatedAt))}.</div>
</td></tr>

<!-- Executive summary -->
<tr><td style="padding:14px 24px;background:#fafafa;border-bottom:1px solid #f3f4f6;">
  <div style="font-size:10px;font-weight:700;color:#9ca3af;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:5px;">Overview</div>
  <div style="font-size:14px;line-height:1.65;color:#374151;">${esc(overview.executive_summary)}</div>
</td></tr>

<!-- Stock cards -->
<tr><td style="padding:4px 24px 0;">
  ${sorted.map((s, i) => renderCard(s, i === sorted.length - 1)).join('\n  ')}
</td></tr>

${footerRow(appUrl)}`;

  return emailShell(dateLabel, bodyRows);
}

// ── Failure email ─────────────────────────────────────────────────────────────

export function buildFailureEmailHtml(appUrl: string): string {
  const dateLabel = new Date().toLocaleDateString('en-AU', {
    weekday: 'short', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'Australia/Sydney',
  });

  const bodyRows = `<!-- Failure message -->
<tr><td style="padding:32px 24px;text-align:center;">
  <p style="font-size:14px;color:#374151;line-height:1.6;margin:0 0 20px;">
    This morning's briefing couldn't be generated due to a data fetch issue.<br>
    We'll retry tonight so tomorrow's brief is ready on time.
  </p>
  <a href="${esc(appUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:13px;font-weight:600;min-height:44px;line-height:20px;box-sizing:border-box;">View yesterday's briefing</a>
</td></tr>

${footerRow(appUrl)}`;

  return emailShell(dateLabel, bodyRows);
}
