import { supabaseAdmin } from '@/lib/supabase-admin'

type UserMemoryProfile = {
  telegram_id: number
  preferred_name?: string | null
  timezone?: string | null
  preferred_language?: string | null
  communication_style?: string | null
  common_times?: any[]
  frequent_contacts?: any[]
  frequent_tasks?: any[]
  preferences?: Record<string, any>
}

function extractPossibleContacts(text: string) {
  const clean = text || ''
  const matches =
    clean.match(/\b(?:call|meet|message|follow up with|follow-up with|remind me to call)\s+([A-Z][a-zA-Z. ]{2,50})/g) || []

  return matches
    .map((item) =>
      item
        .replace(/^(call|meet|message|follow up with|follow-up with|remind me to call)\s+/i, '')
        .replace(/\b(and then|then|also|tomorrow|today)\b.*$/i, '')
        .trim()
    )
    .filter(Boolean)
    .slice(0, 5)
}

function extractTaskType(text: string) {
  const lower = (text || '').toLowerCase()

  if (lower.includes('call')) return 'call'
  if (lower.includes('follow')) return 'follow-up'
  if (lower.includes('meeting')) return 'meeting'
  if (lower.includes('pay') || lower.includes('payment')) return 'payment'
  if (lower.includes('doctor') || lower.includes('dr.')) return 'health'
  if (lower.includes('expense') || lower.includes('spent')) return 'expense'
  if (lower.includes('briefing')) return 'briefing'
  if (lower.includes('note')) return 'note'

  return 'general'
}

function extractTimeLabel(payload: any) {
  if (payload?.hour) return payload.hour

  if (payload?.remindAtIso) {
    return new Date(payload.remindAtIso).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    })
  }

  return null
}

function mergeTopItems(existing: any[], incoming: any[], key = 'value', limit = 10) {
  const map = new Map<string, any>()

  for (const item of existing || []) {
    if (!item?.[key]) continue
    map.set(String(item[key]).toLowerCase(), item)
  }

  for (const item of incoming || []) {
    if (!item?.[key]) continue
    const normalized = String(item[key]).toLowerCase()
    const old = map.get(normalized)
    map.set(normalized, {
      ...item,
      count: (old?.count || 0) + (item.count || 1),
      last_seen: new Date().toISOString(),
    })
  }

  return Array.from(map.values())
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, limit)
}

export async function getOrCreateMemoryProfile(telegramId: number, preferredName?: string | null) {
  const { data } = await supabaseAdmin
    .from('user_memory_profile')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (data) return data as UserMemoryProfile

  const { data: inserted, error } = await supabaseAdmin
    .from('user_memory_profile')
    .insert({
      telegram_id: telegramId,
      preferred_name: preferredName || null,
      timezone: 'Asia/Kolkata',
      communication_style: 'warm, concise, helpful',
    })
    .select('*')
    .single()

  if (error) {
    console.error('[memory-twin] profile create failed:', error.message)
    return null
  }

  return inserted as UserMemoryProfile
}

export async function updateProfileFromEvent(params: {
  telegramId: number
  eventType: string
  payload?: Record<string, any>
  userName?: string | null
}) {
  const profile = await getOrCreateMemoryProfile(params.telegramId, params.userName)
  if (!profile) return null

  const payload = params.payload || {}
  const text = String(payload.text || payload.message || '')
  const possibleContacts = extractPossibleContacts(text)
  const taskType = extractTaskType(text)
  const timeLabel = extractTimeLabel(payload)

  const frequentContacts = mergeTopItems(
    profile.frequent_contacts || [],
    possibleContacts.map((name) => ({
      value: name,
      type: 'person_or_org',
      count: 1,
      last_seen: new Date().toISOString(),
    }))
  )

  const frequentTasks = mergeTopItems(profile.frequent_tasks || [], [
    {
      value: taskType,
      count: 1,
      last_seen: new Date().toISOString(),
    },
  ])

  const commonTimes = timeLabel
    ? mergeTopItems(profile.common_times || [], [
        {
          value: timeLabel,
          count: 1,
          last_seen: new Date().toISOString(),
        },
      ])
    : profile.common_times || []

  const { data, error } = await supabaseAdmin
    .from('user_memory_profile')
    .update({
      preferred_name: profile.preferred_name || params.userName || null,
      frequent_contacts: frequentContacts,
      frequent_tasks: frequentTasks,
      common_times: commonTimes,
      last_updated: new Date().toISOString(),
    })
    .eq('telegram_id', params.telegramId)
    .select('*')
    .single()

  if (error) {
    console.error('[memory-twin] profile update failed:', error.message)
    return null
  }

  return data
}
