import { supabaseAdmin } from '@/lib/supabase-admin'

export type DashboardTask = {
  id: string
  label: string
  createdAt: string | null
  doneAt: string | null
  done: boolean
}

export type DashboardTasks = {
  ok: true
  open: DashboardTask[]
  completed: DashboardTask[]
} | { ok: false }

export async function getDashboardTasks(telegramId: string): Promise<DashboardTasks> {
  const tgNum = parseInt(telegramId, 10)
  if (!Number.isFinite(tgNum)) return { ok: true, open: [], completed: [] }

  try {
    const { data: user, error: userError } = await supabaseAdmin
      .from('users')
      .select('whatsapp_id')
      .eq('telegram_id', tgNum)
      .maybeSingle()

    if (userError) {
      console.error('DASHBOARD_TASK_USER_FAILED:', userError)
      return { ok: false }
    }

    const whatsappId = String(user?.whatsapp_id || '').trim()
    if (!whatsappId) return { ok: true, open: [], completed: [] }

    const { data, error } = await supabaseAdmin
      .from('todos')
      .select('id, text, done, created_at, done_at')
      .eq('whatsapp_id', whatsappId)
      .order('created_at', { ascending: false })
      .limit(250)

    if (error) {
      console.error('DASHBOARD_TASKS_FAILED:', error)
      return { ok: false }
    }

    const rows: DashboardTask[] = (data || []).map((row: any) => ({
      id: String(row.id),
      label: String(row.text || 'Task').replace(/\s+/g, ' ').trim(),
      createdAt: row.created_at ? String(row.created_at) : null,
      doneAt: row.done_at ? String(row.done_at) : null,
      done: row.done === true,
    }))

    return {
      ok: true,
      open: rows.filter(task => !task.done),
      completed: rows.filter(task => task.done).sort((a, b) => {
        const aMs = new Date(a.doneAt || a.createdAt || 0).getTime()
        const bMs = new Date(b.doneAt || b.createdAt || 0).getTime()
        return bMs - aMs
      }),
    }
  } catch (error) {
    console.error('DASHBOARD_TASKS_FAILED:', error)
    return { ok: false }
  }
}
