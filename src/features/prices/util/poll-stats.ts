// What the background price service has done since it started: how many polls, and the longest gap between two. Kept
// by the service itself because the phone's log buffer only holds minutes, and a screen-off soak test needs hours.

export interface PollStats {
  count: number
  firstAt: number
  lastAt: number
  maxGapAt: number // when the longest gap ended
  maxGapMs: number
}

export function recordPoll(prev: PollStats | null, now: number): PollStats {
  if (!prev) return { count: 1, firstAt: now, lastAt: now, maxGapAt: now, maxGapMs: 0 }
  const gap = now - prev.lastAt
  const longest = gap > prev.maxGapMs
  return {
    count: prev.count + 1,
    firstAt: prev.firstAt,
    lastAt: now,
    maxGapAt: longest ? now : prev.maxGapAt,
    maxGapMs: longest ? gap : prev.maxGapMs,
  }
}

/** One line for the Settings row, e.g. "812 polls over 6.7 h, longest gap 31 s". */
export function describePollStats(stats: PollStats | null, now: number): string {
  if (!stats) return 'No polls recorded yet'
  const hours = (stats.lastAt - stats.firstAt) / 3_600_000
  const span = hours >= 1 ? `${hours.toFixed(1)} h` : `${Math.round(hours * 60)} min`
  const ago = Math.round((now - stats.lastAt) / 1000)
  return `${stats.count} polls over ${span}, longest gap ${Math.round(stats.maxGapMs / 1000)} s, last ${ago} s ago`
}
