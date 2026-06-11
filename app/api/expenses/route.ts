import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { parseExpenseText, generateDailyInsight } from '@/lib/bot/services/expense-analyzer'
import { saveExpense, getTodayExpenses, getPeriodExpenses } from '@/lib/bot/services/expense-storage'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

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
  const { phone, text, telegramId: directTelegramId } = await req.json()
  if (!text) return NextResponse.json({ error: 'text required' }, { status: 400 })

  const telegramId = directTelegramId || (phone ? await resolveUser(phone) : null)
  if (!telegramId) return NextResponse.json({ reply: "I couldn't find your account. Please message AskGogo on WhatsApp first." })

  const expense = await parseExpenseText(text)
  if (!expense) return NextResponse.json({ understood: false, reply: null })

  await saveExpense({ telegramId, expense })

  // Get today's total for context
  const today = await getTodayExpenses(telegramId)

  const catEmoji: Record<string, string> = {
    Food: '🍜', Transport: '🚗', Bills: '⚡', Shopping: '🛍️',
    Health: '💊', Entertainment: '🎬', Other: '📦'
  }

  const reply = [
    `${catEmoji[expense.category] || '💰'} *Logged ₹${expense.amount}* — ${expense.description}`,
    `Category: ${expense.category}`,
    ``,
    `Today's total: *₹${today.total}* (${today.count} transaction${today.count !== 1 ? 's' : ''})`,
    today.total > 0 ? `Top spend: ${today.topCategory} ₹${today.byCategory[today.topCategory]}` : '',
    ``,
    `Say *expenses today* for breakdown or *expense insight* for AI analysis.`,
  ].filter(l => l !== undefined).join('\n').trim()

  return NextResponse.json({ ok: true, reply })
}

// ── GET: summary or insight ───────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const phone = req.nextUrl.searchParams.get('phone')
  const period = (req.nextUrl.searchParams.get('period') || 'today') as 'today' | 'week' | 'month'
  const insight = req.nextUrl.searchParams.get('insight') === '1'

  if (!phone) return NextResponse.json({ error: 'phone required' }, { status: 400 })

  const telegramId = await resolveUser(phone)
  if (!telegramId) return NextResponse.json({ reply: "Account not found." })

  const catEmoji: Record<string, string> = {
    Food: '🍜', Transport: '🚗', Bills: '⚡', Shopping: '🛍️',
    Health: '💊', Entertainment: '🎬', Other: '📦'
  }

  if (period === 'today') {
    const today = await getTodayExpenses(telegramId)

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
        `📊 Today: ₹${today.total} across ${today.count} transactions`,
      ]
      return NextResponse.json({ reply: lines.join('\n') })
    }

    const breakdown = Object.entries(today.byCategory)
      .sort((a, b) => b[1] - a[1])
      .map(([cat, amt]) => `${catEmoji[cat] || '📦'} ${cat}: ₹${amt} (${Math.round(amt / today.total * 100)}%)`)
      .join('\n')

    const reply = [
      `📊 *Today's Expenses*`,
      `Total: *₹${today.total}* · ${today.count} transactions`,
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
  const data = await getPeriodExpenses(telegramId, period)
  if (!data) {
    return NextResponse.json({ reply: `No expenses logged this ${period} yet.` })
  }

  const breakdown = Object.entries(data.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `${catEmoji[cat] || '📦'} ${cat}: ₹${amt} (${Math.round(amt / data.total * 100)}%)`)
    .join('\n')

  const reply = [
    `📊 *${period === 'week' ? 'This Week' : 'This Month'}'s Expenses*`,
    `Total: *₹${data.total}* · ${data.count} transactions`,
    ``,
    breakdown,
  ].join('\n')

  return NextResponse.json({ reply })
}
