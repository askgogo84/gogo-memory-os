// AskGogo Feature Intent Router
// Plugged into /app/api/webhooks/whatsapp/route.ts
// Returns a reply string if handled, null to fall through to Claude

import { parseSplitIntent } from '@/lib/splitwise/split-parser'
import { handleNutritionText, isNutritionLogText, isNutritionCommand } from '@/lib/bot/handlers/nutrition'
import { detectReelUrl, detectInstagramPreviewCard, detectLinkedInPreviewCard, saveReel } from '@/lib/services/reel-saver'
import { addToList } from '@/lib/lists'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'

export async function routeFeatureIntent(phone: string, text: string, extra?: { telegramId?: number; caption?: string }): Promise<string | null> {

  // ── Detect Instagram / YouTube / TikTok / LinkedIn URL ─────────────────
  // Check for full URL FIRST before preview card detection
  const reelUrl = detectReelUrl(text)
  if (reelUrl) {
    try {
      // Strip ALL URLs + leftover query fragments to get clean creator+caption text
      const bodyContext = text
        .replace(/https?:\/\/\S+/g, '')
        .replace(/\/\?\S+/g, '')
        .trim()
      const result = await saveReel({ url: reelUrl, userCaption: bodyContext || extra?.caption })
      if (extra?.telegramId) {
        const noteText = ['REEL:', result.author, result.title?.slice(0, 80), result.url].filter(Boolean).join(' | ')
        await addToList(extra.telegramId, 'notes', [noteText])
      }
      return result.savedNote
    } catch (err: any) {
      console.error('[reel-saver] failed:', err?.message)
    }
  }

  // ── Instagram / LinkedIn card preview (forwarded link, no full URL) ────
  const isIGCard = detectInstagramPreviewCard(text)
  const isLICard = detectLinkedInPreviewCard(text)
  if (isIGCard || isLICard) {
    const isLI = isLICard
    const emoji = isLI ? '💼' : '📱'
    const label = isLI ? 'LinkedIn post' : 'Instagram reel'
    const platformWord = isLI ? 'linkedin' : 'instagram'
    const cleanText = text.replace(/https?:\/\/\S+/g, '').replace(/\/\?\S+/g, '').trim()
    const creatorRegex = new RegExp('^([^\\n]+?)\\s+on\\s+' + platformWord, 'i')
    const creatorMatch = cleanText.match(creatorRegex)
    const creator = creatorMatch ? creatorMatch[1].trim() : ''
    const caption = cleanText
      .replace(new RegExp('.*on\\s+' + platformWord + '[^:]*:\\s*', 'i'), '')
      .replace(/^["""]+|["""]+$/g, '').trim().slice(0, 100)
    if (extra?.telegramId) {
      const noteText = [(isLI ? 'LINKEDIN' : 'REEL'), creator, caption].filter(Boolean).join(' | ')
      await addToList(extra.telegramId, 'notes', [noteText])
    }
    return (
      emoji + ' *' + label + ' saved!*' +
      (creator ? '\n*By:* ' + creator : '') +
      (caption.length > 3 ? '\n*"' + caption + '"*\n\n' : '\n\n') +
      '✅ Saved to your notes.\nSay *my notes* to find it later.'
    )
  }

  const t = text.toLowerCase().trim()

  // ── SKIN CHECK FOLLOW-UP REMINDER ──────────────────────────────────────
  if (
    /\bremind\b/i.test(t) &&
    /\bskin\s*check\b/i.test(t) &&
    (/\b2\s*weeks?\b/i.test(t) || /\btwo\s*weeks?\b/i.test(t) || /\b14\s*days?\b/i.test(t))
  ) {
    return (await post('/api/skin-reminder', { phone, text }))?.reply ?? null
  }

  // ── DAILY BRIEFING ─────────────────────────────────────────────────────
  if (/^(morning|good morning|daily briefing|my briefing|briefing|morning briefing|today briefing|today summary|plan my day|help me plan my day|today)$/i.test(t)) {
    return (await post('/api/briefing', { phone }))?.reply ?? null
  }

  // ── RECORD MEETING ─────────────────────────────────────────────────────
  if (/^(record|start recording|record meeting|record the meeting|meeting record|start meeting|begin meeting|take notes|record call|record the call|record making|i.ll record|recording meeting|record a meeting|start record|record this meeting|wanna record|want to record|i want to record)$/i.test(t) ||
      (t.includes('record') && t.includes('meet')) ||
      (t.includes('record') && t.length < 25)) {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
    const encodedPhone = encodeURIComponent(phone)
    const recordUrl = `${appUrl}/record.html?phone=${encodedPhone}&autostart=1`
    return (
      `🎙️ *AskGogo Meeting Recorder*\n\n` +
      `Tap the link below — recording starts automatically in your browser. Lock your screen anytime, recording continues.\n\n` +
      `📱 *Tap to start recording:*\n` +
      `${recordUrl}\n\n` +
      `When the meeting ends, tap *End Meeting* — I'll transcribe everything and send your minutes, decisions & action items right here. ✅\n\n` +
      `_Add this page to your Home Screen for fastest access next time._`
    )
  }

  if (/^(end meeting|stop recording|stop meeting|meeting ended|meeting done)$/i.test(t)) {
    return `To stop recording, tap *End Meeting* in the AskGogo Recorder tab you opened earlier.\n\nIf you closed it accidentally, your minutes may not have been sent — you can re-open and record again.`
  }

  // ── SAVED REELS / LINKEDIN QUERY ───────────────────────────────────────
  if (/^(my saved reels?|saved reels?|saved videos?|my reels?|my saved posts?|my linkedin saves?)$/.test(t)) {
    return null // Falls through to Claude which searches notes
  }

  // ── NUTRITION (before split — split parser matches breakfast/lunch/dinner) ─
  if (isNutritionLogText(text) || isNutritionCommand(text)) {
    if (extra?.telegramId) {
      return handleNutritionText({ telegramId: extra.telegramId, text, whatsappId: phone })
    }
  }

  // ── ASK GOGO SPLIT ──────────────────────────────────────────────────────
  // Guard: skip split parser for food-logging sentences
  if (!isNutritionLogText(text) && parseSplitIntent(text)) {
    return (await post('/api/splitbill', { phone, text }))?.reply ?? null
  }

  // ── EXPENSES ───────────────────────────────────────────────────────────
  if (/^(spent|paid|expensed?|cost)\s/.test(t) || /rs\.?\s*\d+|\d+\s*rs/.test(t)) {
    return (await post('/api/expenses', { phone, text }))?.reply ?? null
  }
  if (/^(my expenses?|spending|expenses? (this|for))/.test(t)) {
    const period = /month/.test(t) ? 'month' : 'week'
    return (await get('/api/expenses', { phone, period }))?.reply ?? null
  }

  // ── TODOS ──────────────────────────────────────────────────────────────
  if (/^(add task|new task|todo|task:)\s/i.test(t)) {
    const taskText = text.replace(/^(add task|new task|todo|task:)\s*/i, '').trim()
    return (await post('/api/todos', { phone, action: 'add', text: taskText }))?.reply ?? null
  }
  if (/^(tasks?|my tasks?|show tasks?|to-?do list?)$/i.test(t)) {
    return (await post('/api/todos', { phone, action: 'list' }))?.reply ?? null
  }
  const doneMatch = t.match(/^(done|completed?|finished?|did)\s+(.+)/)
  if (doneMatch) {
    return (await post('/api/todos', { phone, action: 'done', text: doneMatch[2] }))?.reply ?? null
  }
  if (/^clear (completed|done) tasks?$/i.test(t)) {
    return (await post('/api/todos', { phone, action: 'clear' }))?.reply ?? null
  }

  // ── CONTACT MEMORY ─────────────────────────────────────────────────────
  const rememberMatch = text.match(/^remember\s+(\w+)\s+(.+)/i)
  if (rememberMatch) {
    return (await post('/api/contacts', { phone, action: 'save', name: rememberMatch[1], fact: rememberMatch[2] }))?.reply ?? null
  }
  const recallMatch = text.match(/(?:what do i know about|tell me about|notes on)\s+(\w+)/i)
  if (recallMatch) {
    return (await post('/api/contacts', { phone, action: 'recall', query: recallMatch[1] }))?.reply ?? null
  }
  if (/^(my contacts?|contact notes?)$/i.test(t)) {
    return (await post('/api/contacts', { phone, action: 'list' }))?.reply ?? null
  }

  // ── FOLLOW-UPS ─────────────────────────────────────────────────────────
  const fuMatch = text.match(/follow.?up with\s+(\w+)(?:.*?in\s+(\d+)\s+days?)?/i)
  if (fuMatch) {
    return (await post('/api/followups', { phone, contact: fuMatch[1], daysIfNoReply: fuMatch[2] ? parseInt(fuMatch[2]) : 2, context: text }))?.reply ?? null
  }

  // ── NEWS DIGEST ────────────────────────────────────────────────────────
  if (/^(news|headlines?|digest)(\s+(tech|market|cricket|startup|world|politics))?$/i.test(t)) {
    const tm = t.match(/\b(tech|market|cricket|startup|world|politics)\b/)
    return (await post('/api/news', { phone, topics: tm ? [tm[1]] : undefined }))?.reply ?? null
  }

  return null // Not matched — fall through to Claude
}

async function post(path: string, body: object): Promise<{ reply?: string } | null> {
  try {
    const res = await fetch(`${APP_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return res.json()
  } catch (e) {
    console.error('[feature-intents] POST error:', path, e)
    return null
  }
}

async function get(path: string, params: Record<string, string>): Promise<{ reply?: string } | null> {
  try {
    const qs = new URLSearchParams(params).toString()
    const res = await fetch(`${APP_URL}${path}?${qs}`)
    return res.json()
  } catch (e) {
    console.error('[feature-intents] GET error:', path, e)
    return null
  }
}
