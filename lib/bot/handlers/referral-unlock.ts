import { supabaseAdmin } from '@/lib/supabase-admin'

const ASK_GOGO_WHATSAPP_LINK =
  process.env.ASK_GOGO_WHATSAPP_JOIN_LINK ||
  'https://wa.me/15797006612?text=Hi%20AskGogo'

function referralCodeForTelegramId(telegramId: number) {
  return `GOGO-${telegramId}`
}

function buildReferralLink(code: string) {
  const base = ASK_GOGO_WHATSAPP_LINK.split('?')[0]
  const text = encodeURIComponent(`Hi AskGogo ${code}`)
  return `${base}?text=${text}`
}

function extractReferralCode(text: string) {
  const match = (text || '').match(/\bGOGO-(\d+)\b/i)
  if (!match) return null
  return `GOGO-${match[1]}`
}

function telegramIdFromReferralCode(code: string) {
  const match = code.match(/GOGO-(\d+)/i)
  if (!match) return null
  return Number(match[1])
}

export function isReferralCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  return (
    lower === 'invite' ||
    lower === 'invite friends' ||
    lower === 'refer' ||
    lower === 'referral' ||
    lower === 'share' ||
    lower === 'my referral' ||
    lower === 'referral status' ||
    lower === 'my referral status' ||
    lower.includes('invite my friends') ||
    lower.includes('refer friends')
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

  const referrerTelegramId = telegramIdFromReferralCode(code)
  if (!referrerTelegramId) return null

  if (referrerTelegramId === params.referredTelegramId) {
    return {
      code,
      saved: false,
      reason: 'self_referral',
    }
  }

  const uniqueKey = `ASKGOGO_REFERRAL_JOINED:${code}:${params.referredExternalId}`

  const { data: existing } = await supabaseAdmin
    .from('memories')
    .select('id')
    .eq('telegram_id', referrerTelegramId)
    .like('content', `${uniqueKey}%`)
    .limit(1)

  if (existing?.length) {
    return {
      code,
      saved: false,
      reason: 'already_recorded',
    }
  }

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

  return {
    code,
    saved: true,
    reason: 'recorded',
  }
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
    `Invite 3 friends who live on WhatsApp.\n\n` +
    `Your referral code:\n` +
    `*${code}*\n\n` +
    `Your invite link:\n` +
    `${link}\n\n` +
    `Progress:\n` +
    `${progressBar(count)} ${Math.min(count, 3)} / 3 joined\n\n` +
    `${unlockText}\n\n` +
    `Copy and send this:\n\n` +
    `“I’m testing AskGogo — an AI assistant on WhatsApp for reminders, calendar planning, weather, sports and daily briefings.\n\n` +
    `You can type or send voice notes in Indian languages.\n\n` +
    `Try it here:\n${link}”`
  )
}

export async function buildReferralWelcomeNote(text: string) {
  const code = extractReferralCode(text)
  if (!code) return null

  return (
    `🎁 Referral code detected: *${code}*\n\n` +
    `You’re in the AskGogo founder beta. Type *Hi* to see what I can do, or try:\n` +
    `• Remind me in 10 mins to drink water\n` +
    `• Today\n` +
    `• Bangalore weather tomorrow`
  )
}
