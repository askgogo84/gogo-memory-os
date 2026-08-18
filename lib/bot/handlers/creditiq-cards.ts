import { supabaseAdmin } from '@/lib/supabase-admin'

// AskGogo side of the CreditIQ portfolio read ("show my cards").
//
// Flow:
//  1. Resolve the WhatsApp sender → consumer_user_id via wa_creditiq_links.
//     No row → deterministic "not linked yet" prompt (never an LLM guess).
//  2. GET the consumer's read-only portfolio. NOTE the exact contract:
//       GET https://www.creditiq.app/api/wa/portfolio?uid=<consumer_user_id>
//       header x-wa-secret: WA_LINK_SECRET
//     Success = HTTP 200 with { uid, count, cards } — there is NO `ok` field,
//     so we gate on response.ok + cards.length.
//  3. Format for WhatsApp respecting CreditIQ's honesty model: AA-linked cards
//     (verified) are bank-confirmed; manual cards (unverified) are self-reported
//     and MUST NOT be presented as bank-confirmed.

const CREDITIQ_PORTFOLIO_URL = 'https://www.creditiq.app/api/wa/portfolio'

type HandleCreditIqCardsParams = {
  senderKey: string | null
}

const NOT_LINKED =
  `🔗 You haven't linked CreditIQ yet.\n\n` +
  `Open the *CreditIQ app*, generate a 6-digit link code, then send it here as:\n` +
  `*link creditiq <code>*\n\n` +
  `Once linked, I'll show your cards, points and cashback right here.`

const NO_CARDS =
  `💳 You're linked, but I don't see any cards yet.\n\n` +
  `Add your cards in the *CreditIQ app* and they'll show up here.`

const FETCH_ERROR = `⚠️ Couldn't fetch your cards right now. Please try again shortly.`

// "HDFC Regalia ••4321" (manual) / "HDFC ••4321" (AA-linked has no catalogue name).
function formatTitle(card: any): string {
  const mask = card.last4 ? `••${card.last4}` : ''
  const base = [card.bank, card.name].filter(Boolean).join(' ')
  return (mask ? `${base} ${mask}` : base).trim() || 'Card'
}

// "12,500 Points · ₹340 cashback"
function formatBalance(card: any): string {
  const points = Number(card.points || 0)
  const currency = card.points_currency || 'Points'
  let line = `${points.toLocaleString('en-IN')} ${currency}`
  const cashback = Number(card.cashback || 0)
  if (cashback > 0) line += ` · ₹${cashback.toLocaleString('en-IN')} cashback`
  return line
}

// "21 Jul" from the statement date. Empty string if missing/unparseable.
function formatStatementDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function formatPortfolio(cards: any[], totalPoints: number): string {
  const verified = cards.filter((c) => c?.verified)
  const selfReported = cards.filter((c) => !c?.verified)

  let out = `💳 *Your CreditIQ cards* · ${totalPoints.toLocaleString('en-IN')} pts total\n`

  if (verified.length) {
    out += `\n✅ *Verified*\n`
    for (const c of verified) {
      out += `• *${formatTitle(c)}*\n  ${formatBalance(c)}`
      const statement = formatStatementDate(c.statement_date)
      if (statement) out += `\n  statement ${statement}`
      out += `\n`
    }
  }

  if (selfReported.length) {
    out += `\n📝 *Self-entered*\n`
    for (const c of selfReported) {
      out += `• *${formatTitle(c)}*\n  ${formatBalance(c)}\n`
    }
  }

  out += `\nVerified balances are read from a statement you uploaded. Self-entered balances are what you typed into the CreditIQ app.`
  return out.trim()
}

export async function handleCreditIqCards({ senderKey }: HandleCreditIqCardsParams): Promise<string> {
  // No resolvable WhatsApp number → treat as not linked.
  if (!senderKey) return NOT_LINKED

  // 1) Resolve the link. No row → not linked.
  const { data: link, error: lookupError } = await supabaseAdmin
    .from('wa_creditiq_links')
    .select('consumer_user_id')
    .eq('sender', senderKey)
    .maybeSingle()

  if (lookupError) {
    console.error('CREDITIQ_CARDS_LOOKUP_FAILED:', lookupError)
    return FETCH_ERROR
  }
  if (!link?.consumer_user_id) return NOT_LINKED

  // 2) Fetch the portfolio (GET, ?uid=, shared-secret header).
  const url = `${CREDITIQ_PORTFOLIO_URL}?uid=${encodeURIComponent(String(link.consumer_user_id))}`
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      headers: { 'x-wa-secret': process.env.WA_LINK_SECRET || '' },
    })
  } catch (err) {
    console.error('CREDITIQ_CARDS_FETCH_FAILED:', err)
    return FETCH_ERROR
  }

  // No `ok` field in the body — gate on HTTP status.
  if (!res.ok) {
    console.error('CREDITIQ_CARDS_NON_200:', res.status)
    return FETCH_ERROR
  }

  let payload: any = null
  try {
    payload = await res.json()
  } catch {
    payload = null
  }

  const cards = Array.isArray(payload?.cards) ? payload.cards : []
  if (!cards.length) return NO_CARDS

  const totalPoints = Number(payload?.total_points || 0)

  console.log('CREDITIQ_CARDS_SHOWN:', { sender: senderKey, count: cards.length })
  return formatPortfolio(cards, totalPoints)
}
