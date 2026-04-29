import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
const Q = { tech: 'India tech AI news today', markets: 'India NSE BSE market news', cricket: 'India cricket IPL news', startup: 'India startup funding news', world: 'world top news today', politics: 'India politics news' }
export async function POST(req: NextRequest) {
  const { phone, topics } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })
  let userTopics = topics
  if (!userTopics) { const { data: u } = await supabase.from('users').select('news_topics').eq('whatsapp_id', phone).single(); userTopics = u?.news_topics || ['tech', 'markets'] }
  const headlines: string[] = []
  for (const topic of (userTopics as string[]).slice(0,3)) {
    try {
      const r = await fetch('https://api.tavily.com/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key: process.env.TAVILY_API_KEY, query: (Q as any)[topic] || topic + ' news', max_results: 2 }), signal: AbortSignal.timeout(5000) })
      const d = await r.json()
      for (const x of (d?.results || [])) headlines.push(`*${topic.toUpperCase()}*\n${x.title}`)
    } catch {}
  }
  if (!headlines.length) return NextResponse.json({ reply: "Couldn't fetch news right now. Try again shortly." })
  return NextResponse.json({ ok: true, reply: `📰 *News Digest*\n_${new Date().toLocaleDateString('en-IN',{ weekday:'long', day:'numeric', month:"short" })}_\n\n${headlines.join('\n\n')}\n\n_Type *news tech* or join options._` })
}
