import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
export async function POST(req: NextRequest) {
  const { phone, action, name, fact, query } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
  if (action === 'save') {
    const { data: ex } = await supabase.from('contact_memory').select('id,facts').eq('whatsapp_id',phone).ilike('name',name).maybeSingle()
    if (ex) { const f = [...(ex.facts || [])]; if (!f.includes(fact)) f.push(fact); await supabase.from('contact_memory').update({ facts:f, updated_at:new Date().toISOString() }).eq('id',ex.id) }
    else await supabase.from('contact_memory').insert({ whatsapp_id:phone, name, facts:[fact], created_at:new Date().toISOString(), updated_at:new Date().toISOString() })
    return NextResponse.json({ ok:true, reply: `🧠 Got it! Iq¤ll remember ${name} ${fact}.` })
  }
  if (action === 'recall') {
    const { data: c } = await supabase.from('contact_memory').select('name,facts').eq('whatsapp_id',phone).ilike('name',`%${query||name}%`).maybeSingle()
    if (!c?.facts?.length) return NextResponse.json({ reply: `No notes on ${query||name} yet.` })
    return NextResponse.json({ reply: `🧠 *${c.name}:*\n${c.facts.map((f:string)=>`• ${f}`).join('\n')}` })
  }
  if (action === 'list') {
    const { data: cs } = await supabase.from('contact_memory').select('name,facts').eq('whatsapp_id',phone).order('updated_at',{ascending:false}).limit(10)
    if (!cs?.length) return NextResponse.json({ reply: 'No contact notes yet.' })
    return NextResponse.json({ reply: `🧠 *Contact Notes:*\n${cs.map((c:any)=>`• *${c.name}* - ${c.facts?.slice(0,2).join(', ')}`).join('\n')}` })
  }
  return NextResponse.json({ error:'unknown action' },{status:400})
}
