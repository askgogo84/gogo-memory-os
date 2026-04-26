import { supabaseAdmin } from '@/lib/supabase-admin'

function cleanMemoryContent(content: string) {
  return (content || '')
    .replace(/^ASKGOGO_USAGE:[^:]+:[^:]+:/, '')
    .replace(/User asked to be notified for AskGogo founder pricing \/ paid plan launch\./gi, '')
    .trim()
}

function isInternalMemory(content: string) {
  const lower = (content || '').toLowerCase()
  return (
    lower.startsWith('askgogo_usage:') ||
    lower.includes('founder pricing / paid plan launch') ||
    lower.includes('calendar_conflict') ||
    lower.includes('day_plan')
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
    .map((m: any) => ({
      ...m,
      content: cleanMemoryContent(m.content),
    }))
    .filter((m: any) => m.content)
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

export async function buildMemoryControlReply(telegramId: number, text: string) {
  const lower = (text || '').toLowerCase().trim()

  if (lower === 'clear my memory' || lower === 'forget everything') {
    const memories = await getUserMemories(telegramId)

    if (!memories.length) {
      return `🧠 *Memory*\n\nI don’t have any saved personal memories yet.`
    }

    const ids = memories.map((m: any) => m.id)
    await supabaseAdmin.from('memories').delete().in('id', ids)

    return `🧠 *Memory cleared*\n\nI deleted ${ids.length} saved personal memories. Usage and system logs were not touched.`
  }

  if (lower.startsWith('forget ') || lower.startsWith('delete memory') || lower.startsWith('remove memory')) {
    const query = extractForgetQuery(text)
    const memories = await getUserMemories(telegramId)
    const matched = memories.filter((m: any) => matchesMemory(m.content, query))

    if (!matched.length) {
      return (
        `I couldn’t find a memory matching *${query || 'that'}*.\n\n` +
        `Try:\n` +
        `• what do you remember about me\n` +
        `• forget my office address\n` +
        `• clear my memory`
      )
    }

    await supabaseAdmin.from('memories').delete().in('id', matched.map((m: any) => m.id))

    return (
      `🧠 *Forgotten*\n\n` +
      matched.slice(0, 3).map((m: any) => `• ${m.content}`).join('\n') +
      (matched.length > 3 ? `\n• and ${matched.length - 3} more` : '')
    )
  }

  const memories = await getUserMemories(telegramId)

  if (!memories.length) {
    return (
      `🧠 *Memory*\n\n` +
      `I don’t have any saved personal memories yet.\n\n` +
      `Try saying:\n` +
      `Remember that my office is in Indiranagar\n` +
      `Remember that I prefer morning meetings`
    )
  }

  return (
    `🧠 *What I remember about you*\n\n` +
    memories
      .slice(0, 10)
      .map((m: any, idx: number) => `${idx + 1}. ${m.content}`)
      .join('\n') +
    `\n\nYou can say:\n` +
    `• forget my office address\n` +
    `• clear my memory`
  )
}
