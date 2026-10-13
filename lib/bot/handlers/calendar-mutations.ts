/**
 * Bidirectional calendar: move / reschedule / cancel events by chat.
 * Confidence-aware confirm: one obvious match -> single "reply yes"; multiple ->
 * numbered pick; nothing mutates until the user confirms. Reuses follow-up state
 * (kind 'calendar_mutation') to hold the pending action, mirroring the existing
 * calendar_conflict flow.
 */
import {
  listUpcomingEvents,
  updateCalendarEvent,
  deleteCalendarEvent,
} from '@/lib/google-calendar'
import { saveFollowupState } from './followup-state'
import { getAllCalendarAccountAccess, mergeAccountEvents, describeEventRange, type CalendarAccountAccess } from '@/lib/services/google-calendar-accounts'

export type CalMutResult = { handled: boolean; reply: string }

// ── Intent detection ─────────────────────────────────────────────────────────
export function isCalendarMutation(text: string): boolean {
  const t = (text || '').toLowerCase()
  if (/\breminders?\b/.test(t)) return false // "cancel my X reminder" stays with the reminder editor
  const verb = /\b(move|reschedule|resched|postpone|push|shift|change|cancel|delete|remove|clear)\b/.test(t)
  const obj = /\b(meeting|event|appointment|appt|call|calendar|standup|sync|session|slot)\b/.test(t)
  // "move my 3pm to 4pm" (has a time + move verb) also qualifies without an explicit object noun
  const timeish = /\b\d{1,2}(?::\d{2})?\s*(am|pm)\b/.test(t)
  return verb && (obj || (/(move|reschedule|postpone|push|shift|change)/.test(t) && timeish))
}

export function isCalendarMutationConfirm(text: string): boolean {
  const t = (text || '').toLowerCase().trim()
  return /^(y|yes|yep|yeah|confirm|ok|okay|do it|go ahead|sure)\b/.test(t) || /^[1-9]$/.test(t) || /^no|^cancel$|^stop$/.test(t)
}

// ── Accounts ─────────────────────────────────────────────────────────────────
// Every linked Google account is searched; the event id only exists on the account it came from,
// so that account's email travels with the pending action and the write goes back to it.
async function getAccounts(telegramId: number): Promise<CalendarAccountAccess[]> {
  return await getAllCalendarAccountAccess(telegramId).catch(() => [])
}

function accessFor(accounts: CalendarAccountAccess[], email?: string | null): CalendarAccountAccess | null {
  if (email) return accounts.find(a => a.email === String(email).toLowerCase()) || null
  return accounts.find(a => a.primary) || accounts[0] || null
}

// ── Parsing helpers ──────────────────────────────────────────────────────────
const STOP = new Set(['move','reschedule','resched','postpone','push','shift','change','cancel','delete','remove','clear','my','the','a','an','to','at','on','for','me','please','pls','event','appointment','appt','meeting','call','calendar','from','and','am','pm','today','tomorrow'])

function extractAction(t: string): 'move' | 'delete' {
  return /\b(cancel|delete|remove|clear)\b/i.test(t) ? 'delete' : 'move'
}

// keywords used to fuzzy-match the target event
function keywords(t: string): string[] {
  return t.toLowerCase().replace(/[^a-z0-9:\s]/g, ' ')
    .split(/\s+/).filter(w => w && !STOP.has(w) && !/^\d{1,2}(am|pm)?$/.test(w))
}

// a clock time mentioned anywhere, as {hour,minute} 24h (for matching "my 3pm meeting")
function clockIn(t: string): { hour: number; minute: number } | null {
  const m = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i)
  if (!m) return null
  let h = parseInt(m[1], 10) % 12
  if (/pm/i.test(m[3])) h += 12
  return { hour: h, minute: m[2] ? parseInt(m[2], 10) : 0 }
}

function istParts(iso: string) {
  const d = new Date(new Date(iso).getTime() + 5.5 * 3600 * 1000)
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), day: d.getUTCDate() }
}

function fmtEvent(ev: any, multi = false): string {
  const when = ev.start?.dateTime || ev.start?.date ? describeEventRange(ev) : 'unscheduled'
  const account = multi && ev._account ? ` · ${ev._account}` : ''
  return `${ev.summary || '(no title)'} — ${when}${account}`
}

// score each event against the phrase; return sorted candidates (score > 0)
function matchEvents(events: any[], phrase: string): any[] {
  const kws = keywords(phrase)
  const wantClock = clockIn(phrase)

  // If one event contains every meaningful keyword from the user's title phrase,
  // prefer it deterministically over loose one-word matches such as "test".
  // Example: "Move the Final Brain Calendar Test meeting to 5 PM" should not
  // fan out to every historical event whose title merely contains "test".
  if (kws.length >= 2) {
    const fullMatches = events.filter(ev => {
      const title = String(ev?.summary || '').toLowerCase()
      return kws.every(k => title.includes(k))
    })
    if (fullMatches.length === 1) return fullMatches
  }

  const scored = events.map(ev => {
    const title = (ev.summary || '').toLowerCase()
    let score = 0
    for (const k of kws) if (title.includes(k)) score += 2
    if (wantClock && ev.start?.dateTime) {
      const p = istParts(ev.start.dateTime)
      if (p.h === wantClock.hour && p.m === wantClock.minute) score += 3
    }
    return { ev, score }
  }).filter(s => s.score > 0).sort((a, b) => b.score - a.score)
  return scored.map(s => s.ev)
}

// compute the new start/end for a move, keeping the event's duration
function computeNewTime(text: string, ev: any): { startIso: string; endIso: string } | null {
  const clock = clockIn(text)
  if (!clock) return null
  const curStartIso = ev.start?.dateTime
  const curEndIso = ev.end?.dateTime
  if (!curStartIso) return null
  const durationMs = curEndIso ? (new Date(curEndIso).getTime() - new Date(curStartIso).getTime()) : 30 * 60 * 1000

  // date: tomorrow / today / keep event's date
  const istStart = new Date(new Date(curStartIso).getTime() + 5.5 * 3600 * 1000)
  let y = istStart.getUTCFullYear(), mo = istStart.getUTCMonth(), d = istStart.getUTCDate()
  if (/\btomorrow\b/i.test(text)) { const t = new Date(Date.now() + 5.5 * 3600 * 1000 + 86400000); y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate() }
  else if (/\btoday\b/i.test(text)) { const t = new Date(Date.now() + 5.5 * 3600 * 1000); y = t.getUTCFullYear(); mo = t.getUTCMonth(); d = t.getUTCDate() }

  const startUtc = new Date(Date.UTC(y, mo, d, clock.hour - 5, clock.minute - 30, 0))
  const endUtc = new Date(startUtc.getTime() + durationMs)
  return { startIso: startUtc.toISOString(), endIso: endUtc.toISOString() }
}

// ── Main entry: find the event, confirm or disambiguate ──────────────────────
export async function buildCalendarMutationReply(telegramId: number, text: string): Promise<CalMutResult> {
  const accounts = await getAccounts(telegramId)
  if (!accounts.length) {
    return { handled: true, reply: `Your Google Calendar isn't connected yet — reply *connect calendar* to link it, then I can move or delete events for you.` }
  }
  const multi = accounts.length > 1

  const action = extractAction(text)
  const settled = await Promise.allSettled(accounts.map(async a => ({ email: a.email, events: await listUpcomingEvents(a.accessToken, 7), hasMore: false })))
  const read = settled.filter((r): r is PromiseFulfilledResult<{ email: string | null; events: any[]; hasMore: boolean }> => r.status === 'fulfilled').map(r => r.value)
  const events = mergeAccountEvents(read).events
  const partial = read.length < accounts.length
  if (!events.length) {
    return { handled: true, reply: `You have no upcoming events in the next 7 days${partial ? ' on the calendars I could read' : ''}, so there's nothing to ${action}.` }
  }

  const matches = matchEvents(events, text)

  if (matches.length === 0) {
    const list = events.slice(0, 6).map((e, i) => `${i + 1}. ${fmtEvent(e, multi)}`).join('\n')
    return { handled: true, reply: `I couldn't find that event. Here's what's coming up:\n\n${list}\n\nTry again with a word from the title, e.g. *${action} the standup*.` }
  }

  if (matches.length === 1) {
    const ev = matches[0]
    if (action === 'delete') {
      await saveFollowupState(telegramId, 'calendar_mutation', {
        action: 'delete', eventId: ev.id, summary: ev.summary, accountEmail: ev._account || null, created_at: new Date().toISOString(), candidates: null,
      })
      return { handled: true, reply: `Delete *${fmtEvent(ev, multi)}* from your calendar?\n\nReply *yes* to delete it, or *no* to keep it.` }
    }
    const nt = computeNewTime(text, ev)
    if (!nt) {
      return { handled: true, reply: `Move *${ev.summary}* to when? Tell me a time, e.g. *move it to 4pm* or *reschedule to tomorrow 10am*.` }
    }
    await saveFollowupState(telegramId, 'calendar_mutation', {
      action: 'move', eventId: ev.id, summary: ev.summary, accountEmail: ev._account || null, startIso: nt.startIso, endIso: nt.endIso, created_at: new Date().toISOString(), candidates: null,
    })
    const newWhen = new Date(nt.startIso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    return { handled: true, reply: `Move *${ev.summary}*\nfrom ${describeEventRange(ev)}${multi && ev._account ? ` (${ev._account})` : ''}\nto *${newWhen}*?\n\nReply *yes* to confirm, or *no* to cancel.` }
  }

  // multiple candidates -> numbered pick
  const top = matches.slice(0, 5)
  const list = top.map((e, i) => `${i + 1}. ${fmtEvent(e, multi)}`).join('\n')
  await saveFollowupState(telegramId, 'calendar_mutation', {
    action, text, created_at: new Date().toISOString(),
    candidates: top.map(e => ({ eventId: e.id, summary: e.summary, accountEmail: e._account || null, startIso: e.start?.dateTime, endIso: e.end?.dateTime })),
  })
  return { handled: true, reply: `I found a few — which one to ${action}?\n\n${list}\n\nReply with the number (e.g. *1*).` }
}

// ── Confirm / execute ────────────────────────────────────────────────────────
export async function confirmCalendarMutation(telegramId: number, input: string, payload: any): Promise<string | null> {
  if (!payload || payload.consumed) return null
  // recency guard: pending confirm only valid for 10 minutes
  if (payload.created_at && Date.now() - new Date(payload.created_at).getTime() > 10 * 60 * 1000) return null

  const t = (input || '').toLowerCase().trim()
  if (/^(no|cancel|stop)\b/.test(t)) {
    await saveFollowupState(telegramId, 'calendar_mutation', { consumed: true })
    return `Okay, left it unchanged.`
  }

  const accounts = await getAccounts(telegramId)
  if (!accounts.length) return `Your calendar isn't connected anymore — reply *connect calendar* to re-link.`

  // resolve which event
  let action = payload.action as 'move' | 'delete'
  let eventId = payload.eventId
  let summary = payload.summary
  let startIso = payload.startIso
  let endIso = payload.endIso
  let accountEmail: string | null = payload.accountEmail || null

  if (payload.candidates && Array.isArray(payload.candidates)) {
    const n = parseInt(t, 10)
    if (!n || n < 1 || n > payload.candidates.length) {
      return `Please reply with the number of the event to ${action} (1-${payload.candidates.length}).`
    }
    const chosen = payload.candidates[n - 1]
    eventId = chosen.eventId
    summary = chosen.summary
    accountEmail = chosen.accountEmail || null
    if (action === 'move') {
      const nt = payload.text && computeNewTime(payload.text, { start: { dateTime: chosen.startIso }, end: { dateTime: chosen.endIso } })
      if (!nt) { await saveFollowupState(telegramId, 'calendar_mutation', { consumed: true }); return `Got it — *${summary}*. Move it to when? e.g. *move to 4pm*.` }
      startIso = nt.startIso; endIso = nt.endIso
    }
  } else if (!/^(y|yes|yep|yeah|confirm|ok|okay|do it|go ahead|sure)\b/.test(t)) {
    // single-match confirm expects a yes
    return `Reply *yes* to ${action === 'delete' ? 'delete' : 'move'} *${summary}*, or *no* to keep it.`
  }

  // The event lives on one specific account; if that account is no longer linked, never write to another one.
  const access = accessFor(accounts, accountEmail)
  if (!access) {
    await saveFollowupState(telegramId, 'calendar_mutation', { consumed: true })
    return `I can't reach the calendar that event is on (${accountEmail}) any more — reply *connect calendar* to re-link it.`
  }
  const token = access.accessToken
  const where = accounts.length > 1 && access.email ? ` (${access.email})` : ''

  await saveFollowupState(telegramId, 'calendar_mutation', { consumed: true })

  if (action === 'delete') {
    const res = await deleteCalendarEvent(token, eventId)
    return res.ok ? `\ud83d\uddd1 Deleted *${summary}* from your calendar${where}.` : `Couldn't delete it: ${res.error}. Try again in a moment.`
  } else {
    const res = await updateCalendarEvent(token, eventId, { startTime: startIso, endTime: endIso })
    if (!res.ok) return `Couldn't move it: ${res.error}. Try again in a moment.`
    const newWhen = new Date(startIso).toLocaleString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' })
    return `\u2705 Moved *${summary}* to ${newWhen}${where}.`
  }
}
