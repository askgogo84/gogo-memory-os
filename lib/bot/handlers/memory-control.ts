import { supabaseAdmin } from '@/lib/supabase-admin'

function cleanMemoryContent(content: string) {
  return (content || '')
    .replace(/^ASKGOGO_USAGE:[^:]+:[^:]+:/, '')
    .replace(/User asked to be notified for AskGogo founder pricing \/ paid plan launch\./gi, '')
    .trim()
}

function looksLikeJson(content: string) {
  const trimmed = (content || '').trim()
  return trimmed.startsWith('{') || trimmed.startsWith('[')
}

function isInternalMemory(content: string) {
  const lower = (content || '').toLowerCase().trim()
  return (
    !lower ||
    looksLikeJson(content) ||
    lower.startsWith('askgogo_usage:') ||
    lower.startsWith('askgogo_meeting_notes_created:') ||
    lower.includes('"type":"followup_state"') ||
    lower.includes('followup_state') ||
    lower.includes('meeting_action_items') ||
    lower.includes('reminder_ampm') ||
    lower.includes('founder pricing / paid plan launch') ||
    lower.includes('calendar_conflict') ||
    lower.includes('day_plan') ||
    lower.includes('user completed task') ||
    lower.includes('completed task') ||
    /^task\s+\d+\s+completed/.test(lower) ||
    /^done\s+\d+/.test(lower)
  )
}

export function isMemoryControlCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'memory' ||
    lower === 'my memory' ||
    lower === 'memories' ||
    lower === 'show memory' ||
    lower === 'show my memory' ||
    lower === 'memory on' ||
    lower === 'memory off' ||
    lower === 'turn memory on' ||
    lower === 'turn memory off' ||
    lower === 'what do you know about me' ||
    lower === 'what do you remember' ||
    lower === 'what do you remember about me' ||
    lower === 'what you remember about me' ||
    lower.startsWith('forget ') ||
    lower.startsWith('delete memory') ||
    lower.startsWith('remove memory') ||
    lower === 'clear my memory' ||
    lower === 'forget everything'
  )
}

async function getUserMemories(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('id, content, created_at')
    .eq('telegram_id', telegramId)
    .order('created_at', { ascending: false })
    .limit(50)

  return (data || [])
    .filter((m: any) => m.content && !isInternalMemory(m.content))
    .map((m: any) => ({ ...m, content: cleanMemoryContent(m.content) }))
    .filter((m: any) => m.content && !isInternalMemory(m.content))
}

async function getMemoryTwinProfile(telegramId: number) {
  const [{ data: profile }, { data: insights }, { data: consent }] = await Promise.all([
    supabaseAdmin
      .from('user_memory_profile')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle(),
    supabaseAdmin
      .from('user_insights')
      .select('*')
      .eq('telegram_id', telegramId)
      .eq('status', 'active')
      .order('confidence', { ascending: false })
      .limit(5),
    supabaseAdmin
      .from('user_consent_settings')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle(),
  ])

  return { profile, insights: insights || [], consent }
}

async function setMemoryEnabled(telegramId: number, enabled: boolean) {
  const { error } = await supabaseAdmin
    .from('user_consent_settings')
    .upsert(
      {
        telegram_id: telegramId,
        memory_enabled: enabled,
        proactive_suggestions_enabled: enabled,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'telegram_id' }
    )

  if (error) {
    console.error('[memory-control] failed to update consent:', error.message)
    return false
  }

  return true
}

function extractForgetQuery(text: string) {
  return (text || '')
    .replace(/^(forget|delete memory|remove memory)\s+/i, '')
    .replace(/\babout\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function matchesMemory(content: string, query: string) {
  const c = content.toLowerCase()
  const q = query.toLowerCase().trim()
  if (!q) return false
  if (c.includes(q)) return true
  const tokens = q.split(/\s+/).filter((t) => t.length >= 3)
  return tokens.length > 0 && tokens.every((t) => c.includes(t))
}

function normalizeMemoryItems(items: any[] | null | undefined) {
  const map = new Map<string, { value: string; count: number }>()

  for (const item of items || []) {
    const rawValue = item?.value || item?.name || item?.label
    if (!rawValue) continue

    const value = String(rawValue).trim()
    if (!value || value.toLowerCase() === 'undefined' || value.toLowerCase() === 'null') continue

    const key = value.toLowerCase()
    const old = map.get(key)
    map.set(key, {
      value,
      count: (old?.count || 0) + Number(item?.count || 1),
    })
  }

  return Array.from(map.values()).sort((a, b) => b.count - a.count)
}

function formatTopJsonItems(items: any[] | null | undefined, options?: { hideGeneral?: boolean }, fallback = 'Nothing learned yet') {
  let normalized = normalizeMemoryItems(items)
  if (options?.hideGeneral && normalized.some((item) => item.value.toLowerCase() !== 'general')) {
    normalized = normalized.filter((item) => item.value.toLowerCase() !== 'general')
  }

  if (!normalized.length) return fallback

  return normalized
    .slice(0, 5)
    .map((item) => `${item.value}${item.count ? ` ×${item.count}` : ''}`)
    .join(', ')
}

function buildTwinSummary(profile: any, insights: any[], consent: any) {
  if (!profile && !insights.length) return ''

  const memoryStatus = consent?.memory_enabled === false ? 'Off' : 'On'
  const lines = [
    `\n\n🧬 *AskGogo Memory*`,
    `Status: ${memoryStatus}`,
  ]

  if (profile?.timezone) lines.push(`Timezone: ${profile.timezone}`)
  if (profile?.frequent_contacts?.length) lines.push(`Important people/entities: ${formatTopJsonItems(profile.frequent_contacts)}`)
  if (profile?.frequent_tasks?.length) lines.push(`Common task types: ${formatTopJsonItems(profile.frequent_tasks, { hideGeneral: true })}`)
  if (profile?.common_times?.length) lines.push(`Common reminder times: ${formatTopJsonItems(profile.common_times)}`)

  if (insights.length) {
    lines.push(`Useful patterns:`)
    insights.slice(0, 3).forEach((item: any) => lines.push(`• ${item.insight}`))
  }

  return lines.join('\n')
}

export async function buildMemoryControlReply(telegramId: number, text: string) {
  const lower = (text || '').toLowerCase().trim()

  if (lower === 'memory off' || lower === 'turn memory off') {
    const ok = await setMemoryEnabled(telegramId, false)
    return ok
      ? `🧠 *Memory turned off*\n\nI’ll stop learning new personal patterns from your messages. Existing saved reminders and notes are not affected.\n\nYou can turn it back on anytime by saying: *memory on*`
      : `I could not turn memory off right now. Please try again.`
  }

  if (lower === 'memory on' || lower === 'turn memory on') {
    const ok = await setMemoryEnabled(telegramId, true)
    return ok
      ? `🧠 *Memory turned on*\n\nAskGogo will learn useful patterns like your common reminder times, frequent task types, and important contacts.\n\nSay *my memory* anytime to review it.`
      : `I could not turn memory on right now. Please try again.`
  }

  if (lower === 'clear my memory' || lower === 'forget everything') {
    const memories = await getUserMemories(telegramId)
    const ids = memories.map((m: any) => m.id)

    if (ids.length) await supabaseAdmin.from('memories').delete().in('id', ids)

    await Promise.all([
      supabaseAdmin.from('user_insights').update({ status: 'deleted' }).eq('telegram_id', telegramId),
      supabaseAdmin
        .from('user_memory_profile')
        .update({ common_times: [], frequent_contacts: [], frequent_tasks: [], preferences: {}, last_updated: new Date().toISOString() })
        .eq('telegram_id', telegramId),
    ])

    return `🧠 *Memory cleared*\n\nI deleted saved personal memories and reset your Memory Twin patterns. Usage/system logs were not touched.`
  }

  if (lower.startsWith('forget ') || lower.startsWith('delete memory') || lower.startsWith('remove memory')) {
    const query = extractForgetQuery(text)
    const memories = await getUserMemories(telegramId)
    const matched = memories.filter((m: any) => matchesMemory(m.content, query))

    if (!matched.length) {
      return `I couldn’t find a saved memory matching *${query || 'that'}*.\n\nTry:\n• my memory\n• forget my office address\n• clear my memory`
    }

    await supabaseAdmin.from('memories').delete().in('id', matched.map((m: any) => m.id))

    return (
      `🧠 *Forgotten*\n\n` +
      matched.slice(0, 3).map((m: any) => `• ${m.content}`).join('\n') +
      (matched.length > 3 ? `\n• and ${matched.length - 3} more` : '')
    )
  }

  const [memories, twin] = await Promise.all([
    getUserMemories(telegramId),
    getMemoryTwinProfile(telegramId),
  ])

  const twinSummary = buildTwinSummary(twin.profile, twin.insights, twin.consent)

  if (!memories.length && !twinSummary) {
    return `🧠 *Memory*\n\nI don’t have any saved personal memories yet.\n\nTry saying:\nRemember that my office is in Indiranagar\nRemember that I prefer morning meetings`
  }

  const savedMemoryBlock = memories.length
    ? `🧠 *Saved memories*\n\n${memories.slice(0, 10).map((m: any, idx: number) => `${idx + 1}. ${m.content}`).join('\n')}`
    : `🧠 *Saved memories*\n\nNo manually saved memories yet.`

  return (
    savedMemoryBlock +
    twinSummary +
    `\n\nYou can say:\n• memory off\n• memory on\n• forget my office address\n• clear my memory`
  )
}
