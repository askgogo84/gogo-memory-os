import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
export async function POST(req: NextRequest) {
  const { phone, text } = await req.json()
  if (!phone || !text) return NextResponse.json({ error: 'phone and text required' }, { status: 400 })
  const p = parseExpense(text)
  if (!p) return NextResponse.json({ understood: false })
  await supabase.from('expenses').insert({ whatsapp_id: phone, amount: p.amount, category: p.category, description: p.description, logged_at: new Date().toISOString() })
  const wStart = new Date(); wStart.setDate(wStart.getDate() - wStart.getDay())
  const { data: we } = await supabase.from('expenses').select('amount').eq('whatsapp_id', phone).gte('logged_at', wStart.toISOString())
  const wTotal = we?.reduce((s, e) => s + Number(e.amount), 0) || 0
  const warn = wTotal > 5000 ? `\n\n⚠️ Spent ₹${wTotal} this week.` : ''
  return NextResponse.json({ ok: true, reply: `✅ Logged: ₹${p.amount} for ${p.description} (${p.category})${warn}\n\nType *expenses* to see weekly summary.` })
}
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone')
  const period = req.nextUrl.searchParams.get('period') || 'week'
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
  const since = new Date(); if (period === 'week') since.setDate(since.getDate() - 7); else since.setDate(1)
  const { data: exps } = await supabase.from('expenses').select('amount,category,description').eq('whatsapp_id', phone).gte('logged_at', since.toISOString())
  if (!exps?.length) return NextResponse.json({ reply: `No expenses this ${period} yet. Say "Spent 450 on lunch" to start.` })
  const byCat: Record<string,number> = {}; let total = 0
  for (const e of exps) { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); total += Number(e.amount) }
  const lines = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).map(([c,a])=>`  ${c}: ₹${a}`).join('\n')
  return NextResponse.json({ reply: `💰 *${period === 'week' ? 'Weekly' : 'Monthly'} Expenses*\nTotal: ₹${total}\n\n${lines}` })
}
function parseExpense(t: string) { const m = t.match(/(?:spent|paid|cost|expensed?)\s+(?:rs\.?|¹|⎹)?\s*(\d+(?:\.\d+)?)\s+(?:on|for)\s+(.+)/i); if (!m) return null; const d = m[2].trim(); return { amount: parseFloat(m[1]), description: d, category: cat(d) } }
function cat(d: string) { const l = d.toLowerCase(); if (/food|lunch|dinner|chai|zomato/.test(l)) return 'Food'; if (/uber|ola|auto|petrol/.test(l)) return 'Transport'; if (/amazon|shop|cloth/.test(l)) return 'Shopping'; if (/doctor|medicine/.test(l)) return 'Health'; if (/rent|electricity|internet/.test(l)) return 'Bills'; return 'Other' }
