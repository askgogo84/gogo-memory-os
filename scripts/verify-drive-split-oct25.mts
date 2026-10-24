// 25 Oct live test regressions. Offline, in-memory DB.
// 1) "Find my latest document in Drive" was answered by saved-asset retrieval instead of the Drive reader.
// 2) "Add expense 500 dinner paid by me split with Nithin" went into an old "Split 18 Oct" group with Person 2/3/4.
// Run: npx tsx scripts/verify-drive-split-oct25.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://synthetic.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'synthetic'
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY || 'synthetic'

// ── 1. Drive asks never go to saved-asset retrieval ───────────────────────────
const asset = await import('../lib/services/asset-natural-retrieval')
for (const t of ['Find my latest document in Drive', 'search my google drive for the invoice', 'find the lease document in my gmail', 'show my drive files', 'Open the budget sheet from Google Sheets'])
  assert.equal(asset.shouldAttemptNaturalAssetRetrieval(t), false, `external source: ${t}`)
for (const t of ['find my passport', 'show me Jopasu Dashboard & Tyre Polish', 'send me my rental agreement'])
  assert.equal(asset.shouldAttemptNaturalAssetRetrieval(t), true, `saved asset still retrievable: ${t}`)
const brain = readFileSync('lib/agent/same-brain.ts', 'utf8')
assert.match(brain, /in drive/, 'the Drive reader claims "in Drive" asks')
const driveCtx = await import('../lib/agent/workspace-drive-context')
const plain = await import('../lib/agent/plain-question')
const ask = 'Find my latest document in Drive'
assert.equal(plain.isPlainInfoQuestion(ask), false, 'the WhatsApp agent is not skipped for this ask')
assert.equal(driveCtx.isWorkspaceDriveContextRequest(ask), true, 'the WhatsApp agent claims it for Drive')
const pick = driveCtx.selectWorkspaceDriveFile([{ id: 'a', name: 'Old notes', mimeType: 'text/plain', modifiedTime: '2026-09-01T00:00:00Z' }, { id: 'b', name: 'Q4 plan', mimeType: 'text/plain', modifiedTime: '2026-10-24T00:00:00Z' }] as any, ask)
assert.equal(pick.status === 'selected' && pick.file.id, 'b', '"latest" picks the most recently modified Drive file')

// ── 2. Named-people splits get their own group ────────────────────────────────
type Row = Record<string, any>
const db: Record<string, Row[]> = { split_groups: [], split_group_members: [], split_expenses: [], split_expense_shares: [], split_settlements: [] }
let seq = 0, clock = 0
const fake = { from(table: string) {
  const f: Array<(r: Row) => boolean> = []; let op: 'select' | 'insert' | 'update' | 'upsert' = 'select'; let payload: any = null; let order: [string, boolean] | null = null; let lim = Infinity; let single = false
  const rows = () => { let out = (db[table] ||= []).filter(r => f.every(fn => fn(r))); if (order) { const [k, asc] = order; out = [...out].sort((a, b) => (a[k] > b[k] ? 1 : -1) * (asc ? 1 : -1)) } return out.slice(0, lim) }
  const run = () => {
    if (op === 'insert' || op === 'upsert') {
      const list = (Array.isArray(payload) ? payload : [payload]).map((r: Row) => ({ id: `id${++seq}`, created_at: new Date(++clock * 1000).toISOString(), updated_at: new Date(clock * 1000).toISOString(), ...r }))
      for (const r of list) {
        if (op === 'upsert' && table === 'split_group_members' && (db[table] ||= []).some(x => x.group_id === r.group_id && x.name === r.name)) continue
        (db[table] ||= []).push(r)
      }
      return { data: single ? list[0] : list, error: null }
    }
    if (op === 'update') { for (const r of rows()) Object.assign(r, payload, payload.updated_at ? { updated_at: new Date(++clock * 1000).toISOString() } : {}); return { data: null, error: null } }
    const out = rows(); return { data: single ? out[0] || null : out, error: null }
  }
  const q: any = {
    select: () => q, insert: (p: any) => { op = 'insert'; payload = p; return q }, upsert: (p: any) => { op = 'upsert'; payload = p; return q }, update: (p: any) => { op = 'update'; payload = p; return q },
    eq: (k: string, v: any) => { f.push(r => String(r[k]) === String(v)); return q },
    ilike: (k: string, v: string) => { const re = new RegExp('^' + v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*') + '$', 'i'); f.push(r => re.test(String(r[k] || ''))); return q },
    or: (expr: string) => { const phone = expr.match(/owner_phone\.eq\.([^,]+)/)?.[1]; const ids = (expr.match(/id\.in\.\(([^)]*)\)/)?.[1] || '').split(','); f.push(r => r.owner_phone === phone || ids.includes(r.id)); return q },
    order: (k: string, o: any) => { order = [k, o?.ascending !== false]; return q }, limit: (n: number) => { lim = n; return q },
    single: () => { single = true; return Promise.resolve(run()) }, maybeSingle: () => { single = true; return Promise.resolve(run()) },
    then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
  }
  return q
} }
const deps: any = { '@/lib/supabase-admin': { supabaseAdmin: fake }, '@/lib/channels/whatsapp': { sendWhatsAppMessage: async () => ({}) } }
function load(path: string): any {
  const exports: any = {}
  const req = (n: string) => deps[n] || deps[n.replace('./', '@/lib/splitwise/')] || (() => { throw new Error('dep ' + n) })()
  runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: req, console, process, Date, Math, Number, String, Array, Set, Map, Object, JSON, Promise, RegExp, Intl, encodeURIComponent, URLSearchParams })
  return exports
}
deps['@/lib/splitwise/split-parser'] = load('lib/splitwise/split-parser.ts')
deps['@/lib/splitwise/simplify-debts'] = load('lib/splitwise/simplify-debts.ts')
const S = load('lib/splitwise/split-service.ts')
const PHONE = '+918884501501'

assert.equal(S.namedPeopleGroupName(['Me', 'Nithin']), 'With Nithin')
assert.equal(S.namedPeopleGroupName(['Me', 'Person 2', 'Person 3']), null, 'head-count splits keep their own naming')

// The live state: an old quick split with Person 2/3/4 is the latest group.
await S.handleSplitCommand(PHONE, 'Split 1200 dinner among 4 people')
const old = db.split_groups.at(-1)!
assert.match(old.name, /^Split /)
await S.handleSplitCommand(PHONE, 'Add expense 500 dinner paid by me split with Nithin')
const nithinExpense = db.split_expenses.at(-1)!
const nithinGroup = db.split_groups.find(g => g.id === nithinExpense.group_id)!
assert.equal(nithinGroup.name, 'With Nithin', 'Nithin split goes to its own group, not the Person 2/3/4 split')
assert.ok(!db.split_expense_shares.some(s => s.expense_id === nithinExpense.id && /^Person/.test(s.member_name)), 'no Person N shares on the Nithin expense')
// The same people again reuse that group.
await S.handleSplitCommand(PHONE, 'Add expense 300 coffee paid by me split with Nithin')
assert.equal(db.split_expenses.at(-1)!.group_id, nithinGroup.id, 'same people reuse "With Nithin"')
// A trip group that already has everyone named still gets the expense.
await S.handleSplitCommand(PHONE, 'Create trip Goa with Divya, Nithin')
const goa = db.split_groups.find(g => /goa/i.test(g.name))!
await S.handleSplitCommand(PHONE, 'Add expense 2400 hotel paid by me split with Divya, Nithin')
assert.equal(db.split_expenses.at(-1)!.group_id, goa.id, 'latest group with all named people keeps the expense')
// An explicit group name always wins.
await S.handleSplitCommand(PHONE, 'Add expense 100 snacks paid by me in Goa split with Divya')
assert.equal(db.split_expenses.at(-1)!.group_id, goa.id)
console.log('Drive asks reach the Drive reader; named-people splits never land in an unrelated group')
