import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ExpenseEntry, DailyExpenseSummary } from './expense-analyzer'

function getTodayRange(tz = 'Asia/Kolkata') {
  const now = new Date()
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
  const dateStr = formatter.format(now)
  const startOfDay = new Date(`${dateStr}T00:00:00+05:30`)
  const endOfDay = new Date(`${dateStr}T23:59:59+05:30`)
  return { start: startOfDay.toISOString(), end: endOfDay.toISOString(), dateStr }
}

// ── Save expense ──────────────────────────────────────────────────────────────
export async function saveExpense(params: {
  telegramId: number
  expense: ExpenseEntry
  whatsappId?: string | null
}) {
  const row: Record<string, unknown> = {
    telegram_id: params.telegramId,
    // The original table requires whatsapp_id; the owner is still identified by telegram_id.
    whatsapp_id: params.whatsappId || String(params.telegramId),
    amount: params.expense.amount,
    category: params.expense.category,
    description: params.expense.description,
    raw_text: params.expense.rawText,
    logged_at: new Date().toISOString(),
  }
  // 17 Oct live: production never got the raw_text column (expenses-v2.sql), so every insert failed.
  // A column the table does not have is dropped and the insert retried, once per missing column.
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error, data } = await supabaseAdmin.from('expenses').insert(row).select('id').single()
    if (!error) return data
    const missing = String(error.message || '').match(/Could not find the '([a-z_]+)' column/)
    if (!missing || !(missing[1] in row) || missing[1] === 'amount' || missing[1] === 'telegram_id') {
      console.error('[expense-storage] save failed:', error.message)
      return null
    }
    delete row[missing[1]]
  }
  return null
}

// ── Get today's expenses ──────────────────────────────────────────────────────
export async function getTodayExpenses(telegramId: number): Promise<DailyExpenseSummary> {
  const { start, end } = getTodayRange()

  const { data: rows } = await supabaseAdmin
    .from('expenses')
    .select('amount, category, description, logged_at')
    .eq('telegram_id', telegramId)
    .gte('logged_at', start)
    .lte('logged_at', end)
    .order('logged_at', { ascending: false })

  if (!rows?.length) {
    return { total: 0, count: 0, byCategory: {}, topCategory: '', entries: [] }
  }

  const byCategory: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    total += Number(r.amount)
    byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount)
  }
  const topCategory = Object.entries(byCategory).sort((a, b) => b[1] - a[1])[0]?.[0] || ''

  return {
    total,
    count: rows.length,
    byCategory,
    topCategory,
    entries: rows.map(r => ({
      amount: Number(r.amount),
      category: r.category,
      description: r.description,
      time: new Date(r.logged_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' }),
    }))
  }
}

// ── Get period expenses (week/month) ─────────────────────────────────────────
export async function getPeriodExpenses(telegramId: number, period: 'week' | 'month' = 'week') {
  const since = new Date()
  if (period === 'week') since.setDate(since.getDate() - 7)
  else since.setDate(1)

  const { data: rows } = await supabaseAdmin
    .from('expenses')
    .select('amount, category, description, logged_at')
    .eq('telegram_id', telegramId)
    .gte('logged_at', since.toISOString())
    .order('logged_at', { ascending: false })

  if (!rows?.length) return null

  const byCategory: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    total += Number(r.amount)
    byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount)
  }

  return { total, count: rows.length, byCategory, entries: rows }
}
