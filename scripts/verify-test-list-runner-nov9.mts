// The test list runner: refuses unsafe lines, stops on the first failure, de-duplicates, and is `npm test`.
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
const runner = resolve('scripts/run-test-list.mjs')
const sandbox = (lists: Record<string, string>, scripts: Record<string, string>) => {
  const d = mkdtempSync(join(tmpdir(), 'tl-')); mkdirSync(join(d, 'scripts', 'tests.d'), { recursive: true })
  for (const [k, v] of Object.entries(lists)) writeFileSync(join(d, 'scripts', 'tests.d', k), v)
  for (const [k, v] of Object.entries(scripts)) writeFileSync(join(d, 'scripts', k), v)
  return (env = {}) => spawnSync('node', [runner], { cwd: d, encoding: 'utf8', env: { ...process.env, ...env } })
}
let r = sandbox({ 'a.list': 'node scripts/ok.mjs\nnode scripts/ok.mjs\n# comment\n' }, { 'ok.mjs': 'console.log("ok")' })()
assert.equal(r.status, 0); assert.match(r.stdout, /1 commands from 1 files passed/)
r = sandbox({ 'a.list': 'node scripts/fail.mjs\n', 'b.list': 'node scripts/ok.mjs\n' }, { 'fail.mjs': 'process.exit(3)', 'ok.mjs': '' })()
assert.equal(r.status, 3); assert.match(r.stderr, /FAILED \(a\.list\)/)
r = sandbox({ 'a.list': 'node scripts/ok.mjs && rm -rf /\n' }, { 'ok.mjs': '' })()
assert.equal(r.status, 2); assert.match(r.stderr, /refusing unsafe line/)
r = sandbox({ 'a.list': 'curl http://x\n' }, {})(); assert.equal(r.status, 2)
// 15 Nov audit: `npm test` is the list runner alone; the former chain lives, in order, in 000-core.list.
r = sandbox({ 'a.list': 'npx tsx --test lib/x.test.mjs\n' }, {})(); assert.notEqual(r.status, 2, 'the node:test form for lib/*.test.mjs is allowed')
for (const bad of ['npx tsx --test scripts/x.mjs', 'npx tsx --watch scripts/x.mts', 'node --eval 1 scripts/x.mjs', 'npx tsx --test lib/x.mjs', 'npx --yes tsx scripts/x.mts']) {
  r = sandbox({ 'a.list': bad + '\n' }, {})(); assert.equal(r.status, 2, `refused: ${bad}`)
}
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).scripts.test as string
assert.equal(pkg, 'node scripts/run-test-list.mjs', 'npm test is exactly the list runner')
const core = readFileSync('scripts/tests.d/000-core.list', 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#'))
assert.ok(core.length > 400, 'the former chain is intact in 000-core.list')
assert.ok(readFileSync('scripts/tests.d/zz-formerly-outside-npm-test.list', 'utf8').split('\n').filter(l => l.trim() && !l.startsWith('#')).length >= 160, 'checks that used to run outside npm test stay registered')
console.log('verify-test-list-runner-nov9: 1 passed')
