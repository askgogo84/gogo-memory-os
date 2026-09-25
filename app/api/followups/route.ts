import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsAppReminderTemplate } from '@/lib/whatsapp'
import { deliverNotification } from '@/lib/services/notification-delivery'
import { deliveryRpc } from '@/lib/services/reminder-delivery'
import { isSuppressed } from '@/lib/bot/handlers/reminder-optout'
import { isCronAuthorized } from '@/lib/security/cron-auth'
import { requireAgentMutationOrigin, requireAgentSession, isAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

async function ownerWhatsapp(telegramId:string){
  const {data,error}=await supabase
    .from('users')
    .select('whatsapp_id')
    .eq('telegram_id',Number(telegramId))
    .maybeSingle()
  if(error)throw new Error(`followup_owner_lookup_failed:${error.message}`)
  return String(data?.whatsapp_id||'').replace(/^whatsapp:/,'').trim()
}

export async function POST(req: NextRequest) {
  const blocked=requireAgentMutationOrigin(req)
  if(blocked)return blocked

  const session=await requireAgentSession(req)
  if(!isAgentSession(session))return session

  const { contact, daysIfNoReply, context } = await req.json()
  if (!contact) return NextResponse.json({ error: 'contact required' }, { status: 400 })

  const phone=await ownerWhatsapp(session.telegramId)
  if(!phone)return NextResponse.json({error:'owner_whatsapp_not_found'},{status:400})

  const days=Math.max(1,Math.min(30,Number(daysIfNoReply)||2))
  const checkAt = new Date()
  checkAt.setDate(checkAt.getDate() + days)

  const {error}=await supabase.from('followups').insert({
    owner_id: Number(session.telegramId),
    whatsapp_id: phone,
    contact_name: String(contact).trim().slice(0,160),
    context: String(context||'').trim().slice(0,1000),
    check_at: checkAt.toISOString(),
    status: 'pending',
    created_at: new Date().toISOString(),
  })
  if(error)return NextResponse.json({error:'followup_create_failed'},{status:500})

  return NextResponse.json({
    ok: true,
    reply: `⏰ Will remind you to follow up with *${String(contact).trim().slice(0,160)}* on ${checkAt.toLocaleDateString('en-IN',{ weekday:'short', day:'numeric', month:'short' })}.`,
  })
}

export async function GET(req: NextRequest) {
  if(!isCronAuthorized(req))return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const deadline = Date.now() + 45000
  let due: any[]
  try { due = await deliveryRpc('due_followup_deliveries', { p_limit: 50 }) }
  catch { return NextResponse.json({ ok: false, error: 'followup_read_failed' }, { status: 503 }) }
  let fired = 0
  const failures: { id: string; status: string }[] = []
  for (const f of due || []) {
    if (Date.now() >= deadline) break
    // Each occurrence is isolated; one provider/DB failure cannot abort the batch.
    const status = await deliverNotification({ key: 'followup/' + f.id, source: 'followup',
      owner: Number(f.owner_id), channel: 'whatsapp', due: f.check_at, deadline,
      prepare: async () => {
        if (!f.owner_id || !process.env.TWILIO_REMINDER_CONTENT_SID) throw new Error('followup_owner_or_template_missing')
      },
      ready: async () => {
        const { data: fresh, error } = await supabase.from('followups').select('*').eq('id', f.id).eq('owner_id', f.owner_id).maybeSingle()
        if (error) throw new Error('followup_cancel_check_failed')
        if (!fresh || fresh.status !== 'pending' || fresh.check_at !== f.check_at || fresh.whatsapp_id !== f.whatsapp_id ||
          fresh.contact_name !== f.contact_name || fresh.context !== f.context) return false
        const owner = await ownerWhatsapp(String(f.owner_id))
        return owner === String(f.whatsapp_id).replace(/^whatsapp:/, '').trim() && !await isSuppressed(f.owner_id, owner)
      },
      send: async token => {
        const label = ('Follow up with ' + f.contact_name + (f.context ? ': ' + f.context : '')).slice(0,400)
        return (await sendWhatsAppReminderTemplate(f.whatsapp_id, label, token)).sid
      },
      accepted: async sid => {
        const { data, error } = await supabase.from('followups').update({ status: 'fired', provider_sid: sid })
          .eq('id', f.id).eq('owner_id', f.owner_id).eq('status', 'pending').select('id')
        if (error || !data?.length) throw new Error('followup_fired_write_failed')
      } })
    if (status === 'provider_accepted') fired++
    if (['failed','outcome_unknown','persistence_failed'].includes(status)) failures.push({ id: f.id, status })
  }
  return NextResponse.json({ ok: failures.length === 0, checked: due?.length || 0,
    accepted: fired, fired, failures }, { status: failures.length ? 503 : 200 })
}
