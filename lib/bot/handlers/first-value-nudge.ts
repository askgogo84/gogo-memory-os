import { supabaseAdmin } from '@/lib/supabase-admin'

const NUDGE_MARKER = 'ASKGOGO_FIRST_VALUE_REFERRAL_NUDGE_SENT'

function isExcludedCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower === 'hi' ||
    lower === 'hello' ||
    lower === 'hey' ||
    lower === 'start' ||
    lower === 'pricing' ||
    lower === 'usage' ||
    lower === 'admin' ||
    lower.startsWith('admin ') ||
    lower.includes('invite') ||
    lower.includes('referral') ||
    lower.includes('notify me') ||
    lower.includes('payment') ||
    lower.includes('upgrade') ||
    lower.includes('subscribe')
  )
}

function looksLikeSuccessfulValue(text: string, reply: string) {
  const lowerText = (text || '').toLowerCase()
  const lowerReply = (reply || '').toLowerCase()

  if (isExcludedCommand(lowerText)) return false

  return (
    lowerReply.includes('✅') ||
    lowerReply.includes('reminder set') ||
    lowerReply.includes('calendar event added') ||
    lowerReply.includes('day plan added') ||
    lowerReply.includes('image note read') ||
    lowerReply.includes('saved to') ||
    lowerReply.includes('note saved') ||
    lowerReply.includes('weather') ||
    lowerReply.includes('plan for') ||
    lowerReply.includes('your calendar') ||
    lowerReply.includes('your notes') ||
    lowerText.includes('plan my day') ||
    lowerText.includes('remind me') ||
    lowerText.includes('weather') ||
    lowerText.includes('my notes')
  )
}

async function hasNudgeAlready(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('memories')
    .select('id')
    .eq('telegram_id', telegramId)
    .eq('content', NUDGE_MARKER)
    .limit(1)

  return Boolean(data?.length)
}

async function markNudgeSent(telegramId: number) {
  await supabaseAdmin.from('memories').insert({
    telegram_id: telegramId,
    content: NUDGE_MARKER,
  })
}

export async function buildFirstValueReferralNudge(params: {
  telegramId: number
  userText: string
  botReply: string
}) {
  if (!looksLikeSuccessfulValue(params.userText, params.botReply)) return ''
  if (await hasNudgeAlready(params.telegramId)) return ''

  await markNudgeSent(params.telegramId)

  return (
    `\n\n✨ *Nice — that’s your first AskGogo win.*\n\n` +
    `Want to give this to 3 friends?\n` +
    `Type *invite friends* and I’ll create your founder beta referral link.\n\n` +
    `Invite 3 friends to unlock Founder Pro trial priority when paid plans go live.`
  )
}
