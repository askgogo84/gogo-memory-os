#!/usr/bin/env node
// Runs the test commands listed in scripts/tests.d/*.list, in file-name order, one command per line, stopping at the
// first failure. This IS `npm test` (15 Nov audit: the old 26,000-character `&&` chain in package.json moved,
// unchanged and in order, to scripts/tests.d/000-core.list). CI runs the same lists in parallel
// (scripts/run-tests-parallel.mjs). A PR adds its own scripts/tests.d/<name>.list.
// Rules: blank lines and lines starting with # are ignored; a command must be `npx tsx scripts/<file>`,
// `node scripts/<file>` or `npx tsx --test lib/<file>.test.mjs` (no shell operators, no other flags), so a list file
// cannot run arbitrary commands.
import { readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
const dir = join(process.cwd(), 'scripts', 'tests.d')
const files = (() => { try { return readdirSync(dir).filter(f => f.endsWith('.list')).sort() } catch { return [] } })()
const SAFE = /^(?:(?:npx tsx|node) scripts\/[A-Za-z0-9._\/-]+\.(?:mts|ts|mjs|cjs|js)|npx tsx --test lib\/[A-Za-z0-9._\/-]+\.test\.mjs)$/
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
