import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { sendWhatsApp } from '@/lib/whatsapp'

export const dynamic = 'force-dynamic'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

type UserRecord = {
  id?: string
  telegram_id?: number
  whatsapp_id?: string
  name?: string
  timezone?: string | null
}

type BriefingContext = {
  user: UserRecord
  timezone: string
  todayStartUtc: string
  tomorrowStartUtc: string
  reminders: any[]
  overdueReminders: any[]
  todos: any[]
  followups: any[]
  notes: any[]
  memoryProfile: any | null
}

export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: users } = await supabase
    .from('users')
    .select('id, telegram_id, whatsapp_id, name, timezone')
    .eq('briefing_enabled', true)
    .not('whatsapp_id', 'is', null)

  if (!users?.length) return NextResponse.json({ sent: 0 })

  let sent = 0
  for (const user of users) {
    try {
      await sendWhatsApp(user.whatsapp_id, await buildBriefing(user))
      sent++
    } catch (e) {
      console.error('Briefing failed', e)
    }
  }

  return NextResponse.json({ sent })
}

export async function POST(req: NextRequest) {
  const { phone, name } = await req.json()
  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  const user = await resolveBriefingUser(phone, name)
  const reply = await buildBriefing(user)

  return NextResponse.json({ ok: true, reply })
}

async function resolveBriefingUser(phone: string, fallbackName?: string): Promise<UserRecord> {
  const { data } = await supabase
    .from('users')
    .select('id, telegram_id, whatsapp_id, name, timezone')
    .eq('whatsapp_id', phone)
    .maybeSingle()

  return data || { whatsapp_id: phone, name: fallbackName || 'there', timezone: 'Asia/Kolkata' }
}

function getDayWindowUtc(timezone: string) {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const today = formatter.format(now)
  const todayStartLocal = new Date(`${today}T00:00:00+05:30`)
  const tomorrowStartLocal = new Date(todayStartLocal.getTime() + 24 * 60 * 60 * 1000)

  return {
    todayLabel: today,
    todayStartUtc: todayStartLocal.toISOString(),
    tomorrowStartUtc: tomorrowStartLocal.toISOString(),
  }
}

function formatDateHeader(timezone: string) {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: timezone,
  })
}

function formatTime(value: string, timezone: string) {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: timezone,
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(value))
  } catch {
    return ''
  }
}

function firstName(name?: string) {
  return (name || 'there').split(' ')[0] || 'there'
}

function isBadMemoryEntity(value: string) {
  const lower = value.toLowerCase().trim()
  if (!lower) return true
  if (lower === 'team') return true
  if (lower.includes(' tomorrow')) return true
  if (lower.includes(' today')) return true
  if (lower.includes(' reminder')) return true
  if (lower.includes('briefing')) return true
  if (lower.includes('memory twin')) return true
  if (lower.length > 40) return true
  return false
}

function topJsonItems(
  items: any[] | null | undefined,
  options?: { hideGeneral?: boolean; filterEntities?: boolean; limit?: number }
) {
  const map = new Map<string, number>()
  for (const item of items || []) {
    const value = String(item?.value || item?.name || item?.label || '').trim()
    if (!value) continue
    if (options?.hideGeneral && value.toLowerCase() === 'general') continue
    if (options?.filterEntities && isBadMemoryEntity(value)) continue
    map.set(value, (map.get(value) || 0) + Number(item?.count || 1))
  }

  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, options?.limit || 4)
    .map(([value, count]) => `${value}${count ? ` ×${count}` : ''}`)
}

function cleanNoteForBriefing(text: string) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return ''

  const lower = raw.toLowerCase()

  if (lower.includes('medical note / prescription image') || lower.includes('prescription')) {
    const patient = raw.match(/Patient:\s*([^•\n]+)/i)?.[1]?.trim()
    const doctor = raw.match(/Doctor\/clinic:\s*([^•\n]+)/i)?.[1]?.trim()
    const meds = raw.match(/Medicine name:\s*([^•\n]+)/i)?.[1]?.trim()
    const vitals = ['TG', 'LDL', 'BP']
      .map((label) => {
        const match = raw.match(new RegExp(`${label}\\s*[: ]\\s*([^•,;\\n]+)`, 'i'))
        return match?.[1] ? `${label} ${match[1].trim().split(' ')[0]}` : ''
      })
      .filter(Boolean)
      .join(', ')

    const parts = ['Medical note']
    if (patient) parts.push(patient.replace(/\.$/, ''))
    if (vitals) parts.push(vitals)
    if (meds && !/unclear/i.test(meds)) parts.push(`Medicine: ${meds}`)
    else parts.push('Medicine: verify')
    if (doctor) parts.push(doctor.replace(/\.$/, ''))

    return parts.join(' • ').slice(0, 130)
  }

  return raw
    .replace(/^Image note —\s*/i, '')
    .replace(/\s*Text:\s*/i, ' • ')
    .slice(0, 120)
}

async function loadBriefingContext(user: UserRecord): Promise<BriefingContext> {
  const timezone = user.timezone || 'Asia/Kolkata'
  const { todayStartUtc, tomorrowStartUtc } = getDayWindowUtc(timezone)
  const telegramId = user.telegram_id
  const phone = user.whatsapp_id

  const [remindersResult, overdueResult, todosResult, followupsResult, notesResult, memoryResult] = await Promise.all([
    telegramId
      ? supabase
          .from('reminders')
          .select('id, message, remind_at, sent')
          .eq('telegram_id', telegramId)
          .eq('sent', false)
          .gte('remind_at', todayStartUtc)
          .lt('remind_at', tomorrowStartUtc)
          .order('remind_at', { ascending: true })
          .limit(8)
      : Promise.resolve({ data: [] as any[] }),
    telegramId
      ? supabase
          .from('reminders')
          .select('id, message, remind_at, sent')
          .eq('telegram_id', telegramId)
          .eq('sent', false)
          .lt('remind_at', todayStartUtc)
          .order('remind_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] as any[] }),
    phone
      ? supabase
          .from('todos')
          .select('id, text, done, created_at')
          .eq('whatsapp_id', phone)
          .eq('done', false)
          .order('created_at', { ascending: true })
          .limit(6)
      : Promise.resolve({ data: [] as any[] }),
    phone
      ? supabase
          .from('followups')
          .select('id, contact_name, context, check_at, status')
          .eq('whatsapp_id', phone)
          .in('status', ['pending', 'fired'])
          .lte('check_at', tomorrowStartUtc)
          .order('check_at', { ascending: true })
          .limit(5)
      : Promise.resolve({ data: [] as any[] }),
    telegramId
      ? supabase
          .from('lists')
          .select('items, updated_at')
          .eq('telegram_id', telegramId)
          .eq('list_name', 'notes')
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
    telegramId
      ? supabase
          .from('user_memory_profile')
          .select('timezone, frequent_contacts, frequent_tasks, common_times, preferences, last_updated')
          .eq('telegram_id', telegramId)
          .maybeSingle()
      : Promise.resolve({ data: null as any }),
  ])

  const notes = ((notesResult as any).data?.items || [])
    .filter((item: any) => item && !item.done)
    .slice(-3)
    .reverse()

  return {
    user,
    timezone,
    todayStartUtc,
    tomorrowStartUtc,
    reminders: remindersResult.data || [],
    overdueReminders: overdueResult.data || [],
    todos: todosResult.data || [],
    followups: followupsResult.data || [],
    notes,
    memoryProfile: memoryResult.data || null,
  }
}

function buildPriorityLine(ctx: BriefingContext) {
  const firstReminder = ctx.reminders[0]
  if (firstReminder) return `Top priority: ${formatTime(firstReminder.remind_at, ctx.timezone)} — ${firstReminder.message}`
  if (ctx.followups[0]) return `Top priority: follow up with ${ctx.followups[0].contact_name}`
  if (ctx.todos[0]) return `Top priority: ${ctx.todos[0].text}`
  return 'Top priority: keep the day light and focused.'
}

function formatReminderBlock(ctx: BriefingContext) {
  if (!ctx.reminders.length && !ctx.overdueReminders.length) return '✅ No scheduled reminders for today.'

  const lines: string[] = []
  if (ctx.reminders.length) {
    lines.push('*Today’s reminders*')
    ctx.reminders.slice(0, 6).forEach((r) => lines.push(`• ${formatTime(r.remind_at, ctx.timezone)} — ${r.message}`))
  }

  if (ctx.overdueReminders.length) {
    lines.push('*Overdue*')
    ctx.overdueReminders.slice(0, 3).forEach((r) => lines.push(`• ${r.message}`))
  }

  return lines.join('\n')
}

function formatFollowups(ctx: BriefingContext) {
  if (!ctx.followups.length) return ''
  return `*Follow-ups*\n${ctx.followups
    .slice(0, 4)
    .map((f) => `• ${f.contact_name}${f.context ? ` — ${String(f.context).slice(0, 80)}` : ''}`)
    .join('\n')}`
}

function formatTodos(ctx: BriefingContext) {
  if (!ctx.todos.length) return ''
  return `*Open tasks*\n${ctx.todos.slice(0, 5).map((t) => `• ${t.text}`).join('\n')}`
}

function formatNotes(ctx: BriefingContext) {
  if (!ctx.notes.length) return ''
  const lines = ctx.notes
    .slice(0, 3)
    .map((n: any) => cleanNoteForBriefing(n.text || ''))
    .filter(Boolean)
  if (!lines.length) return ''
  return `*Recent notes*\n${lines.map((line) => `• ${line}`).join('\n')}`
}

function formatMemory(ctx: BriefingContext) {
  const profile = ctx.memoryProfile
  if (!profile) return ''

  const contacts = topJsonItems(profile.frequent_contacts, { filterEntities: true, limit: 3 })
  const tasks = topJsonItems(profile.frequent_tasks, { hideGeneral: true, hideBriefing: true, limit: 4 })
  const times = topJsonItems(profile.common_times, { limit: 3 })

  const parts: string[] = []
  if (contacts.length) parts.push(`People/entities: ${contacts.join(', ')}`)
  if (tasks.length) parts.push(`Task patterns: ${tasks.join(', ')}`)
  if (times.length) parts.push(`Usual times: ${times.join(', ')}`)

  if (!parts.length) return ''
  return `*AskGogo Memory*\n${parts.map((p) => `• ${p}`).join('\n')}`
}

async function buildBriefing(user: UserRecord) {
  const ctx = await loadBriefingContext(user)
  const name = firstName(ctx.user.name)
  const dateStr = formatDateHeader(ctx.timezone)

  let weatherLine = ''
  try {
    const w = await fetch('https://wttr.in/Bengaluru?format=%C+%t&m', { signal: AbortSignal.timeout(3000) })
    const weather = (await w.text()).trim().replace(/\+/g, '')
    if (weather) weatherLine = `🌤 *Weather:* ${weather}`
  } catch {}

  const sections = [
    `🌅 *Good morning, ${name}!*`,
    dateStr,
    weatherLine,
    '',
    `🎯 ${buildPriorityLine(ctx)}`,
    '',
    formatReminderBlock(ctx),
    formatFollowups(ctx),
    formatTodos(ctx),
    formatNotes(ctx),
    formatMemory(ctx),
    '',
    `💬 Try: *tasks*, *my memory*, *show notes about Dr Gautami*, or *news*`,
  ]

  return sections.filter(Boolean).join('\n\n')
}

