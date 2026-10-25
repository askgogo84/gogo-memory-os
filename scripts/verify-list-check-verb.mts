import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { classifyCheckVerb } from '../lib/data/lists-core'
import { parseFlightIdentifier } from '../lib/agent/watch-command'

// Permanent regression cases. Every past routing hijack gets a line here.
// "check X" is a list command only when X looks like a LIST ITEM.

// MUST NOT be claimed as a list command:
for (const text of [
  "check what's playing at pvr forum mall this weekend and get me the showtimes",
  'check when the next train to mysuru leaves',
  'check https://in.bookmyshow.com/explore/movies-bengaluru',
  'check the weather in bangalore',
  'check seat availability on the vande bharat',
  'check how much the flight to delhi costs',
  'check the score of the rcb match',
  'check my mails',
  'check my mail',
  'check my emails',
  'check my email',
  'check my inbox',
]) {
  assert.equal(classifyCheckVerb(text), null, `must not be a list command: ${text}`)
}

// MUST still be claimed - real list items:
for (const text of ['check milk', 'check passport', 'check power bank', 'tick eggs', 'mark sunscreen']) {
  assert.equal(classifyCheckVerb(text), 'list_check', `must be a list command: ${text}`)
}

// uncheck stays uncheck, prefix-anchored:
assert.equal(classifyCheckVerb('uncheck milk'), 'list_uncheck')
assert.equal(classifyCheckVerb('untick eggs'), 'list_uncheck')

console.log('list check-verb regression passed')

// ── Paused-train routing hijack (production 28 Sep 2026) ──────────────────────
// isTrainDeviceHandoffFollowup treated ANY bare 5-digit number as a reply to a paused
// IRCTC device handoff. "...drops below 22000" matched on "22000", so tryRunTrainResearch
// claimed the message and replayed the device-handoff text; the price watcher was never
// created. Eight armed runs sat in status='paused'/state='waiting_for_user', so this
// swallowed every message containing a price, amount or PIN for ~12 days.
//
// We exercise the ACTUAL ROUTING PATH (tryRunTrainResearch) with a mocked paused run,
// not just the regex helper, so a drift between the guard and the router cannot hide.

let pausedRun: any = null
const dbWrites: Array<{ table: string; op: string }> = []
const db = {
  from: (table: string) => {
    const q: any = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      single: async () => ({ data: null, error: null }),
      insert: () => { dbWrites.push({ table, op: 'insert' }); return q },
      update: () => { dbWrites.push({ table, op: 'update' }); return q },
      maybeSingle: async () => ({ data: table === 'agent_runs' ? pausedRun : null, error: null }),
      then: (resolve: any) => Promise.resolve({ data: null, count: 0, error: null }).then(resolve),
    }
    return q
  },
}

function loadTrainResearch() {
  const source = readFileSync(new URL('../lib/agent/train-research.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mocks: Record<string, any> = {
    '@anthropic-ai/sdk': { default: class { messages = { create: async () => ({ content: [{ type: 'text', text: '[]' }] }) } } },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    './secure-computer': { runSecureBrowser: async () => ({ status: 'blocked', blockReason: 'provider_access_limited', url: '' }) },
    './browser-handoff': { readBrowserHandoffState: async () => ({ url: '', title: '', text: '' }), continueBrowserHandoffResearch: async () => ({ state: { url: '', title: '', text: '' } }) },
    './provider-browser-handoff': { startProviderBrowserHandoff: async () => ({}), cancelProviderBrowserHandoff: async () => {}, cancelBrowserHandoffReservation: async () => {} },
  }
  const exportsObj: any = {}
  runInNewContext(code, { exports: exportsObj, require: (name: string) => mocks[name] || {}, process: { env: {} }, Buffer, URL, console })
  return exportsObj
}

const train = loadTrainResearch()
const actor = { userId: 'user', legacyTelegramId: 1 }
const freshRun = () => ({
  id: 'run-1',
  status: 'paused',
  updated_at: new Date().toISOString(),
  metadata_json: {
    state: 'waiting_for_user',
    handoff: { mode: 'device' },
    context: { date: '2026-10-05', routeLabel: 'SBC → MYS', from: { label: 'Bengaluru' }, to: { label: 'Mysuru' } },
  },
})

// A price watch must NOT be claimed, even with a paused waiting_for_user run present.
pausedRun = freshRun()
dbWrites.length = 0
assert.equal(
  await train.tryRunTrainResearch({ actor, surface: 'whatsapp', text: 'Watch the price of the Sony WH-1000XM5 on amazon.in and tell me if it drops below 22000' }),
  null,
  'the exact production hijack: a price watch must not be swallowed by a paused train task',
)
assert.equal(dbWrites.length, 0, 'a non-train message must not touch the DB')

// A bare train number, and a train-worded reply, STILL resume the paused handoff.
for (const text of ['12614', 'train 12614']) {
  pausedRun = freshRun()
  dbWrites.length = 0
  const result = await train.tryRunTrainResearch({ actor, surface: 'whatsapp', text })
  assert.ok(result && result.status === 'paused' && result.handledBy === 'train-device-handoff', `"${text}" must stay a train device-handoff follow-up`)
}

// Price / amount / PIN messages must NOT be claimed.
for (const text of ['my pin is 56001', 'it costs 45000']) {
  pausedRun = freshRun()
  dbWrites.length = 0
  assert.equal(await train.tryRunTrainResearch({ actor, surface: 'whatsapp', text }), null, `"${text}" must not be claimed by a paused train task`)
  assert.equal(dbWrites.length, 0, `"${text}" must not touch the DB`)
}

// A device handoff older than 4h returns control to normal routing SILENTLY:
// no message is claimed and no DB record is closed, cancelled or modified.
pausedRun = { ...freshRun(), updated_at: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString() }
dbWrites.length = 0
assert.equal(await train.tryRunTrainResearch({ actor, surface: 'whatsapp', text: '12614' }), null, 'an expired (>4h) device handoff must not capture a follow-up message')
assert.equal(dbWrites.length, 0, 'an expired handoff must not close, cancel or modify any record')

console.log('paused-train routing hijack regression passed')

// ── Flight-watch identifier hijack (same product-code family) ─────────────────
// parseFlightIdentifier read "22000" as flight "220 00" and would read model codes
// like WH-1000XM5 as a flight during a pending flight-watch follow-up. Same adjacency
// + longer-token rule: a bare 5+ digit / price-adjacent token is never a flight.
assert.equal(parseFlightIdentifier('Watch the price of the Sony WH-1000XM5 on amazon.in and tell me if it drops below 22000'), null)
assert.equal(parseFlightIdentifier('it costs 45000'), null)
assert.equal(parseFlightIdentifier('my pin is 56001'), null)
// Real flight identifiers still parse:
assert.equal(parseFlightIdentifier('Air India AI 101')?.flightNumber, 'AI 101')
assert.equal(parseFlightIdentifier('IndiGo 6E 203')?.flightNumber, '6E 203')

console.log('flight identifier hijack regression passed')
