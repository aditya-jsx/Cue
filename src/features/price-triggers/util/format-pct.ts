/** A percentage for display: one decimal normally, two below 1% so a small drop doesn't read as 0.0%. */
export const formatPct = (pct: number): string => `${Math.abs(pct) >= 1 ? pct.toFixed(1) : pct.toFixed(2)}%`
