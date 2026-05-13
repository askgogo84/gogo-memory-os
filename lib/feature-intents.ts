// AskGogo Feature Intent Router
// Plugged into /app/api/webhooks/whatsapp/route.ts
// Returns a reply string if handled, null to fall through to Claude

import { parseSplitIntent } from '@/lib/splitwise/split-parser'
import { detectReelUrl, detectInstagramPreviewCard, saveReel } from '@/lib/services/reel-saver'
import { addToList } from '@/lib/lists'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'

export async function routeFeatureIntent(phone: string, text: string, extra?: { telegramId?: number; caption?: string }): Promise<string | null> {
  // ── Detect Instagram Reel / YouTube Short / TikTok ──────────
  // ── Instagram / Social Link Preview (text only, no thumbnail) ──────────
  // When user forwards a reel, sometimes WhatsApp sends only the title text (no image)
  // In that case: save it as a note using just the title + creator info we have
  if (detectInstagramPreviewCard(text)) {
    const creatorMatch = text.match(/^(.+?)\s+on\s+instagram/i)
    const creator = creatorMatch?.[1]?.trim() || ''
    const captionMatch = text.match(/on instagram:\s*[\u201c\u201d""](.+?)["\u201c\u201d"]?$/i)
    const caption = captionMatch?.[1]?.trim() || text.slice(0, 80)
    const creatorTag = creator ? `@${creator.replace(/\s+/g, '').toLowerCase()}` : ''
    const noteText = `REEL: ${caption} ${creatorTag}`.trim()
    if (extra?.telegramId) {
      await addToList(extra.telegramId, 'notes', [noteText])
    }
    return (
      `📱 *Instagram content saved!*${creator ? `\n*By:* @${creator}` : ''}\n\n` +
      `*"${caption.slice(0, 100)}"*\n\n` +
      `Saved to your notes ✅\n\n` +
      `💡 *Tip:* To get a full AI summary of the reel content, paste the link directly:\n` +
      `1. Open Instagram → tap reel → ⋯ → *Copy Link*\n` +
      `2. Paste here — I'll give you a complete breakdown!`
    )
  }

  // Case: Full URL pasted directly
  const reelUrl = detectReelUrl(text)
  if (reelUrl) {
    try {
      const result = await saveReel({ url: reelUrl, userCaption: extra?.caption })
      // Save to notes if we have a telegramId
      if (extra?.telegramId) {
        const noteText = `REEL: ${result.title || reelUrl} | ${result.author ? '@' + result.author : ''} | ${reelUrl}`
        await addToList(extra.telegramId, 'notes', [noteText])
      }
      return result.savedNote + '\n\n✅ Saved to *my notes*.\nSay *my saved reels* to see all saved videos.'
    } catch (err: any) {
      console.error('[reel-saver] failed:', err?.message)
      // Don't block — fall through
    }
  }

  const t = text.toLowerCase().trim()

  // ── SKIN CHECK FOLLOW-UP REMINDER ────────────────────────────────
  // Avoid asking for a time. For Skin Check progress tracking, default to 9 AM after 14 days.
  if (
    /\bremind\b/i.test(t) &&
    /\bskin\s*check\b/i.test(t) &&
    (/\b2\s*weeks?\b/i.test(t) || /\btwo\s*weeks?\b/i.test(t) || /\b14\s*days?\b/i.test(t))
  ) {
    return (await post('/api/skin-reminder', { phone, text }))?.reply ?? null
  }

  // ── DAILY BRIEFING ────────────────────────────────────────────────
  // Keep this early so "morning briefing" / "today briefing" does not fall through to the generic assistant.
  if (/^(morning|good morning|daily briefing|my briefing|briefing|morning briefing|today briefing|today summary|plan my day|help me plan my day|today)$/i.test(t)) {
    return (await post('/api/briefing', { phone }))?.reply ?? null
  }

  // ── RECORD MEETING ─────────────────────────────────────────────────────
  // Also check original transcript for voice notes (Whisper mishears "record meeting")
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

  // Also handle "end meeting" / "stop recording" — remind them to use the recorder page
  if (/^(end meeting|stop recording|stop meeting|meeting ended|meeting done)$/i.test(t)) {
    return `To stop recording, tap *End Meeting* in the AskGogo Recorder tab you opened earlier.\n\nIf you closed it accidentally, your minutes may not have been sent — you can re-open and record again.`
  }

  // ── ASK GOGO SPLIT ────────────────────────────────────────────────
  // Saved reels query
  if (/^(my saved reels?|saved reels?|saved videos?|my reels?)$/.test(t)) {
    // Return from notes filtered by REEL prefix
    return null // Falls through to Claude which searches notes
  }

  // WhatsApp-first Splitwise style groups, expenses, balances, settlement and charts.
  if (parseSplitIntent(text)) {
    return (await post('/api/splitbill', { phone, text }))?.reply ?? null
  }

  // ── EXPENSES ─────────────────────────────────────────────────────
  if (/^(spent|paid|expensed?|cost)\s/.test(t) || /rs\.?\s*\d+|\d+\s*rs/.test(t)) {
    return (await post('/api/expenses', { phone, text }))?.reply ?? null
  }
  if (/^(my expenses?|spending|expenses? (this|for))/.test(t)) {
    const period = /month/.test(t) ? 'month' : 'week'
    return (await get('/api/expenses', { phone, period }))?.reply ?? null
  }

  // ── TODOS ─────────────────────────────────────────────────────────
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

  // ── CONTACT MEMORY ────────────────────────────────────────────────
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

  // ── FOLLOW-UPS ────────────────────────────────────────────────────
  const fuMatch = text.match(/follow.?up with\s+(\w+)(?:.*?in\s+(\d+)\s+days?)?/i)
  if (fuMatch) {
    return (await post('/api/followups', { phone, contact: fuMatch[1], daysIfNoReply: fuMatch[2] ? parseInt(fuMatch[2]) : 2, context: text }))?.reply ?? null
  }

  // ── NEWS DIGEST ───────────────────────────────────────────────────
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
