// Spaces store (PR 2 of the approved plan): owner scoping with string ids (negative and > 2^53), create once per slug,
// compare-and-set versions (stale editors refused), every edit leaves a version row, invalid edits change nothing,
// missing table → spaces_not_enabled. Migration has RLS, no client grants, rollback drops only its two tables.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const st = await import('../lib/spaces/store')

function fakeDb(opts: { missing?: boolean } = {}) {
  const tables: Record<string, any[]> = { spaces: [], space_versions: [] }
  let n = 0
  const db = { from(t: string) {
    let op = 'select', val: any = null, single = false, order: [string, boolean] | null = null; const f: [string, any][] = []
    const run = () => {
      if (opts.missing) return { data: null, error: { code: '42P01', message: 'relation does not exist' } }
      let rows = tables[t].filter(r => f.every(([k, v]) => r[k] === v))
      if (op === 'insert') { const row = { id: `sp_${++n}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...structuredClone(val) }; tables[t].push(row); rows = [row] }
      if (op === 'update') rows.forEach(r => Object.assign(r, structuredClone(val)))
      if (order) rows = [...rows].sort((a, b) => (a[order![0]] > b[order![0]] ? 1 : -1) * (order![1] ? 1 : -1))
      return { data: single ? (rows[0] ? structuredClone(rows[0]) : null) : structuredClone(rows), error: null }
    }
    const q: any = { select: () => q, insert: (v: any) => { op = 'insert'; val = v; return q }, update: (v: any) => { op = 'update'; val = v; return q }, eq: (k: string, v: any) => { f.push([k, v]); return q }, order: (k: string, o: any) => { order = [k, o?.ascending !== false]; return q }, limit: () => q, maybeSingle: async () => { single = true; return run() }, then: (a: any, b: any) => Promise.resolve(run()).then(a, b) }
    return q
  } }
  return { db, tables }
}
const skills = (id: string) => (['merchant.order.accept', 'merchant.order.reject'].includes(id) ? { exactActionApproval: true } : null)
const ME = { kind: 'user' as const, telegramId: '-884501501' }
const OTHER = { kind: 'user' as const, telegramId: '9007199254740993' }

// 1. Create from template once; owner scoping by exact string id.
const { db, tables } = fakeDb()
const s = await st.createFromTemplate(db, ME, 'my_day', ME.telegramId, skills)
assert.equal(s.version, 1); assert.equal(tables.spaces[0].owner_telegram_id, '-884501501'); assert.equal(tables.spaces[0].workspace_id, null)
assert.equal(tables.space_versions.length, 1); assert.equal(tables.space_versions[0].change, 'created from my_day')
await assert.rejects(st.createFromTemplate(db, ME, 'my_day', ME.telegramId, skills), /exists/)
assert.equal(await st.getSpace(db, OTHER, 'my_day'), null, 'another owner cannot read it')
await st.createFromTemplate(db, OTHER, 'my_day', OTHER.telegramId, skills)
assert.equal(tables.spaces.find(r => r.owner_telegram_id === '9007199254740993')?.slug, 'my_day', '> 2^53 kept exact')
assert.deepEqual((await st.listSpaces(db, ME)).map(x => x.slug), ['my_day'])
console.log('✓ create once per owner+slug; exact string owners (negative, > 2^53); no cross-owner reads')

// 2. Edits: compare-and-set; stale editor refused; invalid edit changes nothing; each edit a version row.
const v2 = await st.applyEdit(db, ME, 'my_day', 1, { op: 'rename', title: 'Divya & me today' }, ME.telegramId, skills)
assert.equal(v2.version, 2); assert.equal(tables.space_versions.filter(v => v.space_id === v2.rowId).length, 2)
await assert.rejects(st.applyEdit(db, ME, 'my_day', 1, { op: 'set_refresh', minutes: 30 }, ME.telegramId, skills), /stale_version/)
await assert.rejects(st.applyEdit(db, ME, 'my_day', 2, { op: 'set_text', id: 'today', text: '<script>x</script>' }, ME.telegramId, skills), /invalid/)
assert.equal((await st.getSpace(db, ME, 'my_day'))!.version, 2, 'invalid edit saved nothing')
await assert.rejects(st.applyEdit(db, OTHER, 'my_day', 2, { op: 'rename', title: 'x' }, OTHER.telegramId, skills), /stale_version|not_found/, "another owner's edit never touches my Space")
assert.equal((await st.getSpace(db, ME, 'my_day'))!.title, 'Divya & me today')
const h = await st.spaceHistory(db, ME, 'my_day'); assert.deepEqual(h.map((x: any) => x.version), [2, 1])
console.log('✓ compare-and-set versions; stale and invalid edits refused; history per edit')

// 3. Workspace Spaces and a missing table.
const WS = { kind: 'workspace' as const, workspaceId: '7e1b6f4a-2c0d-4b58-9c3e-5a1f0d9b2e77' }
const t = await st.createFromTemplate(db, WS, 'tipplr_exceptions', ME.telegramId, skills); assert.equal(t.template, 'tipplr_exceptions')
assert.equal(tables.spaces.find(r => r.workspace_id === WS.workspaceId)?.owner_telegram_id, null)
await assert.rejects(st.listSpaces(fakeDb({ missing: true }).db, ME), /spaces_not_enabled/)
console.log('✓ workspace Spaces separate from user Spaces; missing table → spaces_not_enabled')

// 4. Migration shape.
const sql = readFileSync('supabase/migrations/20261108130000_gogo_spaces.sql', 'utf8')
for (const m of [/enable row level security/g]) assert.equal((sql.match(m) || []).length, 2)
assert.match(sql, /revoke all on public\.spaces from anon, authenticated/); assert.match(sql, /grant select, insert, update, delete on public\.spaces to service_role/)
assert.match(sql, /owner_telegram_id text/); assert.match(sql, /'\^-\?\[0-9\]\{1,20\}\$'/)
assert.ok(!/create policy/i.test(sql), 'no client policies')
const rb = readFileSync('supabase/migrations/20261108130000_gogo_spaces.rollback.sql', 'utf8')
assert.deepEqual(rb.match(/drop table[^;]*/g), ['drop table if exists public.space_versions', 'drop table if exists public.spaces'])
console.log('✓ migration: RLS on both tables, service_role only, text owner ids; rollback drops only these two')
console.log('Spaces store (8 Nov) checks passed')
