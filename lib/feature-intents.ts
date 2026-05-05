// AskGogo Feature Intent Router
// Plugged into /app/api/webhooks/whatsapp/route.ts
// Returns a reply string if handled, null to fall through to Claude

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'

export async function routeFeatureIntent(phone: string, text: string): Promise<string | null> {
  const t = text.toLowerCase().trim()

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

  // ── BILL SPLIT ────────────────────────────────────────────────────
  const splitMatch = text.match(/split\s+(?:rs\.?|inr)?(\d+(?:\.\d+)?)\s+(?:among|between|with)\s+(.+?)(?:\s+for\s+(.+))?$/i)
  if (splitMatch) {
    const people = splitMatch[2].split(/,\s*|\s+and\s+/i).map((p: string) => p.trim()).filter(Boolean)
    if (!people.some((p: string) => /^me$/i.test(p))) people.unshift('Me')
    return (await post('/api/splitbill', { phone, amount: parseFloat(splitMatch[1]), people, description: splitMatch[3] || 'Bill' }))?.reply ?? null
  }
  if (/^(my splits?|past splits?|split history)$/i.test(t)) {
    return (await get('/api/splitbill', { phone }))?.reply ?? null
  }

  // ── DAILY BRIEFING ────────────────────────────────────────────────
  if (/^(morning|good morning|daily briefing|my briefing|briefing)$/i.test(t)) {
    return (await post('/api/briefing', { phone }))?.reply ?? null
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
