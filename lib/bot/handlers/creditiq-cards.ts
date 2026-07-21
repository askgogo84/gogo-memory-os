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

function formatSynced(iso: string | null | undefined): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

function formatPortfolio(cards: any[]): string {
  const verified = cards.filter((c) => c?.verified)
  const selfReported = cards.filter((c) => !c?.verified)

  let out = `💳 *Your CreditIQ cards*\n`

  if (verified.length) {
    out += `\n✅ *Bank-verified*\n`
    for (const c of verified) {
      out += `• *${formatTitle(c)}*\n  ${formatBalance(c)}`
      const synced = formatSynced(c.synced_at)
      if (synced) out += `\n  _synced ${synced}_`
      out += `\n`
    }
  }

  if (selfReported.length) {
    out += `\n📝 *Self-reported* _(added by you — not bank-confirmed)_\n`
    for (const c of selfReported) {
      out += `• *${formatTitle(c)}*\n  ${formatBalance(c)} _(unverified)_\n`
    }
  }

  out += `\n_Bank-verified balances come straight from your bank via Account Aggregator. Self-reported cards are what you entered in the CreditIQ app._`
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

  console.log('CREDITIQ_CARDS_SHOWN:', { sender: senderKey, count: cards.length })
  return formatPortfolio(cards)
}
