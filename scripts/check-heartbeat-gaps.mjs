// Run on a Mac with the phone connected over adb: node scripts/check-heartbeat-gaps.mjs [maxGapSeconds]
// Reads the price service's own poll log (one line every ~30 s) and reports the longest gap between polls, so a
// screen-off soak test is a pass or fail: if timers stall in deep sleep, a long gap shows up here.
import { execFileSync } from 'node:child_process'

const limit = Number(process.argv[2] ?? 90)
const log = execFileSync('adb', ['logcat', '-d', '-s', 'CueSpike:I'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const polls = [...log.matchAll(/poll (\d+) (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/g)].map((m) => ({
  n: Number(m[1]),
  at: Date.parse(m[2]),
}))

if (polls.length < 2) {
  console.log('Not enough poll lines yet. Is the app running with a rule or the price service started?')
  process.exit(1)
}

const gaps = polls.slice(1).map((p, i) => ({ from: polls[i].at, seconds: (p.at - polls[i].at) / 1000 }))
const worst = gaps.reduce((a, b) => (b.seconds > a.seconds ? b : a))
const slow = gaps.filter((g) => g.seconds > limit)
const spanMin = (polls.at(-1).at - polls[0].at) / 60000

console.log(`${polls.length} polls over ${spanMin.toFixed(1)} min (from ${new Date(polls[0].at).toISOString()})`)
console.log(`Longest gap: ${worst.seconds.toFixed(0)}s at ${new Date(worst.from).toISOString()} (limit ${limit}s)`)
if (slow.length) {
  console.log(`FAIL: ${slow.length} gap(s) over ${limit}s`)
  slow.slice(0, 10).forEach((g) => console.log(`  ${g.seconds.toFixed(0)}s after ${new Date(g.from).toISOString()}`))
  process.exit(1)
}
console.log('PASS: the price service never stalled')
