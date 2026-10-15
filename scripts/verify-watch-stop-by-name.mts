import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as priceThreshold from '../lib/agent/price-threshold'
// 14 Oct: on the dashboard, "stop watching Sony WH-1000XM5" was read as "stop the latest watch" and refused.
// The thing named after the verb is the watch to stop. Also: the dashboard runs the same watch handlers as WhatsApp.
// Run: npx tsx scripts/verify-watch-stop-by-name.mts
type Row = Record<string, any>
const stores: Record<string, Row[]> = { agent_watchers: [], agent_ideas: [] }
function makeDb() {
  return { from(table: string) {
    const b: any = { _f: [] as any[], _u: null as Row | null,
      select() { return b }, eq(c: string, v: any) { b._f.push([c, v]); return b }, order() { return b }, limit() { return b },
      contains() { return b }, range() { return b }, update(r: Row) { b._u = r; return b },
      maybeSingle: async () => one(), single: async () => one(), then: (res: any, rej: any) => Promise.resolve(many()).then(res, rej) }
    const hit = () => (stores[table] || []).filter(x => b._f.every(([c, v]: any) => String(x[c]) === String(v)))
    function one() { const rows = hit(); if (b._u) for (const r of rows) Object.assign(r, b._u); return { data: rows[0] || null, error: null } }
    function many() { const rows = hit(); if (b._u) for (const r of rows) Object.assign(r, b._u); return { data: rows, error: null } }
    return b
  } }
}
let typedContext: any = null
function load() {
  const code = ts.transpileModule(readFileSync(new URL('../lib/agent/watch-command.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mocks: Record<string, any> = {
    '@/lib/supabase-admin': { supabaseAdmin: makeDb() },
    './typed-object-context': { latestTypedContext: async () => typedContext, selectedTypedObject: () => null, rememberTypedObjects: async () => {} },
    './price-threshold': priceThreshold,
  }
  const out: any = {}
  runInNewContext(code, { exports: out, require: (n: string) => mocks[n] || {}, process: { env: {} }, Buffer, URL, console })
  return out
}
const wc = load()
const actor = { userId: 'u', legacyTelegramId: 42, whatsappId: '9', name: 'Gogo' }
function seed() {
  stores.agent_ideas = []
  stores.agent_watchers = [
    { id: 'w-trip', telegram_id: '42', type: 'web_search', active: true, created_at: '2026-10-14T10:00:00Z', condition_json: { title: 'Trip weather · Bengaluru', query: 'weather' } },
    { id: 'w-sony', telegram_id: '42', type: 'web_search', active: true, created_at: '2026-10-14T13:26:00Z', condition_json: { title: 'Sony WH-1000XM5 price below ₹25,000', query: 'the Sony WH-1000XM5 price in India below 25000' } },
    { id: 'w-iphone', telegram_id: '42', type: 'web_search', active: true, created_at: '2026-10-14T12:00:00Z', condition_json: { title: 'iPhone 15 Pro price below ₹80,000', query: 'iphone' } },
  ]
}
const active = () => stores.agent_watchers.filter(w => w.active).map(w => w.id).sort()

// The exact sentence from the dashboard.
seed()
const named = await wc.tryStopWatcherFromCommand({ actor, text: 'stop watching Sony WH-1000XM5' })
assert.ok(named && named.status === 'completed', `must stop it by name, got: ${named?.text}`)
assert.match(named.text, /Sony/)
assert.deepEqual(active(), ['w-iphone', 'w-trip'], 'only the Sony watch is stopped')

// Other phrasings of the same idea.
for (const text of ['stop watching the Sony WH-1000XM5', 'stop tracking Sony WH-1000XM5', 'cancel monitoring sony wh-1000xm5', 'stop watching my Sony WH-1000XM5 watch']) {
  seed()
  const r = await wc.tryStopWatcherFromCommand({ actor, text })
  assert.ok(r && r.status === 'completed', `"${text}" should stop the Sony watch, got: ${r?.text}`)
  assert.deepEqual(active(), ['w-iphone', 'w-trip'], text)
}

// A name that matches nothing is said plainly, and nothing is stopped.
seed()
const none = await wc.tryStopWatcherFromCommand({ actor, text: 'stop watching Pixel 9' })
assert.ok(none && none.status === 'paused' && /You don't have a watch for Pixel 9\. Your active watches:/.test(none.text), none?.text)
assert.equal(active().length, 3, 'nothing stopped when nothing matched')

// 15 Oct: the same full name saved twice (two Sony WH-1000XM5 watches) stops both and says so.
seed()
stores.agent_watchers.push({ id: 'w-sony2', telegram_id: '42', type: 'web_search', active: true, created_at: '2026-10-14T13:27:00Z', condition_json: { title: 'Sony WH-1000XM5 price below ₹22,000', query: 'x' } })
const two = await wc.tryStopWatcherFromCommand({ actor, text: 'stop watching Sony WH-1000XM5' })
assert.ok(two && two.status === 'completed' && two.text.startsWith('Stopped 2 Sony WH-1000XM5 watches.'), two?.text)
assert.deepEqual(active(), ['w-iphone', 'w-trip'])

// A one-word name shared by different products is listed by name, and nothing is stopped.
seed()
stores.agent_watchers.push({ id: 'w-tv', telegram_id: '42', type: 'web_search', active: true, created_at: '2026-10-14T13:28:00Z', condition_json: { title: 'Sony Bravia 55 price below ₹60,000', query: 'x' } })
const vague = await wc.tryStopWatcherFromCommand({ actor, text: 'stop watching Sony' })
assert.ok(vague && vague.status === 'paused' && /More than one watch matches/.test(vague.text) && vague.text.includes('Sony Bravia') && vague.text.includes('Sony WH-1000XM5'), vague?.text)
assert.equal(active().length, 4, 'ambiguous names stop nothing')

// 15 Oct: "drops below 20000" with no currency sign is a price alert too.
for (const [text, threshold] of [['Alert me when Sony WH-1000XM5 drops below 20000', '₹20000'], ['Alert me when Sony WH-1000XM5 drops below 20,000', '₹20,000']]) {
  const p = wc.parsePriceWatchCommand(text)
  assert.ok(p && p.product === 'Sony WH-1000XM5' && p.threshold === threshold, `${text} -> ${JSON.stringify(p)}`)
}
for (const text of ['Alert me when the temperature drops below 200', 'Alert me when it drops below 500', 'tell me when the flight fare drops below 5000']) assert.equal(wc.parsePriceWatchCommand(text), null, text)

// The old rules still hold: bare verb, "that / it / this" refer to the current list and never pick the latest silently; "all" stops all.
for (const text of ['stop watching', 'stop watching that', 'stop watching it', 'stop monitoring this']) {
  seed()
  const r = await wc.tryStopWatcherFromCommand({ actor, text })
  assert.ok(r && r.status === 'paused' && /Select the exact watcher/.test(r.text), `"${text}" must not pick one for the person`)
  assert.equal(active().length, 3, text)
}
seed()
const all = await wc.tryStopWatcherFromCommand({ actor, text: 'stop watching all' })
assert.ok(all && /Stopped 3/.test(all.text)); assert.equal(active().length, 0)

// Unrelated sentences are left alone.
for (const text of ['I was watching a movie', 'stop the music', 'what are you watching for me']) assert.equal(await wc.tryStopWatcherFromCommand({ actor, text }), null, text)

// The dashboard route runs the same watch handlers as WhatsApp, before the generic planner.
const route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
const price = route.indexOf('tryRunPriceWatchClarification({actor,surface:\'web\''), stop = route.indexOf('tryStopWatcherFromCommand({actor,text})'), planner = route.indexOf('tryRunGeneralPlan({')
assert.ok(price > 0 && stop > 0 && planner > price && planner > stop, 'price clarifier and stop-by-name run before the general planner')
console.log('verify-watch-stop-by-name: ok')
