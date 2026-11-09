#!/usr/bin/env node
// Runs the test commands listed in scripts/tests.d/*.list, in file-name order, one command per line, stopping at the
// first failure (the same semantics as the `&&` chain in package.json, which it extends — it replaces nothing).
// Why: every PR used to append its test to the single `scripts.test` line, so any merge put every other open PR into
// conflict. A PR now adds its own scripts/tests.d/<name>.list instead.
// Rules: blank lines and lines starting with # are ignored; a command must start with `npx tsx scripts/` or
// `node scripts/` (no shell operators), so a list file cannot run arbitrary commands.
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const dir = join(process.cwd(), 'scripts', 'tests.d')
const files = (() => { try { return readdirSync(dir).filter(f => f.endsWith('.list')).sort() } catch { return [] } })()
const SAFE = /^(npx tsx|node) scripts\/[A-Za-z0-9._\/-]+\.(?:mts|ts|mjs|cjs|js)$/
let ran = 0
const seen = new Set()
for (const f of files) {
  for (const raw of readFileSync(join(dir, f), 'utf8').split('\n')) {
    const cmd = raw.trim()
    if (!cmd || cmd.startsWith('#')) continue
    if (!SAFE.test(cmd)) { console.error(`run-test-list: refusing unsafe line in ${f}: ${cmd}`); process.exit(2) }
    if (seen.has(cmd)) continue
    seen.add(cmd)
    const [bin, ...args] = cmd.split(' ')
    const r = spawnSync(bin, args, { stdio: 'inherit', env: process.env })
    if (r.status !== 0) { console.error(`run-test-list: FAILED (${f}): ${cmd}`); process.exit(r.status || 1) }
    ran++
  }
}
console.log(`run-test-list: ${ran} commands from ${files.length} files passed`)
