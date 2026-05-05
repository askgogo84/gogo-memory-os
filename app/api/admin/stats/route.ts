import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || ''

export async function GET() {
  if (!supabaseUrl || !serviceKey) {
    return NextResponse.json({ error: 'Supabase env vars missing' }, { status: 500 })
  }

  const client = createClient(supabaseUrl, serviceKey) as any

  const tables = ['users', 'messages', 'reminders', 'conversations', 'memories', 'expenses', 'todos', 'bill_splits', 'contact_memory', 'followups']
  const counts: Record<string, number | null> = {}

  for (const table of tables) {
    try {
      const { count, error } = await client.from(table).select('*', { count: 'exact', head: true })
      counts[table] = error ? null : (count ?? 0)
    } catch {
      counts[table] = null
    }
  }

  let latestUsers: any[] = []
  try {
    const { data } = await client.from('users').select('name, whatsapp_id, telegram_id, tier, created_at').order('created_at', { ascending: false }).limit(10)
    latestUsers = data || []
  } catch {}

  return NextResponse.json({
    ok: true,
    counts,
    latestUsers,
    timestamp: new Date().toISOString()
  })
}
