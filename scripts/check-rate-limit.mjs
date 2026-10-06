// Run: node scripts/check-rate-limit.mjs
import assert from 'node:assert/strict'

import { checkLimits, identify, memoryStore, rulesFor, upstashStore } from '../server/lib/rate-limit.ts'

const rule = { by: 'device', max: 3, name: 'test', windowSec: 60 }
const T = 999_960 * 1000 // a fixed clock; 999,960 s is a whole number of 60 s windows, so T is the start of one
const ids = { device: 'a'.repeat(20) }

// Allows `max` requests, then refuses with how long to wait.
{
  const store = memoryStore(() => T)
  for (let i = 0; i < 3; i++) assert.deepEqual(await checkLimits(store, ids, [rule], T), { ok: true })
  const blocked = await checkLimits(store, ids, [rule], T + 10_000)
  assert.equal(blocked.ok, false)
  assert.equal(blocked.rule, 'test')
  assert.equal(blocked.retryAfterSec, 50)
}
// The next window starts fresh.
{
  let t = T
  const store = memoryStore(() => t)
  for (let i = 0; i < 4; i++) await checkLimits(store, ids, [rule], t)
  t = T + 61_000
  assert.deepEqual(await checkLimits(store, ids, [rule], t), { ok: true })
}
// Devices are counted separately, and a missing identity is simply not counted by that rule.
{
  const store = memoryStore(() => T)
  for (let i = 0; i < 4; i++) await checkLimits(store, ids, [rule], T)
  assert.deepEqual(await checkLimits(store, { device: 'b'.repeat(20) }, [rule], T), { ok: true })
  assert.deepEqual(await checkLimits(store, {}, [rule], T), { ok: true })
}
// The IP and daily-budget rules still protect when the device id is missing or forged each time.
{
  const store = memoryStore(() => T)
  const rules = rulesFor(5)
  const verdicts = []
  for (let i = 0; i < 7; i++) verdicts.push(await checkLimits(store, { global: 'all', ip: '9.9.9.9' }, rules, T))
  assert.equal(verdicts.filter((v) => v.ok).length, 5)
  assert.equal(verdicts[5].rule, 'budget-day')
}

// Upstash: INCR + EXPIRE NX in one request, count read back from the first result.
{
  const calls = []
  const fake = async (url, init) => {
    calls.push({ body: JSON.parse(init.body), url, auth: init.headers.authorization })
    return new Response(JSON.stringify([{ result: 7 }, { result: 1 }]), { status: 200 })
  }
  const count = await upstashStore('https://x.upstash.io', 'secret', fake).incr('k', 60)
  assert.equal(count, 7)
  assert.deepEqual(calls[0].body, [
    ['INCR', 'k'],
    ['EXPIRE', 'k', 60, 'NX'],
  ])
  assert.equal(calls[0].url, 'https://x.upstash.io/pipeline')
  assert.equal(calls[0].auth, 'Bearer secret')
  await assert.rejects(
    upstashStore('https://x', 't', async () => new Response('no', { status: 500 })).incr('k', 60),
    /500/,
  )
}

// Identity: a sane device id is kept, junk is dropped, and the first forwarded address wins.
{
  const h = (o) => new Headers(o)
  assert.equal(identify(h({ 'x-cue-device': 'abcdef0123456789abcdef' })).device, 'abcdef0123456789abcdef')
  assert.equal(identify(h({ 'x-cue-device': 'short' })).device, undefined)
  assert.equal(identify(h({ 'x-cue-device': 'bad id with spaces!!!' })).device, undefined)
  assert.equal(identify(h({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' })).ip, '1.2.3.4')
  assert.equal(identify(h({})).ip, undefined)
}

console.log('rate-limit: all checks passed')
