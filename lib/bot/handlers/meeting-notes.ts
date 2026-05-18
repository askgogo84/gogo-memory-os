import OpenAI from 'openai'
import { addToList } from '@/lib/lists'
import { transcribeMeeting, getLanguageLabel } from '@/lib/services/meeting-transcription'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { saveFollowupState } from './followup-state'

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

export function isTypedMeetingNotesCommand(text: string) {
  const lower = (text || '').toLowerCase().trim()

  // Must have actual content (more than just the trigger phrase alone)
  // "Meeting notes" alone = just a caption label, not typed content to summarize
  // "Meeting notes: we discussed X" = actual typed meeting notes
  const hasContent = lower.length > 30

  return (
    hasContent && (
      (lower.startsWith('meeting notes') && lower.length > 20 && !lower.match(/^meeting notes\.?\s*$/i)) ||
      lower.startsWith('call notes') ||
      lower.startsWith('summarize meeting') ||
      lower.startsWith('summarise meeting') ||
      lower.startsWith('summarize this meeting') ||
      lower.startsWith('summarise this meeting') ||
      lower.startsWith('transcribe meeting') ||
      lower.startsWith('meeting summary') ||
      (lower.includes('we discussed') && (lower.includes('need to') || lower.includes('action') || lower.includes('follow up'))) ||
      lower.includes('meeting notes:')
    )
  )
}

export function cleanTypedMeetingNotesText(text: string) {
  return (text || '')
    .replace(/^send\s+a\s+\d+\s*[–-]\s*\d+\s*min\s+meeting-style\s+voice\s+note:?/i, '')
    .replace(/^meeting\s+notes\s*[:.]?\s*/i, '')
    .replace(/^call\s+notes\s*[:.]?\s*/i, '')
    .replace(/^summari[sz]e\s+(this\s+)?meeting\s*[:.]?\s*/i, '')
    .replace(/^transcribe\s+meeting\s*[:.]?\s*/i, '')
    .replace(/[“”]/g, '')
    .trim()
}

export function shouldTreatAudioAsMeeting(params: { caption?: string | null; transcript: string }) {
  if (isMeetingNotesCaption(params.caption || '')) return true
  if (isTypedMeetingNotesCommand(params.transcript || '')) return true
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
  const { data } = await supabaseAdmin.from('users').select('tier').eq('telegram_id', telegramId).single()
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

function istTomorrowReminderIso(slotIndex: number) {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
  const get = (type: string) => parts.find((p) => p.type === type)?.value || '00'
  const year = Number(get('year'))
  const month = Number(get('month'))
  const day = Number(get('day'))
  const slots = [9, 11, 15, 17, 19]
  const hour = slots[Math.min(slotIndex, slots.length - 1)]
  return new Date(Date.UTC(year, month - 1, day + 1, hour - 5, 30, 0)).toISOString()
}

function cleanActionLine(line: string) {
  return (line || '')
    .replace(/^[-•\d.)\s]+/, '')
    .replace(/^owner\s+tbd\s*[—:-]\s*/i, '')
    .replace(/^tbd\s*[—:-]\s*/i, '')
    .replace(/\bOwner TBD\b\s*[—:-]\s*/gi, '')
    .replace(/\bOwner TBD\b/gi, '')
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+\./g, '.')
    .trim()
}

function polishMeetingReply(reply: string) {
  return (reply || '')
    .replace(/Owner TBD\s*[—:-]\s*/gi, '')
    .replace(/\bOwner TBD\b/gi, '')
    .replace(/\n\s*(\d+)\.\s*/g, '\n$1. ')
    .replace(/\s+\./g, '.')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractActionItems(reply: string) {
  const plain = polishMeetingReply(reply).replace(/\*/g, '')
  const match = plain.match(/Action items\s*\n([\s\S]*?)(?=\n(?:Follow-ups to create|Transcript snapshot|Summary|Key decisions)\s*\n|$)/i)
  const section = match?.[1] || ''

  return section
    .split('\n')
    .map(cleanActionLine)
    .filter(Boolean)
    .filter((line) => !/^none$/i.test(line))
    .slice(0, 5)
    .map((message, index) => ({ message, remindAtIso: istTomorrowReminderIso(index) }))
}

function buildTranscriptMessage(transcript: string, speakerCount?: number): string[] {
  // Split transcript into WhatsApp-safe chunks (4000 chars each)
  const header = speakerCount && speakerCount > 1
    ? `📝 *Full transcript* _(${speakerCount} speakers)_\n\n`
    : `📝 *Full transcript*\n\n`

  const body = transcript.trim()
  const chunkSize = 3800
  const chunks: string[] = []

  for (let i = 0; i < body.length; i += chunkSize) {
    const chunk = body.slice(i, i + chunkSize)
    if (i === 0) {
      chunks.push(header + chunk)
    } else {
      chunks.push(`📝 _(continued)_\n\n${chunk}`)
    }
  }

  return chunks.length ? chunks : [header + '_(No transcript available)_']
}

export async function buildMeetingNotesReply(params: {
  telegramId: number
  transcript: string
  caption?: string | null
  speakerTranscript?: string      // speaker-labelled English transcript
  detectedLanguage?: string       // e.g. 'hi', 'kn', 'ta'
  speakerCount?: number
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

  // Use speaker-labelled English transcript if available, otherwise raw transcript
  const transcriptToSummarize = (params.speakerTranscript || params.transcript || '').trim().slice(0, 24000)
  const langLabel = params.detectedLanguage && params.detectedLanguage !== 'en' && params.detectedLanguage !== 'auto'
    ? `\n_Transcribed from ${getLanguageLabel(params.detectedLanguage)} → English_`
    : ''
  const speakerLabel = params.speakerCount && params.speakerCount > 1
    ? `\n_${params.speakerCount} speakers detected_`
    : ''

  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0.2,
    max_tokens: 1200,
    messages: [
      {
        role: 'system',
        content:
          'You are AskGogo meeting notes assistant for WhatsApp. Summarize meeting transcripts into concise, useful notes. Use WhatsApp-friendly formatting. Do not invent names or decisions. Keep action items short and natural. Do not write Owner TBD. If owner is unclear, write only the action. If owner is clear, write Name — action. If speaker labels are present (Speaker A:, Speaker B:), use them to attribute action items. Always put a space after numbered list markers.',
      },
      {
        role: 'user',
        content:
          `Caption: ${params.caption || 'No caption'}\n\nTranscript:\n${transcriptToSummarize}\n\n` +
          `Return exactly in this format (no Transcript snapshot section):\n\n` +
          `🎙️ *Meeting notes ready*\n\n` +
          `*Summary*\n• ...\n• ...\n\n` +
          `*Key decisions*\n• ...\n\n` +
          `*Action items*\n1. action item\n2. Name — action item\n\n` +
          `*Follow-ups to create*\n• reminder suggestion if any`,
      },
    ],
  })

  const rawReply = response.choices?.[0]?.message?.content?.trim()
  if (!rawReply) throw new Error('Could not summarize meeting transcript')
  let reply = polishMeetingReply(rawReply)

  // Append language + speaker badges to reply
  const badges: string[] = []
  if (params.detectedLanguage && params.detectedLanguage !== 'en' && params.detectedLanguage !== 'auto') {
    badges.push(`🌐 _${getLanguageLabel(params.detectedLanguage)} → English_`)
  }
  if (params.speakerCount && params.speakerCount > 1) {
    badges.push(`👥 _${params.speakerCount} speakers detected_`)
  }
  if (badges.length) reply = reply + '\n\n' + badges.join(' · ')

  // Save both summary AND full transcript to meeting_notes for search
  const summaryText = reply.replace(/\*/g, '').replace(/🎙️\s*Meeting notes ready/gi, 'Meeting notes').trim()
  const fullTranscriptText = transcriptToSummarize
  const savedNote = JSON.stringify({
    summary: summaryText.slice(0, 1500),
    transcript: fullTranscriptText.slice(0, 8000),
    language: params.detectedLanguage || 'en',
    speakers: params.speakerCount || 1,
    saved_at: new Date().toISOString(),
  })
  await addToList(params.telegramId, 'meeting_notes', [savedNote])

  const actionItems = extractActionItems(reply)
  if (actionItems.length) await saveFollowupState(params.telegramId, 'meeting_action_items', { items: actionItems })

  await supabaseAdmin.from('memories').insert({
    telegram_id: params.telegramId,
    content:
      'ASKGOGO_MEETING_NOTES_CREATED:' +
      JSON.stringify({ tier: access.tier, words: wordCount(params.transcript), action_items: actionItems.length, created_at: new Date().toISOString() }),
  })

  const summaryReply = (
    `${reply}\n\n` +
    `✅ Saved to *my meeting notes*.\n\n` +
    `Plan note: ${meetingLimitText(access.tier)}\n\n` +
    (actionItems.length ? `Want me to create reminders for these action items? Reply *yes*.` : `No clear action items found to create reminders.`)
  )

  return { summaryReply, transcriptChunks: buildTranscriptMessage(transcriptToSummarize, params.speakerCount) }
}
