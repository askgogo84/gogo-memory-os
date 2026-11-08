import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveActionRecord } from '@/lib/agent/action-record'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Tipplr ops pilot — Meta Cloud API webhook (phase 3, 7 Nov). GET = Meta's handshake; POST = taps and texts from
// merchants (matched to an outlet by number) and from the ops number. Signature checked before anything is read.
// 503 until the pilot migration is run and TIPPLR_PILOT_WORKSPACE_ID is set.
export async function GET(request: Request) {
  const { verifyHandshake } = await import('@/lib/enterprise/tipplr/meta-whatsapp')
  const challenge = verifyHandshake(new URL(request.url).searchParams, process.env.META_WA_VERIFY_TOKEN)
  return challenge ? new Response(challenge, { status: 200 }) : NextResponse.json({ error: 'forbidden' }, { status: 403 })
}

const pendingStore = (db: any) => ({
  async get() { const { data } = await db.from('agent_activity').select('id,metadata_json').eq('telegram_id', 'tipplr-ops').eq('event_type', 'tipplr_ops_pending').order('created_at', { ascending: false }).limit(1); const row = data?.[0]; return row?.metadata_json?.open ? row.metadata_json.pending : null },
  async set(p: any) { if (p) await db.from('agent_activity').insert({ telegram_id: 'tipplr-ops', event_type: 'tipplr_ops_pending', message: 'offers', metadata_json: { open: true, pending: p } }); else { const { data } = await db.from('agent_activity').select('id').eq('telegram_id', 'tipplr-ops').eq('event_type', 'tipplr_ops_pending').order('created_at', { ascending: false }).limit(1); if (data?.[0]) await db.from('agent_activity').update({ metadata_json: { open: false } }).eq('id', data[0].id) } },
})

export async function POST(request: Request) {
  const raw = await request.text()
  const wa = await import('@/lib/enterprise/tipplr/meta-whatsapp')
  if (!wa.verifySignature(raw, request.headers.get('x-hub-signature-256'), process.env.META_WA_APP_SECRET)) return NextResponse.json({ error: 'bad_signature' }, { status: 401 })
  const workspaceId = process.env.TIPPLR_PILOT_WORKSPACE_ID
  if (!workspaceId) return NextResponse.json({ error: 'pilot_not_configured' }, { status: 503 })
  let body: any; try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }) }
  const inbound = wa.parseInbound(body)
  if (!inbound.length) return NextResponse.json({ ok: true, ignored: true })
  try {
    const [{ SupabaseAdapter }, { SupabaseScheduleStore }, { handleMerchantInput }, { handleOpsInput }] = await Promise.all([
      import('@/lib/enterprise/tipplr/supabase-adapter'), import('@/lib/enterprise/tipplr/schedules'), import('@/lib/enterprise/tipplr/actions'), import('@/lib/enterprise/tipplr/digest')])
    const adapter = new SupabaseAdapter(supabaseAdmin, workspaceId)
    const store = new SupabaseScheduleStore(supabaseAdmin)
    const persist = (rec: any) => saveActionRecord(supabaseAdmin, rec)
    const opsNumbers = String(process.env.TIPPLR_PILOT_OPS_NUMBERS || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean)
    for (const msg of inbound) {
      if (!(await wa.claimInbound(supabaseAdmin, msg.messageId, msg.from))) continue
      const isOps = opsNumbers.some(n => n.slice(-10) === msg.from.slice(-10))
      const reply = isOps
        ? await handleOpsInput(adapter, store, msg.text, wa.sendViaMeta, pendingStore(supabaseAdmin), persist, Date.now(), supabaseAdmin)
        : await handleMerchantInput(adapter, msg.from, msg.text, persist, Date.now(), store)
      if (!reply) continue
      const texts = typeof reply === 'string' ? [{ text: reply, buttons: [] }] : reply.texts.map((text, i, arr) => ({ text, buttons: i === arr.length - 1 ? reply.buttons || [] : [] }))
      for (const m of texts) await wa.sendViaMeta(msg.from, m)
    }
    return NextResponse.json({ ok: true, handled: inbound.length })
  } catch (err: any) {
    const m = String(err?.message || err)
    if (m === 'pilot_not_enabled') return NextResponse.json({ error: 'pilot_not_enabled' }, { status: 503 })
    console.error('TIPPLR_WEBHOOK_FAILED:', m.slice(0, 200))
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}
