// Owner-run (after the pilot migration): seeds the Tipplr workspace with the synthetic world. Idempotent: deletes and
// re-inserts only the pilot's own tables for that workspace. Needs SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL
// in the environment and TIPPLR_PILOT_WORKSPACE_ID (a public.workspaces row named Tipplr). Never touches consumer tables.
import { createClient } from '@supabase/supabase-js'
import { buildWorld } from '../lib/enterprise/tipplr/synthetic'
import { worldToRows } from '../lib/enterprise/tipplr/supabase-adapter'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY, ws = process.env.TIPPLR_PILOT_WORKSPACE_ID
if (!url || !key || !ws) { console.error('Set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and TIPPLR_PILOT_WORKSPACE_ID'); process.exit(1) }
const db = createClient(url, key, { auth: { persistSession: false } })
const { data: wsRow, error: wsErr } = await db.from('workspaces').select('id,name').eq('id', ws).maybeSingle()
if (wsErr || !wsRow) { console.error('workspace not found:', wsErr?.message || ws); process.exit(1) }
const rows = worldToRows(buildWorld(ws, Date.now()))
const del = await db.from('merchant_outlets').delete().eq('workspace_id', ws)
if (del.error) { console.error('delete failed (migration run?):', del.error.message); process.exit(1) }
for (const [table, data] of Object.entries(rows)) {
  for (let i = 0; i < data.length; i += 500) {
    const { error } = await db.from(table).insert(data.slice(i, i + 500))
    if (error) { console.error(`${table} insert failed:`, error.message); process.exit(1) }
  }
  console.log(`${table}: ${data.length} rows`)
}
console.log(`Seeded workspace "${wsRow.name}" (${ws}).`)
