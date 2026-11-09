// The per-PR test list runner: refuses unsafe lines, stops on the first failure, de-duplicates, and is wired after the
// existing package.json chain (which stays intact).
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
const pkg = JSON.parse(readFileSync('package.json', 'utf8')).scripts.test as string
assert.ok(pkg.trim().endsWith('&& node scripts/run-test-list.mjs'), 'runs after the existing chain')
assert.ok(pkg.split('&&').length > 100, 'existing chain intact')
console.log('verify-test-list-runner-nov9: 1 passed')
