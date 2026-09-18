// Policy-gate coverage: every consequential agent executor must be authorization-gated.
//
// WHY THIS EXISTS
// ---------------
// lib/agent/policy.ts is the single decision point for whether an agent action may
// proceed, and it is already unit-tested by verify-agent-policy.mts. What that test
// canNOT tell you is whether every executor actually goes through it. This script
// closes that gap: it finds the places in lib/agent that perform a CONSEQUENTIAL
// external mutation, and proves each one is authorization-gated before it fires.
//
// The gate is enforced at the ORCHESTRATION layer, not inside each executor, so a
// naive "every executor imports policy.ts" assertion would be wrong. Three
// mechanisms are accepted, and every executor must satisfy at least one:
//
//   GATE     the executor's own module calls evaluateAgentExecutionPolicy
//   APPROVAL the executor's own body asserts an APPROVED agent_approvals row
//            before mutating (the same invariant policy.ts enforces for
//            irreversible actions, checked against the durable record)
//   CALLER   every module that calls the executor is itself GATE-compliant
//
// A new mutating call site in lib/agent that satisfies none of the three FAILS this
// test. That is the whole point: this is a ratchet against a future executor that
// reaches a provider without passing an authorization boundary.
//
// Run: npx tsx scripts/verify-policy-gate-coverage.mts

import fs from 'node:fs'
import path from 'node:path'

const AGENT_DIR = 'lib/agent'
const SEARCH_ROOTS = ['lib', 'app']

const GATE_SYMBOL = 'evaluateAgentExecutionPolicy'

// A consequential mutation is an outbound write to a system outside AskGogo:
// a provider API mutation, or a browser action that submits a form.
const MUTATING_FETCH = /method:\s*'(POST|PUT|PATCH|DELETE)'/
const CONSEQUENTIAL_HELPERS = [
  'createCalendarEventAtIso',
  'createOrConfirmCalendarInvite',
  'createCalendarConflictEvent',
]
// Mutating call sites that are deliberately NOT consequential agent actions.
// Each needs a reason; an entry that no longer matches anything fails the test,
// so this list cannot rot into a blanket suppression.
const CLASSIFIED_NON_CONSEQUENTIAL: Array<{ file: string; reason: string }> = [
  {
    file: 'push.ts',
    reason:
      'Expo push notification to the user\'s own device. Notifies, never acts on the user\'s behalf at a third party.',
  },
  {
    file: 'browser-handoff.ts',
    reason:
      'POSTs to the takeover control server inside the same sandbox (127.0.0.1). The consequential action, if any, is performed by the HUMAN driving that browser, not by Gogo.',
  },
]

const APPROVAL_ASSERTION = [
  /\.eq\(\s*'status'\s*,\s*'approved'\s*\)/,
  /status\s*!==\s*'approved'/,
  /approvalStatus\s*:\s*'approved'/,
]

type Site = { file: string; line: number; snippet: string; fn: string }

function read(file: string) {
  return fs.readFileSync(file, 'utf8')
}

function agentFiles() {
  return fs
    .readdirSync(AGENT_DIR)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => path.join(AGENT_DIR, f))
    .sort()
}

// Nearest enclosing function declaration at or above `line` (1-indexed).
function enclosingFunction(lines: string[], line: number): string {
  for (let i = line - 1; i >= 0; i--) {
    const m = lines[i].match(/^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/)
    if (m) return m[1]
    const c = lines[i].match(/^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/)
    if (c) return c[1]
  }
  return '<module scope>'
}

// Body of `fn` in `lines`: from its declaration to the next top-level declaration.
function functionBody(lines: string[], fn: string): string {
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    if (new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${fn}\\b`).test(lines[i])) {
      start = i
      break
    }
  }
  if (start < 0) return ''
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^(?:export\s+)?(?:async\s+)?function\s+/.test(lines[i]) || /^(?:export\s+)?const\s+\w+\s*=/.test(lines[i])) {
      end = i
      break
    }
  }
  return lines.slice(start, end).join('\n')
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(full)
  }
  return out
}

const allSourceFiles = SEARCH_ROOTS.flatMap((r) => walk(r))

// ── 1. Find every consequential mutation site in lib/agent ───────────────────
const sites: Site[] = []
const nonConsequentialHits = new Map<string, number>()

for (const file of agentFiles()) {
  const base = path.basename(file)
  const source = read(file)
  const lines = source.split('\n')

  const classified = CLASSIFIED_NON_CONSEQUENTIAL.find((c) => c.file === base)

  lines.forEach((text, idx) => {
    // A fetch and its `method:` often sit on different lines; look at a small window.
    const window = lines.slice(Math.max(0, idx - 3), idx + 1).join('\n')
    const isMutatingFetch = MUTATING_FETCH.test(text) && /fetch\(/.test(window)
    const helper = CONSEQUENTIAL_HELPERS.find(
      (h) => text.includes(`${h}(`) && !/^\s*(?:\/\/|\*|import|async function|export async function)/.test(text),
    )
    if (!isMutatingFetch && !helper) return

    if (classified) {
      nonConsequentialHits.set(base, (nonConsequentialHits.get(base) || 0) + 1)
      return
    }
    sites.push({
      file,
      line: idx + 1,
      snippet: text.trim().slice(0, 100),
      fn: enclosingFunction(lines, idx + 1),
    })
  })
}

// The secure browser's `submit` action kind is a consequential mutation performed
// through Playwright, not fetch, so its boundary is checked on its own terms: the
// planner emits `submit` only in execute mode (secure-computer.ts prompt rule), so
// the invariant is that EVERY module driving the secure computer in execute mode is
// itself gate-compliant. A module that merely records mode:'execute' into run
// metadata for a later approved run (appointment-followup.ts) is not driving it.
const browserExecuteDrivers: string[] = []
{
  const file = path.join(AGENT_DIR, 'secure-computer.ts')
  const lines = read(file).split('\n')
  if (!lines.some((l) => /a\.kind==='submit'/.test(l))) {
    console.error('✗ secure-computer.ts no longer has a submit action branch — update this test')
    process.exit(1)
  }
  for (const f of agentFiles()) {
    const src = read(f)
    const drivesBrowser = /from '\.\/secure-computer'/.test(src) || /executeBrowser\(/.test(src)
    if (!drivesBrowser) continue
    if (!/mode:\s*'execute'/.test(src)) continue
    browserExecuteDrivers.push(f)
  }
  if (browserExecuteDrivers.length === 0) {
    console.error('✗ no module drives the secure computer in execute mode — the detector has gone blind')
    process.exit(1)
  }
}

// ── 2. Prove each site is authorization-gated ────────────────────────────────
type Verdict = { site: Site; mechanism: string; detail: string } | { site: Site; mechanism: 'NONE'; detail: string }

const verdicts: Verdict[] = []

for (const site of sites) {
  const source = read(site.file)
  const lines = source.split('\n')

  if (source.includes(GATE_SYMBOL)) {
    const gateLine = lines.findIndex((l) => l.includes(`${GATE_SYMBOL}(`)) + 1
    verdicts.push({ site, mechanism: 'GATE', detail: `${site.file}:${gateLine} calls ${GATE_SYMBOL}` })
    continue
  }

  const body = functionBody(lines, site.fn)
  const approval = APPROVAL_ASSERTION.find((re) => re.test(body))
  if (approval) {
    const offset = body.split('\n').findIndex((l) => approval.test(l))
    const declLine = lines.findIndex((l) =>
      new RegExp(`^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${site.fn}\\b`).test(l),
    )
    verdicts.push({
      site,
      mechanism: 'APPROVAL',
      detail: `${site.file}:${declLine + offset + 1} asserts an approved agent_approvals row`,
    })
    continue
  }

  // MODULE-ENTRY: a helper that is private to its module (not exported) is reached
  // only through that module's exported entry point. If that entry asserts an
  // approved approval row, the helper inherits the boundary.
  const isExported = new RegExp(`^export\\s+(?:async\\s+)?function\\s+${site.fn}\\b`, 'm').test(source)
  if (!isExported) {
    const entry = lines.findIndex((l, i) =>
      /^export\s+(?:async\s+)?function\s+/.test(l) &&
      APPROVAL_ASSERTION.some((re) => re.test(functionBody(lines, l.match(/function\s+([A-Za-z0-9_]+)/)?.[1] || ''))),
    )
    if (entry >= 0) {
      const entryName = lines[entry].match(/function\s+([A-Za-z0-9_]+)/)?.[1]
      verdicts.push({
        site,
        mechanism: 'MODULE-ENTRY',
        detail: `private helper; reached only via ${site.file}:${entry + 1} ${entryName}(), which asserts an approved agent_approvals row`,
      })
      continue
    }
  }

  // CALLER: every module that references this function must itself be gated.
  const callers = allSourceFiles.filter(
    (f) => f !== site.file && new RegExp(`\\b${site.fn}\\b`).test(read(f)),
  )
  if (callers.length > 0 && callers.every((f) => read(f).includes(GATE_SYMBOL))) {
    verdicts.push({
      site,
      mechanism: 'CALLER',
      detail: `sole caller(s) gated: ${callers.map((c) => `${c}`).join(', ')}`,
    })
    continue
  }

  verdicts.push({
    site,
    mechanism: 'NONE',
    detail:
      callers.length === 0
        ? 'no caller found and no in-module gate or approval assertion'
        : `ungated caller(s): ${callers.filter((f) => !read(f).includes(GATE_SYMBOL)).join(', ')}`,
  })
}

// ── 3. Report ────────────────────────────────────────────────────────────────
console.log('Policy-gate coverage — consequential executors in lib/agent\n')

for (const v of verdicts) {
  const mark = v.mechanism === 'NONE' ? '✗' : '✓'
  console.log(`  ${mark} ${v.site.fn}  (${v.site.file}:${v.site.line})`)
  console.log(`      mutation : ${v.site.snippet}`)
  console.log(`      gated by : ${v.mechanism} — ${v.detail}`)
}

console.log('\n  Secure-browser submit (Playwright, not fetch) — modules driving execute mode:')
const ungatedDrivers = browserExecuteDrivers.filter((f) => !read(f).includes(GATE_SYMBOL))
for (const f of browserExecuteDrivers) {
  const gated = read(f).includes(GATE_SYMBOL)
  console.log(`    ${gated ? '✓' : '✗'} ${f}${gated ? ` — calls ${GATE_SYMBOL}` : ' — NO GATE'}`)
}

console.log('\n  Classified as non-consequential (mutating, but not an action taken for the user):')
for (const c of CLASSIFIED_NON_CONSEQUENTIAL) {
  const hits = nonConsequentialHits.get(c.file) || 0
  console.log(`    · ${c.file} (${hits} mutating call site${hits === 1 ? '' : 's'}) — ${c.reason}`)
}

// A stale exemption is a failure: it means the file changed and nobody re-read it.
const staleExemptions = CLASSIFIED_NON_CONSEQUENTIAL.filter((c) => !(nonConsequentialHits.get(c.file) > 0))
if (staleExemptions.length) {
  console.error(
    `\n✗ stale exemption(s): ${staleExemptions
      .map((s) => s.file)
      .join(', ')} no longer contains a mutating call site. Re-read the file and remove the entry.`,
  )
  process.exit(1)
}

if (ungatedDrivers.length) {
  console.error(`\n✗ module(s) drive the secure computer in execute mode without the policy gate: ${ungatedDrivers.join(', ')}`)
  process.exit(1)
}

const ungated = verdicts.filter((v) => v.mechanism === 'NONE')
if (ungated.length) {
  console.error('\n✗ consequential executor(s) with NO authorization boundary:')
  for (const u of ungated) console.error(`    ${u.site.file}:${u.site.line}  ${u.site.fn} — ${u.detail}`)
  console.error(
    '\n  Every consequential executor must be reachable only through the policy gate, an approved\n' +
      '  agent_approvals row, or a gated caller. Add one; do not widen this test.',
  )
  process.exit(1)
}

if (sites.length < 3) {
  console.error(`\n✗ only ${sites.length} consequential site(s) discovered — the detector has gone blind, not the codebase clean`)
  process.exit(1)
}

console.log(
  `\n✅ policy-gate coverage: ${sites.length} consequential executors + ${browserExecuteDrivers.length} secure-browser execute driver(s), all authorization-gated`,
)
