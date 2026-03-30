type ASXAnnouncement = {
  id?: string;
  release_date?: string;
  document_release_date?: string;
  headline?: string;
  market_sensitive?: boolean;
};

type ASXResponse = {
  data?: ASXAnnouncement[];
};

/**
 * Fetches the last 5 ASX company announcements for an ASX-listed ticker.
 * Returns an empty array if the ticker is not ASX-listed or the feed is unavailable.
 * Market-sensitive announcements are flagged with ⚡.
 */
export async function fetchASXAnnouncements(ticker: string): Promise<string[]> {
  try {
    const url = `https://www.asx.com.au/asx/1/company/${encodeURIComponent(ticker)}/announcements?count=5&market_sensitive=false`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; portfolio-briefing/1.0)' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return [];
    const data = await res.json() as ASXResponse;
    const items = data.data ?? [];
    if (items.length === 0) return [];

    return items.slice(0, 5).map(a => {
      const rawDate = a.release_date ?? a.document_release_date ?? '';
      const dateStr = rawDate
        ? new Date(rawDate).toLocaleDateString('en-AU', {
            day: 'numeric', month: 'short', year: 'numeric',
          })
        : 'Unknown date';
      const flag = a.market_sensitive ? ' ⚡' : '';
      return `[${dateStr}] ${a.headline ?? 'No title'}${flag}`;
    });
  } catch {
    return [];
  }
}
