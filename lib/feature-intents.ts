// AskGogo Feature Intent Router
// Plugged into /app/api/webhooks/whatsapp/route.ts
// Returns a reply string if handled, null to fall through to Claude

import { parseSplitIntent } from '@/lib/splitwise/split-parser'
import { handleNutritionText, isNutritionLogText, isNutritionCommand } from '@/lib/bot/handlers/nutrition'
import { detectReelUrl, detectInstagramPreviewCard, detectLinkedInPreviewCard, saveReel } from '@/lib/services/reel-saver'
import { saveMediaMemory, detectPlatformFromText } from '@/lib/services/media-memory'
import {
  addToList,
  addToListDetailed,
  formatAddResult,
  formatList,
  getList,
  normalizeListName,
  setItemDoneByText,
  findPendingExactAcrossLists,
} from '@/lib/lists'
import { RESERVED_SHOW_NAMES } from '@/lib/data/reserved-names'
import { isCalendarListName } from '@/lib/data/calendar-word'

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
  // Uses saveMediaMemory (Claude vision) — the correct path that handles truncated captions
  const isIGCard = detectInstagramPreviewCard(text)
  const isLICard = detectLinkedInPreviewCard(text)
  if ((isIGCard || isLICard) && extra?.telegramId) {
    try {
      const detectedUrl = detectReelUrl(text) || undefined
      const platform = detectPlatformFromText(text, detectedUrl)
      const { reply } = await saveMediaMemory({
        telegramId: extra.telegramId,
        platform,
        bodyText: text,
        detectedUrl,
      })
      return reply
    } catch (err: any) {
      console.error('[feature-intents] saveMediaMemory failed:', err?.message)
      // Fall through to Claude on error
    }
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

  // ── ADD TO LIST ("add milk to my groceries") ──────────────────────────────
  // Deterministic and BEFORE nutrition: the nutrition matcher would otherwise
  // swallow any food word ("milk") and log a meal. "add X to Y" is unambiguous,
  // so capture an arbitrary trailing list name ("weekend list", "Goa list") too.
  const listAdd = text.match(/^\s*(?:gogo[,!\s]+)?add\s+(.+?)\s+(?:to|into)\s+(?:my\s+)?(.+?)\s*$/i)
  if (listAdd && extra?.telegramId) {
    const item = listAdd[1].trim()
    const listName = normalizeListName(listAdd[2])
    // "add a reminder to call mom" is a reminder, not a list item — let it fall
    // through to the reminder path rather than filing "a reminder" under "call mom".
    const isReminderShape = /^(a |an )?(reminder|alarm|alert)$/i.test(item) || /\badd\s+(?:a |an )?(?:reminder|alarm)\b/i.test(text)
    // "add meeting … to my calendar" is a calendar-create, not a list named "calendar".
    // Fall through so processIncomingMessage's parseCalendarCreate path handles it — this
    // router runs BEFORE that path, so without the guard the meeting is filed into a
    // "calendar" list and the calendar handler never runs. Symmetric to isReminderShape.
    const isCalendarShape = isCalendarListName(listAdd[2])
    if (item && listName && !isReminderShape && !isCalendarShape) {
      const res = await addToListDetailed(extra.telegramId, listName, [item])
      return formatAddResult(listName, res)
    }
  }

  // ── SHOW A LIST ("show groceries", "view my grocery list") ────────────────────
  // Deterministic SHOW that CLAIMS ONLY IF SERVICEABLE. detectIntent's list_show only
  // fires when the text literally contains " list", so bare "show groceries" fell
  // through to Claude, which did its OWN literal name-matching against history ("grocery"
  // ≠ "groceries") and emitted a not-found — never calling getList, never normalising.
  // Here we resolve the name through the SAME normalizeListName+getList the ADD path uses
  // and return the list ONLY when it actually exists; on no match we return null and let
  // normal routing continue. That existence gate is the whole point: a match-on-shape
  // rule would be the 4th hijack of this class — swallowing "show my cards" (CreditIQ),
  // "show my reminders", "show me the weather". getList is cheap here because
  // routeFeatureIntent is async and already holds telegramId (it wasn't, for the sync
  // parseSplitIntent that this guard's absence once bit).
  const showMatch = t.match(/^(show|open|view)\s+(?:my\s+)?(.+)$/)
  if (showMatch && extra?.telegramId) {
    const showName = normalizeListName(showMatch[2])
    // Reserved names that collide with higher-priority detectIntent handlers
    // (creditiq_cards, edit_reminder, weather_live). The existence check below stops
    // shape-hijacking, but NOT data-hijacking: a user who creates a list literally named
    // "reminders" or "cards" would otherwise have "show my reminders"/"show my cards"
    // resolve to that list instead of their reminders/portfolio. Decline these outright,
    // before getList, so the reserved word always reaches its real owner downstream.
    if (!RESERVED_SHOW_NAMES.has(showName)) {
      const list = await getList(extra.telegramId, showName)
      if (list) return formatList(list.list_name, list.items || [])
      // no such list → fall through to detectIntent / Claude unchanged
    }
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
  // Log: "spent 450 on lunch", "250 on uber", "lunch 180", "₹80 coffee"
  const isExpenseLog = (
    /^(spent|paid|expensed?|cost)\s/i.test(t) ||
    /^[₹]\s*\d/i.test(t) ||
    /^(rs|inr)\.?\s*\d/i.test(t) ||
    (/^\d+\s+(on|for)\s+/i.test(t)) ||
    (/^[a-z][\w\s]+\s+\d{2,5}$/i.test(t) && t.split(' ').length <= 4 && !/^(remind|set|add|show|my|get|how|what|when|tasks?|notes?)/i.test(t))
  )
  if (isExpenseLog) {
    const expReply = (await post('/api/expenses', { phone, text }))?.reply
    if (expReply) return expReply
  }

  // Query: "expenses today", "expense insight", "my spending this week"
  if (/^(my expenses?|expenses? today|spending today|expense (report|insight|summary)|how much.*(spend|spent)|analyse.*spend)/i.test(t)) {
    const insight = /insight|analys|ai/i.test(t) ? '1' : '0'
    const period = /month/i.test(t) ? 'month' : /week/i.test(t) ? 'week' : 'today'
    return (await get('/api/expenses', { phone, period, insight }))?.reply ?? null
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
    const arg = doneMatch[2].trim()
    // "done <number>" (done 1) stays EXACTLY as before → reminders/todos. Only a
    // non-numeric "done <text>" is eligible for the list-first divert, and only when a
    // real PENDING list item matches exactly — otherwise we fall straight through to the
    // unchanged /api/todos handler below, so today's behaviour is untouched.
    if (extra?.telegramId && !/^\d+$/.test(arg)) {
      const hits = await findPendingExactAcrossLists(extra.telegramId, arg)
      if (hits.length === 1) {
        await setItemDoneByText(extra.telegramId, hits[0].list_name, arg, true)
        return `✅ Marked done on your ${hits[0].list_name} list: ${hits[0].matched}.`
      }
      if (hits.length > 1) {
        return `"${arg}" is on more than one list: ${hits.map(h => h.list_name).join(', ')}. Which one do you mean?`
      }
      // hits.length === 0 → no matching list item → fall through to /api/todos unchanged
    }
    return (await post('/api/todos', { phone, action: 'done', text: doneMatch[2] }))?.reply ?? null
  }
  if (/^clear (completed|done) tasks?$/i.test(t)) {
    return (await post('/api/todos', { phone, action: 'clear' }))?.reply ?? null
  }

  // ── CONTACT MEMORY ─────────────────────────────────────────────────────
  // Only treat "remember <Name> <fact>" as a CONTACT save when <Name> is an
  // actual name, not a pronoun/article. "remember my flight ..." / "remember
  // that ..." are personal memories and must fall through to the memory handler.
  const NON_CONTACT_LEADS = new Set([
    'my','the','a','an','this','that','these','those','his','her','its','their',
    'our','your','to','it','i','me','we','they','he','she','when','how','what','why','if',
  ])
  const rememberMatch = text.match(/^remember\s+(\w+)\s+(.+)/i)
  // Route to CONTACTS only when the fact actually looks like contact info
  // (phone/email/relationship keyword). Otherwise it's a personal memory and
  // must fall through so it gets saved + embedded for semantic search.
  const factText = rememberMatch ? rememberMatch[2] : ''
  const looksLikeContact =
    /\b\d{6,}\b/.test(factText) ||                                   // phone-like number
    /[\w.+-]+@[\w-]+\.[\w.-]+/.test(factText) ||                     // email
    /\b(number|phone|mobile|whatsapp|email|contact|birthday|bday|anniversary|address)\b/i.test(factText)
  if (
    rememberMatch &&
    !/^remember\s+that\b/i.test(text) &&
    !NON_CONTACT_LEADS.has(rememberMatch[1].toLowerCase()) &&
    looksLikeContact
  ) {
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

