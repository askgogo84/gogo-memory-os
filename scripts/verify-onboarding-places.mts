// Onboarding home and office (approved screen 3, 5 Nov): asked once after the welcome, either can be skipped,
// answers saved through the same save-once path; a plain "nearby" question still only waits 15 minutes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'test'
process.env.SERPER_API_KEY ||= 'test'
const { supabaseAdmin } = await import('../lib/supabase-admin')
const pc = await import('../lib/agent/places-context')

const mem: any[] = [], act: any[] = []
let clock = Date.now()
const re = (v: string) => new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i')
function tq(rows: any[]) {
  const f: Array<(r: any) => boolean> = []; let op = 'select', ins: any = null
  const b: any = {
    select() { return b }, insert(r: any) { op = 'insert'; ins = r; return b }, delete() { op = 'delete'; return b },
    eq(k: string, v: any) { if (k === 'telegram_id') assert.equal(typeof v, 'string'); f.push(r => r[k] === v); return b },
    neq(k: string, v: any) { f.push(r => r[k] !== v); return b }, in(k: string, vs: any[]) { f.push(r => vs.includes(r[k])); return b },
    gte(k: string, v: any) { f.push(r => r[k] >= v); return b }, ilike(k: string, v: string) { const x = re(v); f.push(r => x.test(r[k])); return b },
    or(expr: string) { const xs = expr.split(',').map(e => re(e.replace(/^content\.ilike\./, ''))); f.push(r => xs.some(x => x.test(r.content || ''))); return b },
    order() { return b }, limit() { return b }, single() { return b },
    then(res: any, rej: any) {
      let out: any
      if (op === 'insert') { clock += 1000; const r = { id: `r${rows.length + 1}`, created_at: new Date(clock).toISOString(), ...ins }; rows.push(r); out = { data: { id: r.id }, error: null } }
      else if (op === 'delete') { for (const r of rows.filter(r => f.every(fn => fn(r)))) rows.splice(rows.indexOf(r), 1); out = { data: null, error: null } }
      else out = { data: rows.filter(r => f.every(fn => fn(r))).sort((a, b2) => b2.created_at.localeCompare(a.created_at)), error: null }
      return Promise.resolve(out).then(res, rej)
    },
  }
  return b
}
;(supabaseAdmin as any).from = (t: string) => t === 'memories' ? tq(mem) : t === 'agent_activity' ? tq(act) : tq([])
const fakeFetch: any = async () => ({ ok: true, json: async () => ({ places: [] }) })
const say = (tg: string, text: string) => pc.tryPlaceCommand({ telegramId: tg, text }, fakeFetch)

// Full path: home, then office.
const A = '918884501501'
assert.equal(await pc.startPlaceOnboarding(A), pc.ONBOARD_HOME_Q)
assert.match(pc.ONBOARD_HOME_Q, /1 of 2 · Where's home\?/); assert.match(pc.ONBOARD_HOME_Q, /Say \*later\* to skip/)
assert.equal(await say(A, 'ok'), null, '"ok" is not an area')
assert.equal(await say(A, 'call mom'), null, 'a command is not an area')
assert.equal(await say(A, 'Rajajinagar 560086'), `Saved your home: Rajajinagar.\n\n${pc.ONBOARD_OFFICE_Q}`)
const done = String(await say(A, 'Whitefield'))
assert.match(done, /^Saved\. Home: Rajajinagar · Office: Whitefield\. I won't ask again\./)
assert.deepEqual(mem.filter(r => r.telegram_id === A).map(r => r.content).sort(), ['Home area: Rajajinagar (560086)', 'Office area: Whitefield'])
assert.equal(await say(A, 'Malleshwaram'), null, 'nothing pending after onboarding')
assert.equal(await pc.startPlaceOnboarding(A), null, 'never asked again once home is saved')
console.log('✓ home then office, saved once each, never asked again')

// Skip both.
const B = '919999999999'
await pc.startPlaceOnboarding(B)
assert.match(String(await say(B, 'later')), /^No problem, I'll ask the first time you need it\.\n\n\*2 of 2 · And work\?\*/)
assert.match(String(await say(B, 'I work from home')), /^Saved\. I won't ask again\./)
assert.equal(mem.filter(r => r.telegram_id === B).length, 0)
assert.equal(await say(B, 'later'), null, 'a later "later" is ordinary chat')
// A statement during onboarding counts as the answer.
const C = '917777777777'
await pc.startPlaceOnboarding(C)
assert.match(String(await say(C, 'I live in HSR Layout')), /^Saved your home: HSR Layout\.\n\n\*2 of 2/)
console.log('✓ either step can be skipped; "I live in …" also answers; nothing pending afterwards')

// A plain nearby question waits only 15 minutes; onboarding waits a day.
const D = '916666666666'
act.push({ id: 'old', telegram_id: D, event_type: 'nearby_area_asked', metadata_json: { text: 'find pizza nearby', kind: 'home', onboarding: false }, created_at: new Date(Date.now() - 30 * 60_000).toISOString() })
assert.equal(await say(D, 'Indiranagar'), null, 'a 30-minute-old nearby question has expired')
const E = '915555555555'
act.push({ id: 'old2', telegram_id: E, event_type: 'nearby_area_asked', metadata_json: { text: '', kind: 'home', onboarding: true }, created_at: new Date(Date.now() - 3 * 3600_000).toISOString() })
assert.match(String(await say(E, 'Indiranagar')), /^Saved your home: Indiranagar\./, 'a 3-hour-old onboarding question is still open')
console.log('✓ nearby questions expire after 15 minutes; onboarding stays open a day')

const wa = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.equal((wa.match(/await askHomeOnce\(resolvedUser\.telegramId, from\)/g) || []).length, 2, 'asked after the welcome (new user greeting and invite join)')
assert.match(wa, /m\.startPlaceOnboarding\?\.\(String\(telegramId\)\)/)
console.log('✓ wired after both welcome paths')
console.log('Onboarding places checks passed')
