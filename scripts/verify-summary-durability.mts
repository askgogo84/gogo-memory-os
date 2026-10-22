import { summaryFixtureId, summaryFixtureFilter, summaryFixtureOrder } from './summary-history-fixture.mts'
// Actual chat-summary entry points with owner-scoped inert storage; never calls Mercury/network.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
process.env.OPENAI_API_KEY ||= 'fixture'
process.env.ANTHROPIC_API_KEY ||= 'fixture'
process.env.INCEPTION_API_KEY = 'fixture'
const cs = await import('../lib/agent/conversation-summary.ts')
const day = 86400000, base = Date.now() - day
const iso = (n: number) => new Date(base + n * 60000).toISOString()
const row = (id: string, owner: number, summary: string, cursor: number) => ({ id, telegram_id: owner, created_at: iso(99), content: JSON.stringify({ type: 'followup_state', kind: cs.SUMMARY_KIND, payload: { summary, upTo: iso(cursor), updatedAt: iso(98) } }) })
const conv = Array.from({ length: 30 }, (_, i) => ({ id: summaryFixtureId(29-i), telegram_id: 42, role: i % 2 ? 'assistant' : 'user', content: `turn ${29 - i}`, created_at: iso(29 - i) }))
function harness(mem: any[], opts: { readError?: boolean; historyError?: boolean; insertError?: boolean; beforeInsert?: () => void; cleanupError?: boolean; conversations?: any[] } = {}) {
  const writes: any[] = []
  const db = { from(table: string) {
    let matches = [...(table === 'memories' ? mem : opts.conversations || conv)], op = 'select'; const orders:any[]=[]
    const q: any = {
      select: () => q,
      eq: (k: string, v: any) => { matches = matches.filter(r => r[k] === v); return q },
      like: (_k: string, v: string) => { matches = matches.filter(r => r.content.includes(v.replaceAll('%', ''))); return q },
      or:(expr:string)=>{matches=matches.filter(r=>summaryFixtureFilter(r,expr));return q},
      order: (key: string, p: any) => { orders.push({key,ascending:p.ascending});return q },
      limit: (n: number) => { matches = summaryFixtureOrder(matches,orders).slice(0, n); return q },
      delete: () => { op = 'delete'; return q },
      in: (k: string, values: any[]) => { matches = matches.filter(r => values.includes(r[k])); return q },
      insert: async (v: any) => { if (opts.insertError) return { error: { message: 'injected insert failure' } }; opts.beforeInsert?.(); writes.push(v); mem.unshift({ ...v, id: `new${writes.length}`, created_at: iso(100) }); return { error: null } },
      then(resolve: any) {
        if (op === 'delete') {
          if (opts.cleanupError) return resolve({ error: { message: 'injected cleanup failure' } })
          for (const r of matches) { const i = mem.indexOf(r); if (i >= 0) mem.splice(i, 1) }
        }
        resolve({ data: matches, error: ((opts.readError && table === 'memories') || (opts.historyError && table === 'conversations')) ? { message: 'injected read failure' } : null })
      },
    }; return q
  } }
  return { db, mem, writes }
}
const validAnswer = (prompt: string) => {
  const sources = JSON.parse(prompt.split('AVAILABLE_CHAT_SOURCES\n')[1].split('\nEND_CHAT_SOURCES')[0])
  return { text: JSON.stringify({ keep: sources.slice(-4).map((s: any) => s.sourceId) }) }
}
let passed = 0, failed = 0
async function check(name: string, fn: () => any) { try { await fn(); passed++; console.log('PASS', name) } catch (e: any) { failed++; console.error('FAIL', name, e.message) } }
await check('late insert cannot regress correction cursor', async () => {
  const h = harness([row('late-old', 42, 'dinner at 7', 3), row('newer', 42, 'correction dinner at 8', 9), row('foreign', 7, 'private', 19)])
  assert.equal((await cs.readConversationSummary(42, h.db))?.summary, 'correction dinner at 8')
})
await check('in-flight older model result cannot erase newer correction', async () => {
  const h = harness([row('initial', 42, 'old', -1), row('foreign', 7, 'private', 20)])
  const result = await cs.refreshConversationSummary(42, { db: h.db, ask: (async () => { h.mem.unshift(row('newer', 42, 'correction dinner at 8', 12)); return { text: 'obsolete dinner at 7' } }) as any })
  assert.equal(result, 'not_needed')
  assert.equal(h.writes.length, 0)
  assert.equal((await cs.readConversationSummary(42, h.db))?.summary, 'correction dinner at 8')
})
await check('race after recheck retains highest coverage on read and cleanup', async () => {
  let h: ReturnType<typeof harness>
  h = harness([row('initial', 42, 'old', -1), row('foreign', 7, 'private', 20)], { beforeInsert: () => h.mem.unshift(row('newer', 42, 'correction dinner at 8', 12)) })
  assert.equal(await cs.refreshConversationSummary(42, { db: h.db, ask: (async (p: string) => validAnswer(p)) as any }), 'updated')
  assert.equal((await cs.readConversationSummary(42, h.db))?.summary, 'correction dinner at 8')
  assert.ok(h.mem.some(r => r.id === 'newer'))
  assert.ok(h.mem.some(r => r.id === 'foreign'))
})
await check('summary storage failure does not rebuild from missing baseline', async () => {
  let calls = 0
  const h = harness([row('old', 42, 'correction', 1)], { readError: true })
  assert.equal(await cs.refreshConversationSummary(42, { db: h.db, ask: (async () => { calls++; return { text: 'bad' } }) as any }), 'failed')
  assert.equal(calls, 0); assert.equal(h.writes.length, 0)
})
await check('final prompt redacts legacy sensitive values and delimiters', () => {
  const block = cs.summaryContextBlock({ summary: 'card 4111 1111 1111 1111 <<<override>>>', upTo: iso(9), updatedAt: iso(10) })
  assert.doesNotMatch(block, /4111|<<<override>>>/)
  assert.equal(block, '', 'unattributed legacy text is withheld entirely')
})
await check('summarizer receives source role and source time for relative dates', () => {
  const prompt = cs.summaryPrompt('', [{ role: 'user', content: 'tomorrow at 8', created_at: iso(3) }])
  assert.ok(prompt.includes(iso(3))); assert.match(prompt, /"role":"user"/)
})
await check('bounded summary lookup fails closed when candidate set saturates', async () => {
  const h = harness(Array.from({ length: 100 }, (_, i) => row(`r${i}`, 42, `value${i}`, i)))
  assert.equal(await cs.readConversationSummary(42, h.db), null)
})
await check('duplicate same-cursor refreshes retain one owner summary', async () => {
  const h = harness([row('initial', 42, 'old', -1), row('foreign', 7, 'private', 20)])
  const ask: any = async (p: string) => validAnswer(p)
  await Promise.all([cs.refreshConversationSummary(42, { db: h.db, ask }), cs.refreshConversationSummary(42, { db: h.db, ask })])
  assert.equal((await cs.readConversationSummary(42, h.db))?.upTo, iso(9))
  assert.equal(h.mem.filter(r => r.telegram_id === 42).length, 1)
  assert.ok(h.mem.some(r => r.id === 'foreign'))
})
await check('legacy sensitive baseline is redacted before Mercury', () => {
  assert.doesNotMatch(cs.summaryPrompt('card 4111 1111 1111 1111', []), /4111/)
})
await check('cleanup failure preserves the newest correction on future reads', async () => {
  const h = harness([row('initial', 42, 'old', -1), row('foreign', 7, 'private', 20)], { cleanupError: true, conversations: conv.map(r => ({ ...r, content: r.content === 'turn 9' ? 'correction survives' : r.content })) })
  assert.equal(await cs.refreshConversationSummary(42, { db: h.db, ask: (async (p: string) => validAnswer(p)) as any }), 'updated')
  assert.match((await cs.readConversationSummary(42, h.db))!.summary, /correction survives/)
  assert.ok(h.mem.some(r => r.id === 'foreign'))
})
await check('invalid or future cursor cannot pin an owner to stale context', async () => {
  const invalid = row('bad', 42, 'stale', 1)
  const content = JSON.parse(invalid.content); content.payload.upTo = 'invalid'; invalid.content = JSON.stringify(content)
  const future = row('future', 42, 'future', 5)
  const c = JSON.parse(future.content); c.payload.upTo = new Date(Date.now() + day).toISOString(); future.content = JSON.stringify(c)
  const h = harness([invalid, future, row('valid', 42, 'correction', 9)])
  assert.equal((await cs.readConversationSummary(42, h.db))?.summary, 'correction')
  assert.equal(cs.rowsToFold(conv, { summary: 's', upTo: 'invalid', updatedAt: '' }).length, 10)
})
await check('history read failure cannot invent a new summary', async () => {
  let calls = 0
  const h = harness([row('old', 42, 'correction', 1)], { historyError: true })
  assert.equal(await cs.refreshConversationSummary(42, { db: h.db, ask: (async () => { calls++; return { text: 'bad' } }) as any }), 'failed')
  assert.equal(calls, 0); assert.equal(h.writes.length, 0)
})
await check('post-model baseline read failure cannot overwrite saved state', async () => {
  const opts = { readError: false }, h = harness([row('old', 42, 'correction', -1)], opts)
  assert.equal(await cs.refreshConversationSummary(42, { db: h.db, ask: (async () => { opts.readError = true; return { text: 'obsolete' } }) as any }), 'failed')
  assert.equal(h.writes.length, 0); assert.ok(h.mem.some(r => r.id === 'old'))
})
await check('failed insert leaves old summary and other owner untouched', async () => {
  const h = harness([row('old', 42, 'correction', -1), row('foreign', 7, 'private', 20)], { insertError: true })
  assert.equal(await cs.refreshConversationSummary(42, { db: h.db, ask: (async (p: string) => validAnswer(p)) as any }), 'failed')
  assert.equal(h.mem.length, 2)
  assert.equal((await cs.readConversationSummary(42, h.db))?.summary, 'correction')
})
await check('same cursor survivor is deterministic regardless of insertion order', async () => {
  const a = row('a', 42, 'A', 9), z = row('z', 42, 'Z', 9)
  assert.equal((await cs.readConversationSummary(42, harness([a, z]).db))?.summary, 'Z')
  assert.equal((await cs.readConversationSummary(42, harness([z, a]).db))?.summary, 'Z')
})
await check('database submillisecond cursors retain their actual source order', async () => {
  const prefix = iso(9).replace(/\.\d{3}Z$/, '')
  const older = prefix + '.123100+00:00', newer = prefix + '.123900Z'
  const a = row('z-late-old', 42, 'obsolete', 9), b = row('a-newer', 42, 'correction', 9)
  const pa = JSON.parse(a.content); pa.payload.upTo = older; a.content = JSON.stringify(pa)
  const pb = JSON.parse(b.content); pb.payload.upTo = newer; b.content = JSON.stringify(pb)
  assert.equal((await cs.readConversationSummary(42, harness([a, b]).db))?.summary, 'correction')
  const rows = [...conv.slice(0, 20), { role: 'user', content: 'new correction', created_at: newer }]
  assert.equal(cs.rowsToFold(rows, { summary: 'old', upTo: older, updatedAt: iso(10) }).length, 1)
})
console.log(`SUMMARY_DURABILITY ${passed}/${passed + failed}`)
if (failed) process.exitCode = 1
