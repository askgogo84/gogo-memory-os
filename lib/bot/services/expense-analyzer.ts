import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export interface ExpenseEntry {
  amount: number
  category: 'Food' | 'Transport' | 'Bills' | 'Shopping' | 'Health' | 'Entertainment' | 'Other'
  description: string
  rawText: string
}

export interface DailyExpenseSummary {
  total: number
  count: number
  byCategory: Record<string, number>
  topCategory: string
  entries: Array<{ amount: number; category: string; description: string; time: string }>
}

// ── Parse natural language expense using Claude ───────────────────────────────
export async function parseExpenseText(text: string): Promise<ExpenseEntry | null> {
  // Fast regex path for common patterns — no AI needed
  const patterns = [
    // "spent 450 on lunch", "paid 200 for petrol"
    /(?:spent|paid|cost|expensed?)\s+(?:rs\.?|₹|inr)?\s*(\d+(?:\.\d+)?)\s+(?:on|for)\s+(.+)/i,
    // "450 on lunch", "200 for petrol"
    /(?:rs\.?|₹|inr)?\s*(\d+(?:\.\d+)?)\s+(?:on|for)\s+(.+)/i,
    // "lunch 250", "coffee 80"
    /^([a-z][\w\s]+?)\s+(\d+(?:\.\d+)?)$/i,
    // "250 lunch", "80 coffee"
    /^(\d+(?:\.\d+)?)\s+([a-z].+)$/i,
    // "rs 450 lunch", "₹250 zomato"
    /(?:rs\.?|₹|inr)\s*(\d+(?:\.\d+)?)\s+(.+)/i,
  ]

  for (const p of patterns) {
    const m = text.match(p)
    if (m) {
      let amount: number, desc: string
      if (p.source.startsWith('^([a-z]')) {
        desc = m[1].trim(); amount = parseFloat(m[2])
      } else {
        amount = parseFloat(m[1]); desc = m[2]?.trim() || m[1]?.trim()
      }
      if (amount > 0 && amount < 1000000 && desc) {
        return { amount, category: categorizeLocally(desc), description: desc, rawText: text }
      }
    }
  }

  // Fallback: Claude parses ambiguous text
  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract expense from this message. Reply ONLY with JSON like {"amount": 250, "description": "coffee", "category": "Food"} or null if not an expense.\n\nCategories: Food, Transport, Bills, Shopping, Health, Entertainment, Other\n\nMessage: "${text}"`
      }]
    })
    const raw = res.content[0].type === 'text' ? res.content[0].text.trim() : ''
    const parsed = JSON.parse(raw.replace(/```json|```/g, '').trim())
    if (parsed && parsed.amount > 0) {
      return { amount: parsed.amount, category: parsed.category || 'Other', description: parsed.description, rawText: text }
    }
  } catch {}
  return null
}

// ── Local categorization (fast, no AI) ───────────────────────────────────────
function categorizeLocally(desc: string): ExpenseEntry['category'] {
  const l = desc.toLowerCase()
  if (/food|lunch|dinner|breakfast|chai|tea|coffee|zomato|swiggy|blinkit|zepto|meal|snack|restaurant|hotel|eat|biryani|dosa|pizza|burger|juice|water/.test(l)) return 'Food'
  if (/uber|ola|auto|cab|taxi|petrol|fuel|metro|bus|train|flight|rapido|yulu|bounce|parking|toll/.test(l)) return 'Transport'
  if (/amazon|flipkart|myntra|shop|cloth|dress|shirt|shoe|purchase|buy|order/.test(l)) return 'Shopping'
  if (/doctor|medicine|pharmacy|hospital|clinic|tablet|medic|health|apollo|1mg/.test(l)) return 'Health'
  if (/rent|electricity|internet|recharge|phone|wifi|water bill|gas|emi|loan|credit/.test(l)) return 'Bills'
  if (/movie|netflix|prime|spotify|game|cricket|concert|ticket|bookmyshow|event/.test(l)) return 'Entertainment'
  return 'Other'
}

// ── AI insight on daily spending ──────────────────────────────────────────────
export async function generateDailyInsight(summary: DailyExpenseSummary): Promise<string> {
  if (summary.count === 0) return 'No expenses logged today.'

  const breakdown = Object.entries(summary.byCategory)
    .sort((a, b) => b[1] - a[1])
    .map(([cat, amt]) => `${cat}: ₹${amt} (${Math.round(amt / summary.total * 100)}%)`)
    .join(', ')

  try {
    const res = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `Today's spending: ₹${summary.total} across ${summary.count} transactions. Breakdown: ${breakdown}.

Give 2-3 sharp, honest insights. Be specific with numbers. Note what's high, what's normal, and one tip for tomorrow. Under 80 words. Conversational tone, no bullet points.`
      }]
    })
    return res.content[0].type === 'text' ? res.content[0].text.trim() : 'Could not generate insight.'
  } catch {
    return `Spent ₹${summary.total} today across ${summary.count} transactions. Most went to ${summary.topCategory}.`
  }
}
