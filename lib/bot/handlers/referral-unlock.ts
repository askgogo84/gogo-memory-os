import { supabaseAdmin } from '@/lib/supabase-admin'
import { waLink } from '@/lib/product-urls'

const ASK_GOGO_WHATSAPP_LINK =
  process.env.ASK_GOGO_WHATSAPP_JOIN_LINK ||
  waLink('Hi AskGogo')

function cleanReferralId(value: number | string) {
  return String(value).replace(/\D/g, '').slice(-10)
}

function referralCodeForTelegramId(telegramId: number) {
  return `GOGO-${cleanReferralId(telegramId)}`
}

function buildReferralLink(code: string) {
  const base = ASK_GOGO_WHATSAPP_LINK.split('?')[0]
  const text = encodeURIComponent(`Hi AskGogo ${code}`)
  return `${base}?text=${text}`
}

function extractReferralCode(text: string) {
  const match = (text || '').match(/\bGOGO-?(\d+)\b/i)
  if (!match) return null
  return `GOGO-${cleanReferralId(match[1])}`
}

function referralIdFromCode(code: string) {
  const match = code.match(/GOGO-?(\d+)/i)
  if (!match) return null
  return cleanReferralId(match[1])
}

async function findUserByReferralCode(code: string) {
  const referralId = referralIdFromCode(code)
  if (!referralId) return null

  // Legacy public codes are derived from the final 10 digits of signed owner
  // IDs, not from WhatsApp phone numbers. Resolve across ALL persisted owner
  // IDs in ONE bounded database read (one consistent SQL statement), or refuse
  // to credit anyone. An indexed durable code mapping is needed at scale.
  const MAX_SINGLE_SNAPSHOT_OWNERS = 1000
  const { data, error, count } = await supabaseAdmin
    .from('users')
    .select('telegram_id', { count: 'exact' })
    .not('telegram_id', 'is', null)
    .limit(MAX_SINGLE_SNAPSHOT_OWNERS)

  // A PostgREST max-rows setting can silently return fewer than requested.
  // Only a complete one-statement result can establish uniqueness; refuse
  // oversized, truncated or unknown-count tables instead of paginating.
  if (error || !Array.isArray(data) || !Number.isSafeInteger(count)
    || count === null || count < 0 || count > MAX_SINGLE_SNAPSHOT_OWNERS
    || data.length !== count) return null

  let found: { telegram_id: number } | null = null
  for (const row of data) {
    // PostgREST may JSON-decode BIGINT into an imprecise JavaScript Number
    // before we see it. Such a row could hide a colliding referral suffix.
    if (typeof row?.telegram_id === 'number' && !Number.isSafeInteger(row.telegram_id)) return null
    const rawId = String(row?.telegram_id ?? '').trim()
    if (!/^-?[1-9][0-9]*$/.test(rawId)) continue
    if (cleanReferralId(rawId) !== referralId) continue
    const owner = Number(rawId)
    if (!Number.isSafeInteger(owner) || owner === 0 || String(owner) !== rawId) return null
    if (found) return null
    found = { telegram_id: owner }
  }
  return found
}

export function isShareMyWinCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'share my win' ||
    lower === 'share win' ||
    lower === 'my win' ||
    lower === 'share askgogo' ||
    lower === 'share askgogo win' ||
    lower === 'what should i share' ||
    lower === 'give me share message'
  )
}

export function isReferralCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    isShareMyWinCommand(text) ||
    lower === 'invite' ||
    lower === 'invite friends' ||
    lower === 'invite friend' ||
    lower === 'invite frnds' ||
    lower === 'invite frnd' ||
    lower === 'refer' ||
    lower === 'referral' ||
    lower === 'share' ||
    lower === 'my referral' ||
    lower === 'referral status' ||
    lower === 'my referral status' ||
    lower.includes('invite my friends') ||
    lower.includes('invite my frnds') ||
    lower.includes('refer friends') ||
    lower.includes('refer frnds')
  )
}

export async function recordReferralJoinFromText(params: {
  text: string
  referredTelegramId: number
  referredExternalId: string
  referredName?: string
}) {
  const code = extractReferralCode(params.text)
  if (!code) return null

  // Inbound identity must be a safe exact actor before any cross-owner write.
  if (!Number.isSafeInteger(params.referredTelegramId) || params.referredTelegramId === 0)
    return { code, saved: false, reason: 'invalid_referred_owner' }

  const referrer = await findUserByReferralCode(code)
  if (!referrer?.telegram_id) return null

  const referrerTelegramId = Number(referrer.telegram_id)
  if (!Number.isSafeInteger(referrerTelegramId) || referrerTelegramId === 0) return null

  if (referrerTelegramId === params.referredTelegramId) {
    return { code, saved: false, reason: 'self_referral' }
  }

  const uniqueKey = `ASKGOGO_REFERRAL_JOINED:${code}:${params.referredExternalId}`

  const { data: existing, error: existingError } = await supabaseAdmin
    .from('memories')
    .select('id')
    .eq('telegram_id', referrerTelegramId)
    .like('content', `${uniqueKey}%`)
    .limit(1)

  if (existingError) return { code, saved: false, reason: 'lookup_unavailable' }
  if (existing?.length) return { code, saved: false, reason: 'already_recorded' }

  await supabaseAdmin.from('memories').insert({
    telegram_id: referrerTelegramId,
    content:
      uniqueKey +
      JSON.stringify({
        referredTelegramId: params.referredTelegramId,
        referredExternalId: params.referredExternalId,
        referredName: params.referredName || null,
        created_at: new Date().toISOString(),
      }),
  })

  await supabaseAdmin.from('memories').insert({
    telegram_id: params.referredTelegramId,
    content: `ASKGOGO_REFERRED_BY:${code}`,
  })

  return { code, saved: true, reason: 'recorded' }
}

async function getReferralCount(telegramId: number) {
  const code = referralCodeForTelegramId(telegramId)

  const { count } = await supabaseAdmin
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('telegram_id', telegramId)
    .like('content', `ASKGOGO_REFERRAL_JOINED:${code}:%`)

  return count || 0
}

function progressBar(count: number) {
  const filled = Math.min(count, 3)
  return '🟩'.repeat(filled) + '⬜'.repeat(3 - filled)
}

function buildViralInviteCopy(link: string) {
  return (
    `“I found something genuinely useful 👇\n\n` +
    `AskGogo is a personal AI assistant inside WhatsApp.\n\n` +
    `You can just type or send a voice note like:\n\n` +
    `• remind me in 10 mins\n` +
    `• plan my day\n` +
    `• read this screenshot\n` +
    `• save this note\n` +
    `• what’s on my calendar today\n\n` +
    `No new app.\n` +
    `No complicated prompts.\n` +
    `Just WhatsApp.\n\n` +
    `They’re opening founder beta access now.\n\n` +
    `Try it here:\n` +
    `${link}\n\n` +
    `Once it opens, just send *Hi*.”`
  )
}

function buildShareWinCopy(link: string) {
  return (
    `“Small win today — I used AskGogo inside WhatsApp to reduce my mental clutter.\n\n` +
    `I can now just send a message or voice note for:\n` +
    `• reminders\n` +
    `• day planning\n` +
    `• notes\n` +
    `• screenshots / image notes\n` +
    `• calendar checks\n\n` +
    `No new app. No learning curve. Just WhatsApp.\n\n` +
    `Try the founder beta here:\n` +
    `${link}\n\n` +
    `Once it opens, just send *Hi*.”`
  )
}

export async function buildShareMyWinReply(telegramId: number) {
  const code = referralCodeForTelegramId(telegramId)
  const link = buildReferralLink(code)

  return (
    `🚀 *Share your AskGogo win*\n\n` +
    `Copy and post/send this to WhatsApp groups, friends, or LinkedIn comments:\n\n` +
    buildShareWinCopy(link) +
    `\n\nYour referral link is already included.`
  )
}

export async function buildReferralUnlockReply(telegramId: number) {
  const code = referralCodeForTelegramId(telegramId)
  const count = await getReferralCount(telegramId)
  const remaining = Math.max(3 - count, 0)
  const link = buildReferralLink(code)

  const unlockText =
    count >= 3
      ? `✅ *Unlocked:* Founder Pro trial priority for 30 days when paid plans go live.`
      : `Invite *${remaining} more* friend${remaining === 1 ? '' : 's'} to unlock Founder Pro trial priority.`

  return (
    `🎁 *AskGogo Referral Unlock*\n\n` +
    `Share AskGogo with friends who live on WhatsApp.\n\n` +
    `Your referral code:\n` +
    `*${code}*\n\n` +
    `Your invite link:\n` +
    `${link}\n\n` +
    `Progress:\n` +
    `${progressBar(count)} ${Math.min(count, 3)} / 3 joined\n\n` +
    `${unlockText}\n\n` +
    `*Copy and send this:*\n\n` +
    buildViralInviteCopy(link)
  )
}

export async function buildReferralWelcomeNote(text: string) {
  const code = extractReferralCode(text)
  if (!code) return null

  return (
    `🎁 Referral code detected: *${code}*\n\n` +
    `Welcome to AskGogo founder beta. I work inside WhatsApp.\n\n` +
    `Try these now:\n` +
    `• Remind me in 10 mins to drink water\n` +
    `• Plan my day\n` +
    `• My notes\n` +
    `• Bangalore weather tomorrow\n\n` +
    `💚 *Founder beta perk*\n` +
    `After you try it, type *invite friends*.\n` +
    `I’ll create your own referral link. Invite 3 friends to unlock Founder Pro trial priority when paid plans go live.\n\n` +
    `You can type or send a voice note.`
  )
}
