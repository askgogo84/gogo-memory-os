import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseExpenseText, generateDailyInsight } from '@/lib/bot/services/expense-analyzer'
import { saveExpense, getTodayExpenses, getPeriodExpenses, expensePeriodRange, deleteMatchingExpense } from '@/lib/bot/services/expense-storage'
import { isInternalServiceAuthorized } from '@/lib/security/cron-auth'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// 20 Oct live: "1 transactions". Not exported: a route file may export only route handlers and config.
function transactionCount(n: number) { return `${n} transaction${n === 1 ? '' : 's'}` }

async function resolveUser(phone: string) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('telegram_id')
    .or(`whatsapp_id.eq.${phone},whatsapp_id.eq.whatsapp:${phone}`)
    .maybeSingle()
  return data?.telegram_id || null
}

// ── POST: log an expense ──────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // Internal service call only (bot pipeline). `phone`/`telegramId` are the target
  // owner supplied by the trusted caller, not authorization.
  if (!isInternalServiceAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const { phone, text, telegramId: directTelegramId, action, amount, words, last } = await req.json()
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const telegramId = directTelegramId || (phone ? await resolveUser(phone) : null)
  if (!telegramId) return NextResponse.json({ reply: "I couldn't find your account. Please message AskGogo on WhatsApp first." })

  if (action === 'delete') {
    const removed = await deleteMatchingExpense({ telegramId, whatsappId: phone || null, amount: Number.isFinite(Number(amount)) && amount != null ? Number(amount) : null, words: Array.isArray(words) ? words.map(String).slice(0, 6) : [], last: last === true })
      .catch(() => 'error' as const)
    if (removed === 'error') return NextResponse.json({ reply: "I couldn't remove that expense just now. Nothing was deleted. Please try again in a minute." })
    if (!removed) return NextResponse.json({ reply: "I couldn't find a matching expense in the last 30 days, so nothing was deleted. Say *expenses this week* to see them." })
    const day = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' }).format(new Date(removed.logged_at))
    return NextResponse.json({ ok: true, reply: `🗑️ Removed ₹${removed.amount} — ${removed.description} (${day}).` })
  }

  const expense = await parseExpenseText(text)
  if (!expense) return NextResponse.json({ understood: false, reply: null })

  // 17 Oct live: the insert failed (production table lacks raw_text) and the reply still said "Logged".
  const saved = await saveExpense({ telegramId, expense, whatsappId: phone || null })
  if (!saved) return NextResponse.json({ reply: "I couldn't save that expense just now, so nothing was logged. Please try again in a minute." })

  // Get today's total for context
  const today:Awaited<ReturnType<typeof getTodayExpenses>>|null = await getTodayExpenses(telegramId, phone || null).catch(()=>null)

  const catEmoji: Record<string, string> = {
    Food: '🍜', Transport: '🚗', Bills: '⚡', Shopping: '🛍️',
    Health: '💊', Entertainment: '🎬', Other: '📦'
  }

  const reply = [
    `${catEmoji[expense.category] || '💰'} *Logged ₹${expense.amount}* — ${expense.description}`,
    `Category: ${expense.category}`,
    ``,
    today?`Today's total: *₹${today.total}* (${today.count} transaction${today.count !== 1 ? 's' : ''})`:'The expense was saved, but totals are temporarily unavailable. Do not log it again.',
    today&&today.total > 0 ? `Top spend: ${today.topCategory} ₹${today.byCategory[today.topCategory]}` : '',
    ``,
    `Say *expenses today* for breakdown or *expense insight* for AI analysis.`,
  ].filter(l => l !== undefined).join('\n').trim()

  return NextResponse.json({ ok: true, reply })
}

// ── GET: summary or insight ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // Internal service call only (bot pipeline). `phone` is the target owner, not auth.
  if (!isInternalServiceAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const phone = req.nextUrl.searchParams.get('phone')
  const period = (req.nextUrl.searchParams.get('period') || 'today') as 'today' | 'week' | 'month'
  const insight = req.nextUrl.searchParams.get('insight') === '1'

  if (!phone && !req.nextUrl.searchParams.get('telegramId')) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  // 17 Oct: from the web chat the phone did not match the stored WhatsApp id ("Account not found").
  // The trusted caller now passes the owner's telegramId as well, as POST already allows.
  const directTelegramId = req.nextUrl.searchParams.get('telegramId')
  const telegramId = (directTelegramId && /^-?\d+$/.test(directTelegramId) ? Number(directTelegramId) : null) || await resolveUser(phone)
  if (!telegramId) return NextResponse.json({ reply: "I couldn't find your expenses yet. Log one like “spent 450 on lunch”." })

  const catEmoji: Record<string, string> = {
    Food: '🍜', Transport: '🚗', Bills: '⚡', Shopping: '🛍️',
    Health: '💊', Entertainment: '🎬', Other: '📦'
  }

  if (period === 'today') {
    const today:Awaited<ReturnType<typeof getTodayExpenses>>|null = await getTodayExpenses(telegramId, phone || null).catch(()=>null)
    if(!today)return NextResponse.json({reply:'I could not read your expense records right now. Your spending total is unavailable; I have not changed any records.'},{status:503})

    if (today.count === 0) {
      return NextResponse.json({ reply: "No expenses logged today yet.\n\nSay *spent 200 on lunch* to start tracking! 💰" })
    }

    if (insight) {
      const aiText = await generateDailyInsight(today)
      const lines = [
        `✨ *AI Expense Insight*`,
        ``,
        aiText,
        ``,
        `📊 Today: ₹${today.total} across ${transactionCount(today.count)}`,
      ]
      return NextResponse.json({ reply: lines.join('\n') })
    }

    const breakdown = Object.entries(today.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `${catEmoji[cat] || '📦'} ${cat}: ₹${amt} (${Math.round(amt / today.total * 100)}%)`)
      .join('\n')

    const reply = [
      `📊 *Today's Expenses*`,
      `Total: *₹${today.total}* · ${transactionCount(today.count)}`,
      ``,
      breakdown,
      ``,
      `Recent:`,
      ...today.entries.slice(0, 5).map(e => `  • ${catEmoji[e.category] || '📦'} ₹${e.amount} — ${e.description} (${e.time})`),
      ``,
      `Say *expense insight* for AI analysis.`,
    ].join('\n')

    return NextResponse.json({ reply })
  }

  // Week or month
  const result=await getPeriodExpenses(telegramId,period,phone||null).then(data=>({data,error:false}),()=>({data:null,error:true}))
  if(result.error)return NextResponse.json({reply:'I could not read your expense records right now. Your spending total is unavailable; I have not changed any records.'},{status:503})
  const data:Awaited<ReturnType<typeof getPeriodExpenses>>=result.data
  const rangeLine=(range:{start:string;end:string;timezone:string})=>`Range: ${new Date(range.start).toLocaleDateString('en-IN',{timeZone:range.timezone})} through ${new Date(range.end).toLocaleDateString('en-IN',{timeZone:range.timezone})} (${range.timezone}; ${period==='week'?'Monday-start week':'calendar month'}, through now)`
  if (!data) {
    // A successful empty read is a verified zero for this exact range, not an unknown.
    return NextResponse.json({ reply: [`📊 *${period === 'week' ? 'This Week' : 'This Month'}'s Expenses*`,rangeLine(expensePeriodRange(period)),'Total: *₹0* · 0 transactions','No expense entries are recorded in this range.'].join('\n') })
  }

  const breakdown = Object.entries(data.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `${catEmoji[cat] || '📦'} ${cat}: ₹${amt} (${Math.round(amt / data.total * 100)}%)`)
    .join('\n')

  const reply = [
    `📊 *${period === 'week' ? 'This Week' : 'This Month'}'s Expenses*`,
    ...(data.range?[rangeLine(data.range)]:[]),
    `Total: *₹${data.total}* · ${transactionCount(data.count)}`,
    ``,
    breakdown,
    '',
    `Recent entries (${Math.min(data.entries.length,20)} of ${data.count}):`,
    ...data.entries.slice(0,20).map(e=>`• ₹${e.amount} — ${e.description} (${e.category}; ${new Date(e.logged_at).toLocaleDateString('en-IN',{timeZone:'Asia/Kolkata'})})`),
  ].join('\n')

  return NextResponse.json({ reply })
}
