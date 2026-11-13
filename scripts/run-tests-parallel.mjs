#!/usr/bin/env node
// Runs EXACTLY the commands `npm test` runs — the package.json `test` chain plus every scripts/tests.d/*.list line
// (via run-test-list.mjs) — but several at a time, so CI finishes inside its time limit (13 Nov: the sequential
// chain took ~18.5 of CI's 20 minutes and runs were cut off at the typecheck). Nothing is skipped: every command must
// pass, a command that matches neither safe shape fails the run, and the count run is printed and checked.
// `npm test` (sequential) is unchanged for local use.
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import os from 'node:os'

const root = process.cwd()
const chain = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).scripts.test
  .split(' && ').map(s => s.trim()).filter(Boolean)

const LIST_RUNNER = 'node scripts/run-test-list.mjs'
const SAFE_LIST = /^(npx tsx|node) scripts\/[A-Za-z0-9._\/-]+\.(?:mts|ts|mjs|cjs|js)$/
const SAFE_CHAIN = /^(?:npx (?:--yes )?tsx(?: --test)?|node) (?:scripts|lib)\/[A-Za-z0-9._\/-]+\.(?:mts|ts|mjs|cjs|js)$/

const commands = []
const seen = new Set()
const add = (cmd, from) => { if (!seen.has(cmd)) { seen.add(cmd); commands.push({cmd, from}) } }
let listRunnerSeen = false
for (const cmd of chain) {
  if (cmd === LIST_RUNNER) { listRunnerSeen = true; continue }
  if (!SAFE_CHAIN.test(cmd)) { console.error(`run-tests-parallel: unsupported command in package.json test chain: ${cmd}`); process.exit(2) }
  add(cmd, 'package.json')
}
if (!listRunnerSeen) { console.error('run-tests-parallel: package.json test no longer calls run-test-list.mjs; update this runner'); process.exit(2) }
const dir = join(root, 'scripts', 'tests.d')
const listFiles = (() => { try { return readdirSync(dir).filter(f => f.endsWith('.list')).sort() } catch { return [] } })()
for (const f of listFiles) {
  for (const raw of readFileSync(join(dir, f), 'utf8').split('\n')) {
    const cmd = raw.trim()
    if (!cmd || cmd.startsWith('#')) continue
    if (!SAFE_LIST.test(cmd)) { console.error(`run-tests-parallel: refusing unsafe line in ${f}: ${cmd}`); process.exit(2) }
    add(cmd, f)
  }
}

// `npx tsx …` resolves to the local tsx binary (same package npm ci installed); `node …` to this node.
// tsx is not a declared dependency (CI fetches it through npx), so use a local binary when present, else npx itself.
const tsxBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')
const localTsx = existsSync(tsxBin)
function argv(cmd) {
  const parts = cmd.split(' ')
  if (parts[0] === 'node') return [process.execPath, parts.slice(1)]
  const rest = parts.slice(1).filter(p => p !== '--yes' && p !== 'tsx')
  return localTsx ? [tsxBin, rest] : ['npx', ['--yes', 'tsx', ...rest]]
}

const concurrency = Math.max(1, Number(process.env.TEST_CONCURRENCY) || (os.availableParallelism?.() ?? os.cpus().length))
const perTestMs = Math.max(60_000, Number(process.env.TEST_TIMEOUT_MS) || 6 * 60_000)
const started = Date.now()
const results = []
let next = 0

function runOne(item) {
  return new Promise(resolve => {
    const [bin, args] = argv(item.cmd)
    const t0 = Date.now()
    // Own process group, so a timeout kills npx/tsx AND the node process they start (review: killing only the direct
    // child left the grandchild holding the pipes open, so 'close' never fired and the timeout did nothing).
    const child = spawn(bin, args, {cwd: root, env: process.env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32'})
    let out = ''
    const keep = chunk => { out += chunk; if (out.length > 200_000) out = out.slice(-200_000) }
    child.stdout.on('data', keep); child.stderr.on('data', keep)
    const timer = setTimeout(() => { out += `\n[run-tests-parallel] timed out after ${perTestMs / 1000}s\n`; try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') } }, perTestMs)
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({...item, code: code ?? 1, signal, ms: Date.now() - t0, out}) })
    child.on('error', err => { clearTimeout(timer); resolve({...item, code: 1, ms: Date.now() - t0, out: out + String(err)}) })
  })
}

async function worker() {
  while (next < commands.length) {
    const item = commands[next++]
    const r = await runOne(item)
    results.push(r)
    const ok = r.code === 0
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${(r.ms / 1000).toFixed(1).padStart(6)}s  ${r.cmd}`)
    if (!ok) console.log(`----- output of failed command (${r.from}) -----\n${r.out}\n----- end -----`)
  }
}

if (!localTsx) await new Promise(r => spawn('npx', ['--yes', 'tsx', '--version'], {stdio: 'ignore'}).on('close', r))
console.log(`run-tests-parallel: ${commands.length} commands (${commands.filter(c => c.from === 'package.json').length} from package.json, ${commands.filter(c => c.from !== 'package.json').length} from ${listFiles.length} list files), concurrency ${concurrency}`)
await Promise.all(Array.from({length: Math.min(concurrency, commands.length)}, worker))
const failed = results.filter(r => r.code !== 0)
const slow = [...results].sort((a, b) => b.ms - a.ms).slice(0, 10)
console.log(`\nSlowest:\n${slow.map(r => `  ${(r.ms / 1000).toFixed(1)}s ${r.cmd}`).join('\n')}`)
console.log(`\nrun-tests-parallel: ${results.length}/${commands.length} run, ${failed.length} failed, ${((Date.now() - started) / 1000).toFixed(0)}s`)
if (results.length !== commands.length) { console.error('run-tests-parallel: not every command ran'); process.exit(1) }
if (failed.length) { console.error(`run-tests-parallel: FAILED\n${failed.map(r => '  ' + r.cmd).join('\n')}`); process.exit(1) }
