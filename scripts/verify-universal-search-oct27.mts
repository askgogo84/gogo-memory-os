// Perisclaw-style source-linked search (27 Oct): one question across chat, documents, notes, Gmail and Drive.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const u = await import('../lib/agent/universal-search')

assert.equal(u.parseUniversalSearch('Find everything about Toastr'), 'Toastr')
assert.equal(u.parseUniversalSearch('search everything for Meghana Foods'), 'Meghana Foods')
assert.equal(u.parseUniversalSearch('show me everything on the ONDC launch?'), 'ONDC launch')
assert.equal(u.parseUniversalSearch('everything I have about Nithin'), 'Nithin')
for (const t of ['find my passport', 'search flights to Delhi', 'everything is fine', 'remind me about Toastr']) assert.equal(u.parseUniversalSearch(t), null, t)

// Fake database: records the owner filter on every table; returns one row per table.
const seen: string[] = []
const db = { from(table: string) {
  const q: any = { _owner: null as any,
    select() { return q }, eq(k: string, v: any) { if (k === 'telegram_id') q._owner = v; return q }, gte() { return q }, ilike() { return q }, or() { return q }, order() { return q },
    limit() { seen.push(`${table}:${q._owner}`); const rows: any = { conversations: [{ role: 'user', content: 'Send the mail to Toastr from my email', created_at: '2026-10-26T16:55:00Z' }],
      documents: [{ id: 'd1', title: 'Toastr partnership notes', created_at: '2026-10-26T17:00:00Z' }], memories: [] }[table] || []
      return Promise.resolve({ data: rows, error: null }) } }
  return q } }
const actor: any = { legacyTelegramId: 4242 }
const results = await u.runUniversalSearch(actor, 'Toastr', { db,
  gmail: async () => [{ subject: 'Partnership: Toastr price comparison inside AskGogo', from: '"Goverdhan" <g@x.in>', date: '2026-10-26T16:55:00Z', threadId: '1a17923a8e05ec9b', snippet: 'Hi Aman, congrats on 1.2M carts' }],
  drive: async () => { throw new Error('workspace_not_connected') } })
assert.deepEqual(seen.sort(), ['conversations:4242', 'documents:4242', 'memories:4242'], 'every table query is scoped to this owner')
const text = u.formatUniversalSearch('Toastr', results)
assert.match(text, /\*Gmail\*\n• Partnership: Toastr price comparison inside AskGogo — Goverdhan · 26 Oct/)
assert.match(text, /https:\/\/mail\.google\.com\/mail\/u\/0\/#all\/1a17923a8e05ec9b/)
assert.match(text, /\*Saved documents\*\n• Toastr partnership notes/)
assert.match(text, /No matches in: Notes and memories\./)
assert.match(text, /Not searched: Google Drive \(not connected\)\./, 'a missing source is named, never dropped')
// A slow source becomes "too slow just now" instead of holding the reply.
const slow = await u.runUniversalSearch(actor, 'x', { db, gmail: () => new Promise(() => {}), drive: async () => [] })
assert.equal(slow.find(r => r.source === 'gmail')?.error, 'timeout')
assert.match(u.formatUniversalSearch('nothing', [{ source: 'chat', hits: [] }]), /Nothing found for “nothing”\./)

// Wiring: lazy, gated, on both surfaces.
const bridge = readFileSync('lib/agent/whatsapp-bridge.ts', 'utf8'), route = readFileSync('app/api/dashboard/chat/route.ts', 'utf8')
assert.match(bridge, /await import\('\.\/universal-search'\)/)
assert.match(route, /await import\('@\/lib\/agent\/universal-search'\)/)
assert.doesNotMatch(route, /^import .*universal-search/m)
// Drive: only files whose name carries the search words (not full-text hits inside archives).
const driveOnly = await u.runUniversalSearch(actor, 'Toastr', { db, gmail: async () => [],
  drive: async () => [{ name: 'RepuLink-master.zip', modifiedTime: '2018-05-08T00:00:00Z', webViewLink: 'https://drive.google.com/file/d/a/view' }, { name: 'Toastr partnership deck', modifiedTime: '2026-10-26T00:00:00Z', webViewLink: 'https://docs.google.com/presentation/d/b' }] })
assert.deepEqual(driveOnly.find(r => r.source === 'drive')!.hits.map(h => h.title), ['Toastr partnership deck'])
// 27 Oct live: the same "nag me about the invoice" message was listed twice and a notes hit was raw JSON state.
const dupDb = { from(table: string) { const q: any = { select() { return q }, eq() { return q }, gte() { return q }, ilike() { return q }, or() { return q }, order() { return q },
  limit() { const rows: any = { conversations: [{ content: '"nag me about the invoice every 2 hours until done"', created_at: '2026-07-16T10:00:00Z' }, { content: '"nag me about the invoice every 2 hours until done"', created_at: '2026-07-16T09:00:00Z' },
    { content: '1) All Shareholders Documents a) passport copy b) residence visa copy c) EmiratesID d) CV or personal profile e) bank statements f) proof of address g) the signed invoice for the setup fee', created_at: '2026-08-16T10:00:00Z' }],
    memories: [{ content: '{"type":"followup_state","payload":{"invoice":1}}', created_at: '2026-05-14T00:00:00Z' }, { content: 'Divya sends the invoice on the 5th', created_at: '2026-05-10T00:00:00Z' }] }[table] || []
    return Promise.resolve({ data: rows, error: null }) } }; return q } }
const dup = await u.runUniversalSearch(actor, 'invoice', { db: dupDb, gmail: async () => [], drive: async () => [] })
const chatHits = dup.find(r => r.source === 'chat')!.hits.map(h => h.title)
assert.equal(chatHits.length, 2, chatHits.join('\n'))
assert.equal(chatHits[0], 'You said: “nag me about the invoice every 2 hours until done”')
assert.match(chatHits[1], /^You said: “….*signed invoice for the setup fee”$/, 'long message shows the part around the word')
assert.deepEqual(dup.find(r => r.source === 'notes')!.hits.map(h => h.title), ['Divya sends the invoice on the 5th'], 'JSON state rows are not notes')
console.log('Universal search passed')
