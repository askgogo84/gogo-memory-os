import { supabaseAdmin } from '@/lib/supabase-admin'

const NUDGE_MARKER = 'ASKGOGO_FIRST_VALUE_REFERRAL_NUDGE_SENT'

function isExcludedCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (lower === 'hi' || lower === 'hello' || lower === 'hey' || lower === 'start' || lower === 'pricing' || lower === 'usage' || lower === 'admin' || lower.startsWith('admin ') || lower.includes('invite') || lower.includes('referral') || lower.includes('notify me') || lower.includes('payment') || lower.includes('upgrade') || lower.includes('subscribe'))
}

function looksLikeSuccessfulValue(text: string, reply: string) {
  const lowerText = (text || '').toLowerCase()
  const lowerReply = (reply || '').toLowerCase()
  if (isExcludedCommand(lowerText)) return false
  // Only nudge when bot ACTUALLY delivered value — check bot reply, not just user text
  return (
    lowerReply.includes('✅') || lowerReply.includes('🔔') || lowerReply.includes('⏰') ||
    lowerReply.includes('reminder set') || lowerReply.includes('reminders set') ||
    lowerReply.includes("i'll remind you") || lowerReply.includes("i will remind you") ||
    lowerReply.includes('saved to') || lowerReply.includes('note saved') ||
    lowerReply.includes('plan for') || lowerReply.includes('your calendar') ||
    lowerReply.includes('your notes') || lowerText.includes('plan my day') ||
    (lowerText.includes('weather') && lowerReply.includes('°'))
  )
}

async function hasNudgeAlready(telegramId: number) {
  const { data } = await supabaseAdmin.from('memories').select('id').eq('telegram_id', telegramId).eq('content', NUDGE_MARKER).limit(1)
  return Boolean(data?.length)
}

async function markNudgeSent(telegramId: number) {
  await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content: NUDGE_MARKER })
}

export async function buildFirstValueReferralNudge(params: { telegramId: number; userText: string; botReply: string }) {
  if (!looksLikeSuccessfulValue(params.userText, params.botReply)) return ''
  if (await hasNudgeAlready(params.telegramId)) return ''
  await markNudgeSent(params.telegramId)
  return `\n\n✨ *Nice — that's your first AskGogo win.*\n\nWant to give this to 3 friends?\nType *invite friends* and I'll create your founder beta referral link.`
}
