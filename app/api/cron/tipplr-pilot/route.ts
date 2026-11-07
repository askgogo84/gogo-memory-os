import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveActionRecord } from '@/lib/agent/action-record'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

// Tipplr ops pilot (phase 2, 7 Nov): runs due cut-off schedules and, at 11:20 IST, prepares proposals. Messages are
// returned to the caller until the WhatsApp channel lands (phase 3); nothing is sent from here. 503 until the
// pilot migration has been run and the workspace seeded.
function authorized(request: Request) {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const url = new URL(request.url)
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim()
  return url.searchParams.get('secret') === expected || bearer === expected
}

export async function GET(request: Request) {
  if (!authorized(request)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  const workspaceId = process.env.TIPPLR_PILOT_WORKSPACE_ID
  if (!workspaceId) return NextResponse.json({ error: 'pilot_not_configured' }, { status: 503 })
  try {
    const [{ SupabaseAdapter }, { SupabaseScheduleStore, runDueSchedules, proposeCutoffs }] = await Promise.all([import('@/lib/enterprise/tipplr/supabase-adapter'), import('@/lib/enterprise/tipplr/schedules')])
    const { seedIfEmpty } = await import('@/lib/enterprise/tipplr/supabase-adapter')
    const seed = await seedIfEmpty(supabaseAdmin, workspaceId)
    const adapter = new SupabaseAdapter(supabaseAdmin, workspaceId)
    const store = new SupabaseScheduleStore(supabaseAdmin)
    const persist = (rec: any) => saveActionRecord(supabaseAdmin, rec)
    const now = Date.now()
    const ran = await runDueSchedules(adapter, store, persist, now)
    const istMin = (new Date(now + 5.5 * 3_600_000).getUTCHours() * 60) + new Date(now + 5.5 * 3_600_000).getUTCMinutes()
    const proposals = istMin >= 11 * 60 + 20 && istMin < 11 * 60 + 30 ? await proposeCutoffs(adapter, store, now) : []
    // Phase 3: send through the Meta test number when configured; otherwise the messages are only returned here.
    const wa = await import('@/lib/enterprise/tipplr/meta-whatsapp')
    let sent = 0
    if (wa.metaConfigured()) {
      for (const r of ran) for (const to of r.outlet.phoneNumbers.slice(0, 1)) { const res = await wa.sendViaMeta(to, { text: r.text, buttons: [] }); if (res.ok) sent++ }
      for (const p of proposals) for (const to of p.outlet.phoneNumbers.slice(0, 1)) { const res = await wa.sendViaMeta(to, p.message); if (res.ok) sent++ }
      const opsNumbers = String(process.env.TIPPLR_PILOT_OPS_NUMBERS || '').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean)
      if (istMin >= 9 * 60 && istMin < 9 * 60 + 5 && opsNumbers.length) {
        const { buildDigest, formatDigest } = await import('@/lib/enterprise/tipplr/digest')
        const text = formatDigest(await buildDigest(adapter, store, now))
        for (const to of opsNumbers) { const res = await wa.sendViaMeta(to, { text, buttons: [] }); if (res.ok) sent++ }
      }
    }
    console.log('TIPPLR_PILOT_CRON:', JSON.stringify({ ran: ran.length, proposals: proposals.length, sent, meta: wa.metaConfigured() }))
    return NextResponse.json({ ok: true, seeded: seed.seeded, sent, ran: ran.map(r => ({ outlet: r.outlet.id, text: r.text })), proposals: proposals.map(p => ({ outlet: p.outlet.id, text: p.message.text, buttons: p.message.buttons })) })
  } catch (err: any) {
    const msg = String(err?.message || err)
    if (msg === 'pilot_not_enabled') return NextResponse.json({ error: 'pilot_not_enabled' }, { status: 503 })
    console.error('TIPPLR_PILOT_CRON_FAILED:', msg.slice(0, 200))
    return NextResponse.json({ error: 'pilot_failed' }, { status: 500 })
  }
}
