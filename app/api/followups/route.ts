import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
export async function POST(req: NextRequest) {
  const { phone, contact, daysIfNoReply, context } = await req.json()
  if (!phone || !contact) return NextResponse.json({ error: 'phone and contact required' }, { status: 400 })
  const checkAt = new Date(); checkAt.setDate(checkAt.getDate() + (daysIfNoReply || 2))
  await supabase.from('followups').insert({ whatsapp_id: phone, contact_name: contact, context: context || '', check_at: checkAt.toISOString(), status: 'pending', created_at: new Date().toISOString() })
  return NextResponse.json({ ok: true, reply: `⏰ Will remind you to follow up with *${contact}* on ${checkAt.toLocaleDateString('en-IN',{ weekday:"short", day:"numeric", month:"short" })} if they haven't replied.` })
}
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: due } = await supabase.from('followups').select('*').eq('status', 'pending').lte('check_at', new Date().toISOString())
  let fired = 0
  for (const f of (due || [])) {
    await sendWhatsApp(f.whatsapp_id, `🔔 *Follow-up Reminder*

No reply yet from *${f.contact_name}*.${f.context ? `\nContext: _${f.context}_` : ''}

Wish to draft a follow-up?`)
    await supabase.from('followups').update({ status: 'fired' }).eq('id', f.id)
    fired++
  }
  return NextResponse.json({ checked: due?.length || 0, fired })
}
