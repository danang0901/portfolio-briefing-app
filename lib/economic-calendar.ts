/**
 * Economic calendar for AU + US macro events.
 *
 * Hardcoded 2026 dates — refresh quarterly.
 * RBA: https://www.rba.gov.au/monetary-policy/rba-board-minutes/
 * FOMC: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm
 */

type CalendarEvent = { date: string; event: string };

// Update dates each quarter
const CALENDAR_2026: CalendarEvent[] = [
  // RBA Cash Rate Decisions
  { date: '2026-04-01', event: 'RBA Cash Rate Decision' },
  { date: '2026-05-19', event: 'RBA Cash Rate Decision' },
  { date: '2026-07-07', event: 'RBA Cash Rate Decision' },
  { date: '2026-08-18', event: 'RBA Cash Rate Decision' },
  { date: '2026-09-29', event: 'RBA Cash Rate Decision' },
  { date: '2026-11-03', event: 'RBA Cash Rate Decision' },
  { date: '2026-12-01', event: 'RBA Cash Rate Decision' },

  // FOMC Rate Decisions
  { date: '2026-04-29', event: 'FOMC Rate Decision (US Fed)' },
  { date: '2026-06-10', event: 'FOMC Rate Decision (US Fed)' },
  { date: '2026-07-29', event: 'FOMC Rate Decision (US Fed)' },
  { date: '2026-09-16', event: 'FOMC Rate Decision (US Fed)' },
  { date: '2026-10-28', event: 'FOMC Rate Decision (US Fed)' },
  { date: '2026-12-09', event: 'FOMC Rate Decision (US Fed)' },

  // AU economic data releases (approximate)
  { date: '2026-04-03', event: 'AU Trade Balance (Feb)' },
  { date: '2026-04-10', event: 'US CPI (Mar)' },
  { date: '2026-04-17', event: 'AU Employment Change (Mar)' },
  { date: '2026-04-29', event: 'AU CPI Q1 2026' },
  { date: '2026-05-01', event: 'US Non-Farm Payrolls (Apr)' },
  { date: '2026-05-07', event: 'RBA Statement on Monetary Policy' },
  { date: '2026-05-14', event: 'AU Budget 2026–27' },
  { date: '2026-06-03', event: 'AU GDP Q1 2026' },
  { date: '2026-07-16', event: 'AU Employment Change (Jun)' },
  { date: '2026-07-23', event: 'AU CPI Q2 2026' },
  { date: '2026-08-05', event: 'RBA Statement on Monetary Policy' },
  { date: '2026-09-03', event: 'AU GDP Q2 2026' },
  { date: '2026-10-22', event: 'AU CPI Q3 2026' },
];

/**
 * Returns a formatted string of upcoming economic events within `daysAhead` days.
 * Sorted by date. Returns a "no major events" message if none found.
 */
export function buildEconomicCalendar(daysAhead = 14): string {
  const now = new Date();
  // Zero out time so "today" events are included
  now.setHours(0, 0, 0, 0);
  const cutoff = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  const upcoming = CALENDAR_2026
    .filter(e => {
      const d = new Date(e.date);
      return d >= now && d <= cutoff;
    })
    .sort((a, b) => a.date.localeCompare(b.date));

  if (upcoming.length === 0) {
    return `No major AU/US economic events in the next ${daysAhead} days.`;
  }

  return upcoming
    .map(e => {
      const d = new Date(e.date);
      const label = d.toLocaleDateString('en-AU', {
        weekday: 'short', day: 'numeric', month: 'short',
      });
      return `${label}: ${e.event}`;
    })
    .join('\n');
}
