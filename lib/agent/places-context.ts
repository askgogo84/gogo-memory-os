// Places with what Gogo knows (5 Nov live): "nearby" uses the home area the person saved, and food results say
// which stated taste was kept in mind. Owner-scoped reads; the id stays a string. Read-only.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { answerPlaces, homeAreaFrom, nearbyNeedsArea, nearbyRewrite } from './places-search'
import { listTaste } from './taste'

const FOOD = /\b(?:restaurants?|caf(?:e|é)s?|coffee|bars?|pubs?|bakery|bakeries|places? to eat|dhabas?|darshinis?|biryani|dosa|pizza|burgers?|ice ?cream|desserts?|lunch|dinner|breakfast)\b/i

async function homeArea(telegramId: string) {
  const { data, error } = await supabaseAdmin.from('memories').select('content').eq('telegram_id', telegramId)
    .or('content.ilike.%live in%,content.ilike.%live at%,content.ilike.%stay in%,content.ilike.%based in%,content.ilike.%home is%')
    .order('created_at', { ascending: false }).limit(20)
  if (error) return null
  return homeAreaFrom((data || []).map((r: any) => String(r.content || '')))
}

export function tasteNote(values: string[]) {
  const keep = values.filter(v => !/^Likes:/i.test(v)).slice(0, 4)
  return keep.length ? `\n\nKept in mind: ${keep.join(' · ')}. Check the menu before ordering.` : ''
}

export async function answerPlacesWithContext(p: { text: string; telegramId: string | number }, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  const tg = String(p.telegramId)
  let text = p.text
  const near = nearbyRewrite(text, null)
  if (near) {
    const area = await homeArea(tg).catch(() => null)
    const rewritten = nearbyRewrite(text, area)
    if (!rewritten || 'needArea' in rewritten) return nearbyNeedsArea(text)
    text = rewritten.text
  }
  const out = await answerPlaces(text, fetchImpl)
  if (!out || !FOOD.test(text) || !out.startsWith('📍')) return out
  const facts = await listTaste(tg).catch(() => null)
  return facts?.length ? out.replace(/(\n\nAsk "which of these is open late\?"[^\n]*)?$/, m => tasteNote(facts.map(f => f.value)) + m) : out
}
