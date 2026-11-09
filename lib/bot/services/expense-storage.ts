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

// ── Delete one expense ────────────────────────────────────────────────────────
// 21 Oct live: "Delete the 450 lunch at Truffles expense" reached the model, which said only "the CreditIQ app"
// could do it. Removes the most recent of the owner's last-30-day rows that matches the amount and/or words.
export async function deleteMatchingExpense(params: { telegramId: number; whatsappId?: string | null; amount?: number | null; words?: string[]; last?: boolean }) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString()
  const pick = async (column: 'telegram_id' | 'whatsapp_id', value: string | number) =>
    supabaseAdmin.from('expenses').select('id, amount, category, description, logged_at').eq(column, value).gte('logged_at', since).order('logged_at', { ascending: false }).limit(50)
  let res: any = await pick('telegram_id', params.telegramId)
  let column: 'telegram_id' | 'whatsapp_id' = 'telegram_id', owner: string | number = params.telegramId
  if (res.error && /telegram_id/.test(String(res.error.message || '')) && params.whatsappId) { res = await pick('whatsapp_id', params.whatsappId); column = 'whatsapp_id'; owner = params.whatsappId }
  if (res.error) throw new Error('expense_records_unavailable')
  const rows: any[] = res.data || []
  const words = (params.words || []).map(w => w.toLowerCase()).filter(w => w.length > 2)
  const match = params.last && params.amount == null && !words.length ? rows[0]
    : rows.find(r => (params.amount == null || Number(r.amount) === params.amount)
      && words.every(w => String(r.description || '').toLowerCase().includes(w)))
  if (!match) return null
  const { error } = await supabaseAdmin.from('expenses').delete().eq('id', match.id).eq(column, owner)
  if (error) throw new Error('expense_delete_failed')
  return match as { id: string; amount: number; category: string; description: string; logged_at: string }
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
/** IST Monday-start week or calendar month, through now. */
export function expensePeriodRange(period: 'week' | 'month' = 'week', now = new Date()) {
  const {dateStr}=getTodayRange('Asia/Kolkata',now)
  const localDay=new Date(`${dateStr}T00:00:00Z`)
  if(period==='week')localDay.setUTCDate(localDay.getUTCDate()-(localDay.getUTCDay()+6)%7)
  else localDay.setUTCDate(1)
  return {start:new Date(localDay.getTime()-330*60_000).toISOString(),end:now.toISOString(),timezone:'Asia/Kolkata'}
}

const MONTHS=['january','february','march','april','may','june','july','august','september','october','november','december']

/** 29 Oct (Muse 15): "spending statement for September" — the named calendar month in IST, the most recent one not in
 * the future. Null when no month is named. Pure. */
export function namedMonthRange(text: string, now = new Date()): { start: string; end: string; label: string; month: string } | null {
  const m = String(text || '').toLowerCase().match(/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(?:\s+(20\d\d))?/)
  if (!m) return null
  const idx = MONTHS.findIndex(x => x.startsWith(m[1].slice(0, 3)))
  const {dateStr}=getTodayRange('Asia/Kolkata',now)
  const curY = Number(dateStr.slice(0, 4)), curM = Number(dateStr.slice(5, 7)) - 1
  const year = m[2] ? Number(m[2]) : idx > curM ? curY - 1 : curY
  const startLocal = Date.UTC(year, idx, 1), endLocal = Date.UTC(year, idx + 1, 1)
  const start = new Date(startLocal - 330 * 60_000).toISOString()
  const end = new Date(Math.min(endLocal - 330 * 60_000, now.getTime())).toISOString()
  return { start, end, label: `${MONTHS[idx][0].toUpperCase()}${MONTHS[idx].slice(1)} ${year}`, month: `${year}-${String(idx + 1).padStart(2, '0')}` }
}

export async function getRangeExpenses(telegramId: number, start: string, end: string, whatsappId?: string | null) {
  const rows = await expenseRows(telegramId, whatsappId, start, end)
  const byCategory: Record<string, number> = {}
  let total = 0
  for (const r of rows || []) { total += Number(r.amount); byCategory[r.category] = (byCategory[r.category] || 0) + Number(r.amount) }
  return { total, count: (rows || []).length, byCategory, entries: rows || [] }
}

export async function getPeriodExpenses(telegramId: number, period: 'week' | 'month' = 'week', whatsappId?: string | null) {
  const {start,end}=expensePeriodRange(period)
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
