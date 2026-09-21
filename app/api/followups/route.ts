import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'
import { isCronAuthorized } from '@/lib/security/cron-auth'
import { requireAgentMutationOrigin, requireAgentSession, isAgentSession } from '@/lib/agent/session'

export const dynamic = 'force-dynamic'

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
    reply: `⏰ Will remind you to follow up with *${String(contact).trim().slice(0,160)}* on ${checkAt.toLocaleDateString('en-IN',{ weekday:'short', day:'numeric', month:'short' })} if they haven't replied.`,
  })
}

export async function GET(req: NextRequest) {
  if(!isCronAuthorized(req))return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: due, error } = await supabase
    .from('followups')
    .select('*')
    .eq('status', 'pending')
    .lte('check_at', new Date().toISOString())

  if(error)return NextResponse.json({error:'followup_read_failed'},{status:500})

  let fired = 0
  for (const f of (due || [])) {
    await sendWhatsApp(f.whatsapp_id, `🔔 *Follow-up Reminder*

No reply yet from *${f.contact_name}*.${f.context ? `\nContext: _${f.context}_` : ''}

Wish to draft a follow-up?`)
    await supabase.from('followups').update({ status: 'fired' }).eq('id', f.id).eq('status','pending')
    fired++
  }
  return NextResponse.json({ checked: due?.length || 0, fired })
}
