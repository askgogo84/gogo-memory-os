import OpenAI from 'openai'
import { addToList } from '@/lib/lists'
import { supabaseAdmin } from '@/lib/supabase-admin'

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

function wordCount(text: string) {
  return (text || '').trim().split(/\s+/).filter(Boolean).length
}

export function isMeetingNotesCaption(text: string) {
  const lower = (text || '').toLowerCase().trim()
  return (
    lower.includes('meeting') ||
    lower.includes('transcribe') ||
    lower.includes('transcript') ||
    lower.includes('summarize this audio') ||
    lower.includes('summarise this audio') ||
    lower.includes('summarize this recording') ||
    lower.includes('summarise this recording') ||
    lower.includes('meeting notes') ||
    lower.includes('call notes') ||
    lower.includes('audio notes')
  )
}

export function shouldTreatAudioAsMeeting(params: {
  caption?: string | null
  transcript: string
}) {
  if (isMeetingNotesCaption(params.caption || '')) return true
  return wordCount(params.transcript) >= 80
}

function normalizeTier(tier?: string | null) {
  const clean = (tier || 'free').toLowerCase().trim().replace(/-/g, '_').replace(/\s+/g, '_')
  if (clean === 'starter') return 'starter'
  if (clean === 'pro') return 'pro'
  if (clean === 'founder' || clean === 'founder_pro') return 'founder_pro'
  return 'free'
}

async function getUserTier(telegramId: number) {
  const { data } = await supabaseAdmin
    .from('users')
    .select('tier')
    .eq('telegram_id', telegramId)
    .single()

  return normalizeTier(data?.tier)
}

function meetingLimitText(tier: string) {
  if (tier === 'starter') return 'Starter supports short meeting/audio notes. Keep recordings around 5 minutes.'
  if (tier === 'pro') return 'Pro supports longer meeting/audio notes. Keep recordings around 20 minutes.'
  if (tier === 'founder_pro') return 'Founder Pro supports power meeting/audio notes. Keep recordings around 60 minutes when WhatsApp file size allows.'
  return 'Meeting Notes is a paid feature.'
}

async function canUseMeetingNotes(telegramId: number) {
  const tier = await getUserTier(telegramId)
  return { allowed: tier !== 'free', tier }
}

export async function buildMeetingNotesReply(params: {
  telegramId: number
  transcript: string
  caption?: string | null
}) {
  const access = await canUseMeetingNotes(params.telegramId)

  if (!access.allowed) {
    return (
      `🎙️ *Meeting Notes*\n\n` +
      `I can turn meeting audio into a transcript, summary, decisions and action items.\n\n` +
      `This is a paid feature to keep AskGogo sustainable.\n\n` +
      `Plans:\n` +
      `• Starter — short audio notes\n` +
      `• Pro — longer meeting notes\n` +
      `• Founder Pro — power meeting notes\n\n` +
      `Reply *I want Pro* or *I want Founder Pro*.`
    )
  }

  const safeTranscript = params.transcript.trim().slice(0, 24000)

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 1000,
    messages: [
      {
        role: 'system',
        content:
          'You are AskGogo meeting notes assistant for WhatsApp. Summarize meeting transcripts into concise, useful notes. Use WhatsApp-friendly formatting. Do not invent names or decisions. If speaker names are unclear, use Owner TBD.',
      },
      {
        role: 'user',
        content:
          `Caption: ${params.caption || 'No caption'}\n\nTranscript:\n${safeTranscript}\n\n` +
          `Return exactly in this format:\n\n` +
          `🎙️ *Meeting notes ready*\n\n` +
          `*Summary*\n• ...\n• ...\n\n` +
          `*Key decisions*\n• ...\n\n` +
          `*Action items*\n1. Owner — action\n2. Owner — action\n\n` +
          `*Follow-ups to create*\n• reminder suggestion if any\n\n` +
          `*Transcript snapshot*\nshort important excerpt / or concise transcript summary`,
      },
    ],
  })

  const reply = response.choices?.[0]?.message?.content?.trim()

  if (!reply) {
    throw new Error('Could not summarize meeting transcript')
  }

  const savedNote = reply
    .replace(/\*/g, '')
    .replace(/🎙️\s*Meeting notes ready/gi, 'Meeting notes')
    .trim()
    .slice(0, 1500)

  await addToList(params.telegramId, 'notes', [savedNote])

  await supabaseAdmin.from('memories').insert({
    telegram_id: params.telegramId,
    content:
      'ASKGOGO_MEETING_NOTES_CREATED:' +
      JSON.stringify({
        tier: access.tier,
        words: wordCount(params.transcript),
        created_at: new Date().toISOString(),
      }),
  })

  return (
    `${reply}\n\n` +
    `✅ Saved to *my notes*.\n\n` +
    `Plan note: ${meetingLimitText(access.tier)}\n\n` +
    `Soon I’ll also let you reply *yes* to create reminders from the action items.`
  )
}
