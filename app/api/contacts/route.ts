import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isInternalServiceAuthorized } from '@/lib/security/cron-auth'
export const dynamic = 'force-dynamic'
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

// Bounded owner-only read: never interpret a person's contact name as a SQL LIKE pattern.
// Saturation and failed/unknown reads must not be interpreted as "no matching contact".
const CONTACT_SCAN_LIMIT = 101
function cleanContactText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const result = value.trim().replace(/\s+/g, ' ')
  return result && result.length <= max ? result : null
}
function contactKey(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en')
}
function safeContactId(id: unknown): id is string | number {
  if (typeof id === 'number') return Number.isSafeInteger(id)
  return typeof id === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(id)
}
async function ownedContactRows(phone: string) {
  try {
    const { data, error } = await supabase.from('contact_memory')
      .select('id, whatsapp_id, name, facts')
      .eq('whatsapp_id', phone)
      .limit(CONTACT_SCAN_LIMIT)
    if (error || !Array.isArray(data) || data.length >= CONTACT_SCAN_LIMIT) return null
    if (data.some(row => row.whatsapp_id !== phone || typeof row.name !== 'string')) return null
    return data
  } catch {
    return null
  }
}
function unknownOutcome() {
  return NextResponse.json({
    ok: false,
    reply: 'I could not verify the contact change. Please check your contact notes before trying again.',
  }, { status: 503 })
}

export async function POST(req: NextRequest) {
  // Internal service call only (bot pipeline). `phone` is the target owner from
  // the trusted caller, not authorization.
  if (!isInternalServiceAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { phone, action, name, fact, query } = await req.json()
  if (typeof phone !== 'string' || !phone.trim()) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  if (action === 'save') {
    const contactName = cleanContactText(name, 120)
    const contactFact = cleanContactText(fact, 2000)
    if (!contactName || !contactFact) return NextResponse.json({ ok: false, error: 'name and fact required' }, { status: 400 })
    const rows = await ownedContactRows(phone)
    if (!rows) return unknownOutcome()
    const existing = rows.filter(row => contactKey(row.name) === contactKey(contactName))
    if (existing.length > 1) return NextResponse.json({ ok: false, reply: 'More than one contact has this name. Please clarify before saving.' }, { status: 409 })

    try {
      if (existing.length === 1) {
        const current = existing[0]
        if (!safeContactId(current.id) || (current.facts != null && !Array.isArray(current.facts))) return unknownOutcome()
        const facts: string[] = [...(current.facts || [])]
        if (!facts.includes(contactFact)) facts.push(contactFact)
        const { data, error } = await supabase.from('contact_memory')
          .update({ facts, updated_at: new Date().toISOString() })
          .eq('id', current.id)
          .eq('whatsapp_id', phone)
          .select('id, whatsapp_id, facts')
        if (error || !Array.isArray(data) || data.length !== 1 ||
            String(data[0].id) !== String(current.id) || data[0].whatsapp_id !== phone ||
            !Array.isArray(data[0].facts) || !data[0].facts.includes(contactFact)) return unknownOutcome()
      } else {
        const { data, error } = await supabase.from('contact_memory')
          .insert({ whatsapp_id: phone, name: contactName, facts: [contactFact], created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .select('id, whatsapp_id, name, facts')
        if (error || !Array.isArray(data) || data.length !== 1 ||
            !safeContactId(data[0].id) || data[0].whatsapp_id !== phone ||
            contactKey(String(data[0].name || '')) !== contactKey(contactName) ||
            !Array.isArray(data[0].facts) || !data[0].facts.includes(contactFact)) return unknownOutcome()
      }
    } catch {
      return unknownOutcome()
    }
    return NextResponse.json({ ok: true, reply: 'Got it! I will remember that ' + contactName + ' ' + contactFact + '.' })
  }

  if (action === 'recall') {
    const term = cleanContactText(query || name, 120)
    if (!term) return NextResponse.json({ error: 'contact name required' }, { status: 400 })
    const rows = await ownedContactRows(phone)
    if (!rows) return NextResponse.json({ reply: 'I could not verify your contact notes right now. Please try again later.' }, { status: 503 })
    const termKey = contactKey(term)
    const exact = rows.filter(row => contactKey(row.name) === termKey)
    const candidates = exact.length ? exact : rows.filter(row => contactKey(row.name).includes(termKey))
    if (candidates.length > 1) return NextResponse.json({ reply: 'More than one contact matches. Please use the full name.' })
    const entry = candidates[0]
    if (!entry?.facts?.length) return NextResponse.json({ reply: 'No notes on ' + term + ' yet.' })
    return NextResponse.json({ reply: 'About ' + entry.name + ':\n' + entry.facts.map((f: string) => '- ' + f).join('\n') })
  }

  if (action === 'list') {
    const { data: cs } = await supabase
      .from('contact_memory')
      .select('name, facts')
      .eq('whatsapp_id', phone)
      .order('updated_at', { ascending: false })
      .limit(10)
    if (!cs?.length) return NextResponse.json({ reply: 'No contact notes yet. Say "Remember Priya likes hiking" to start.' })
    return NextResponse.json({ reply: 'Contact Notes:\n' + cs.map((c: any) => '- ' + c.name + ': ' + c.facts?.slice(0, 2).join(', ')).join('\n') })
  }

  return NextResponse.json({ error: 'unknown action' }, { status: 400 })
}
