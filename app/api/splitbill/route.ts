import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
export async function POST(req: NextRequest) {
  const { phone, amount, people, description } = await req.json()
  if (!phone || !amount || !people?.length) return NextResponse.json({ error: 'phone, amount, people required' }, { status: 400 })
  const total = parseFloat(amount), pp = total / people.length
  await supabase.from('bill_splits').insert({ whatsapp_id: phone, total_amount: total, description: description || 'Bill', people, per_person: pp, created_at: new Date().toISOString() })
  const lines = people.map((n: string) => `• ${n}: ${/^me$/i.test(n) ? '(paid)' : `¹${pp.toFixed(0)}`}`).join('\n')
  return NextResponse.json({ ok: true, perPerson: pp.toFixed(0), reply: `💸 *Bill Split: ${description || 'Bill'}*Total: ₹${total.toLocaleString('en-IN')} | Per person: ₹${pp.toFixed(0)}\n\n${lines}` })
}
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone')
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
  const { data: splits } = await supabase.from('bill_splits').select('total_amount,description,people,per_person').eq('whatsapp_id', phone).order('created_at',{ ascending: false }).limit(5)
  if (!splits?.length) return NextResponse.json({ reply: 'No splits yet.' })
  return NextResponse.json({ reply: `💸 *Recent Splits:*\n${splits.map(s => `• ₹${s.total_amount} for ${s.description} (${s.people?.length} people, ₹${Math.round(s.per_person)}/each)`).join('\n')}` })
}
