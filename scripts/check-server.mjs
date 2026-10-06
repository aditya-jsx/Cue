// Run: node scripts/check-server.mjs
// Compiles the parser server to plain JavaScript the way Vercel does (one file per module, no bundling) and runs the
// compiled handler. A bare import like '../lib/rate-limit' type-checks fine but crashes at runtime in ES modules, which
// is exactly what broke the first deploy of the rate limiter; loading the compiled output catches that before production.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, symlinkSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const server = resolve(import.meta.dirname, '../server')
const out = mkdtempSync(join(tmpdir(), 'cue-server-'))
try {
  try {
    execFileSync(
      join(server, 'node_modules/.bin/tsc'),
      [
        '--outDir',
        out,
        '--module',
        'ESNext',
        '--moduleResolution',
        'Bundler',
        '--target',
        'ES2022',
        '--skipLibCheck',
        '--types',
        'node',
        '--rootDir',
        server,
        'api/parse-intent.ts',
        'lib/rate-limit.ts',
      ],
      { cwd: server, stdio: 'pipe' },
    )
  } catch {
    // Run on bare files, tsc ignores the project's settings and may complain about types while still emitting the
    // JavaScript. Type errors are caught by the server's own `tsc --noEmit`; this script only checks that the output runs.
  }
  copyFileSync(join(server, 'package.json'), join(out, 'package.json'))
  symlinkSync(join(server, 'node_modules'), join(out, 'node_modules'))

  process.env.GEMINI_API_KEY = 'fake-key-never-used'
  process.env.CUE_CLIENT_TOKEN = 'tok'
  const { POST } = await import(pathToFileURL(join(out, 'api/parse-intent.js')).href) // fails here if an import is broken
  assert.equal(typeof POST, 'function')

  const call = (headers = {}) =>
    POST(
      new Request('https://x/api/parse-intent', {
        body: '{}',
        headers: { 'content-type': 'application/json', ...headers },
        method: 'POST',
      }),
    )
  const ok = { 'x-cue-client': 'tok', 'x-cue-device': 'devicecheck0123456789abcdef' }

  assert.equal((await call()).status, 403) // no token
  assert.equal((await call({ ...ok, 'content-length': '5000000' })).status, 413) // too large
  assert.equal((await call(ok)).status, 400) // nothing to parse
  const codes = []
  for (let i = 0; i < 25; i++) codes.push((await call(ok)).status)
  assert.ok(codes.includes(429), 'one device must be rate limited within a minute')
  const limited = await call(ok)
  assert.equal(limited.status, 429)
  assert.ok(Number(limited.headers.get('retry-after')) > 0)
  assert.equal((await call({ ...ok, 'x-cue-device': 'anotherdevice0123456789abcdef' })).status, 400) // others unaffected
  console.log('server: all checks passed')
} finally {
  rmSync(out, { force: true, recursive: true })
}
