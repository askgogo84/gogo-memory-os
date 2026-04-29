import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const { data: users } = await supabase.from('users').select('whatsapp_id, name').eq('briefing_enabled', true).not('whatsapp_id', 'is', null)
  if (!users?.length) return NextResponse.json({ sent: 0 })
  let sent = 0
  for (const user of users) {
    try { await sendWhatsApp(user.whatsapp_id, await buildBriefing(user)); sent++ } catch (e) { console.error('Briefing failed', e) }
  }
  return NextResponse.json({ sent })
}

export async function POST(req: NextRequest) {
  const { phone, name } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
  await sendWhatsApp(phone, await buildBriefing({ whatsapp_id: phone, name }))
  return NextResponse.json({ ok: true })
}

async function buildBriefing(user: { whatsapp_id?: string; name?: string }) {
  const name = user.name?.split(' ')[0] || 'there'
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })
  let weatherLine = ''
  try { const w = await fetch('https://wttr.in/Bengaluru?format=%C+%t', { signal: AbortSignal.timeout(3000) }); weatherLine = `🌤 *Weather:* ${await w.text()}` } catch { }
  let newsLines = ''
  try {
    const n = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: 'India top news today', max_results: 3 }), signal: AbortSignal.timeout(5000) })
    const d = await n.json()
    const h = d?.results?.slice(0, 3).map((r: any) => `• ${r.title}`).join('\n')
    if (h) newsLines = `\n📰 *Top News:*\n${h}`
  } catch { }
  return [`<!-- -->\n🌅 *Good morning, ${name}!*`, dateStr, '', weatherLine, newsLines, '', `💡 _Type *tasks* or *news* or just ask me anything!_`].filter(Boolean).join('\n')
}
