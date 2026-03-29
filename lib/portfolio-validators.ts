export function validateTicker(raw: string): string | null {
  const ticker = raw.trim().toUpperCase();
  if (!ticker || ticker.length > 10) return null;
  return ticker;
}

export function validateUnits(raw: string): number | null {
  const units = parseInt(raw, 10);
  if (!units || units <= 0) return null;
  return units;
}
