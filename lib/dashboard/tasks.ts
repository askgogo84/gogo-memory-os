import { supabaseAdmin } from '@/lib/supabase-admin'

export type DashboardTask = {
  id: string
  label: string
  remindAt: string
  sent: boolean
  recurring: boolean
}

export type DashboardTasks = {
  ok: true
  today: DashboardTask[]
  upcoming: DashboardTask[]
  completed: DashboardTask[]
} | { ok: false }

function dayKey(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso))
}

export async function getDashboardTasks(telegramId: string, tz = 'Asia/Kolkata'): Promise<DashboardTasks> {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return { ok: true, today: [], upcoming: [], completed: [] }

  try {
    const now = new Date()
    const from = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const to = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString()

    const { data, error } = await supabaseAdmin
      .from('reminders')
      .select('id, message, remind_at, sent, is_recurring')
      .eq('telegram_id', tgNum)
      .gte('remind_at', from)
      .lte('remind_at', to)
      .order('remind_at', { ascending: true })
      .limit(250)

    if (error) {
      console.error('DASHBOARD_TASKS_FAILED:', error)
      return { ok: false }
    }

    const todayKey = dayKey(now.toISOString(), tz)
    const rows: DashboardTask[] = (data || []).map((row: any) => ({
      id: String(row.id),
      label: String(row.message || 'Reminder'),
      remindAt: String(row.remind_at),
      sent: row.sent === true,
      recurring: row.is_recurring === true,
    }))

    const today: DashboardTask[] = []
    const upcoming: DashboardTask[] = []
    const completed: DashboardTask[] = []

    for (const task of rows) {
      if (task.sent || new Date(task.remindAt).getTime() < now.getTime()) {
        completed.push(task)
        continue
      }
      if (dayKey(task.remindAt, tz) === todayKey) today.push(task)
      else upcoming.push(task)
    }

    return {
      ok: true,
      today: today.slice(0, 60),
      upcoming: upcoming.slice(0, 100),
      completed: completed.slice(-60).reverse(),
    }
  } catch (error) {
    console.error('DASHBOARD_TASKS_FAILED:', error)
    return { ok: false }
  }
}
