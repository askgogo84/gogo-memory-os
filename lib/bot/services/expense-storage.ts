import { supabaseAdmin } from '@/lib/supabase-admin'
import type { ExpenseEntry, DailyExpenseSummary } from './expense-analyzer'

function getTodayRange(tz = 'Asia/Kolkata', now = new Date()) {
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
    // telegram_id may go only when the row still names its owner by whatsapp_id.
    if (!missing || !(missing[1] in row) || missing[1] === 'amount' || (missing[1] === 'telegram_id' && !params.whatsappId)) {
      console.error('[expense-storage] save failed:', error.message)
      return null
    }
    delete row[missing[1]]
  }
  return null
}


// 18 Oct: production's expenses table predates telegram_id (expenses-v2.sql was never run). Rows are read by
// telegram_id, or by the owner's WhatsApp id when that column does not exist yet.
async function expenseRows(telegramId: number, whatsappId: string | null | undefined, since: string, until?: string) {
  const run = (column: 'telegram_id' | 'whatsapp_id', value: string | number) => {
    let q = supabaseAdmin.from('expenses').select('amount, category, description, logged_at').eq(column, value).gte('logged_at', since)
    if (until) q = q.lte('logged_at', until)
    return q.order('logged_at', { ascending: false })
  }
  const first = await run('telegram_id', telegramId)
  if (!first.error) return first.data || []
  if (/telegram_id/.test(String(first.error.message || '')) && whatsappId) {
    const second = await run('whatsapp_id', whatsappId)
    if (!second.error) return second.data || []
  }
  console.error('[expense-storage] read failed:', first.error.message)
  throw new Error('expense_records_unavailable')
}

// ── Get today's expenses ──────────────────────────────────────────────────────
export async function getTodayExpenses(telegramId: number, whatsappId?: string | null): Promise<DailyExpenseSummary> {
  const { start, end } = getTodayRange()
  const rows = await expenseRows(telegramId, whatsappId, start, end)

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
export async function getPeriodExpenses(telegramId: number, period: 'week' | 'month' = 'week', whatsappId?: string | null) {
  const now=new Date()
  const {dateStr}=getTodayRange('Asia/Kolkata',now)
  const localDay=new Date(`${dateStr}T00:00:00Z`)
  if(period==='week')localDay.setUTCDate(localDay.getUTCDate()-(localDay.getUTCDay()+6)%7)
  else localDay.setUTCDate(1)
  const start=new Date(localDay.getTime()-330*60_000).toISOString()
  const end=now.toISOString()
  const rows = await expenseRows(telegramId, whatsappId, start,end)

  if (!rows?.length) return null

  const byCategory: Record<string, number> = {}
  let total = 0
  for (const r of rows) {
    total += Number(r.amount)
    byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount)
  }

  return { total, count: rows.length, byCategory, entries: rows,range:{start,end,timezone:'Asia/Kolkata'} }
}
