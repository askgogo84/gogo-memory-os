import { supabaseAdmin } from '@/lib/supabase-admin'
import { fetchPrimaryCalendarAccount, fetchPrimaryCalendarEventsPage, refreshAccessToken } from '@/lib/services/google-calendar'

/**
 * One user can link several Google accounts. `users.google_refresh_token` stays the primary
 * account (every existing writer keeps using it); extra accounts live in
 * `google_calendar_accounts`. Reads merge every account, writes still go to the primary one until
 * the user is asked which account to use.
 */
export type CalendarAccountAccess = { email: string | null; accessToken: string; primary: boolean }
export type TaggedEvent = Record<string, any> & { _account?: string | null }

const tid = (telegramId: number | string) => String(telegramId)

export async function listExtraCalendarAccounts(telegramId: number | string, onUnavailable?: () => void): Promise<Array<{ email: string; refreshToken: string }>> {
  try {
    const { data, error } = await supabaseAdmin.from('google_calendar_accounts')
      .select('email,refresh_token').eq('telegram_id', tid(telegramId)).order('created_at', { ascending: true })
    if (error) { onUnavailable?.(); console.error('CALENDAR_ACCOUNTS_LIST_FAILED:', error.message); return [] }
    return (data || []).filter((r: any) => r?.email && r?.refresh_token).map((r: any) => ({ email: String(r.email).toLowerCase(), refreshToken: String(r.refresh_token) }))
  } catch (err) { onUnavailable?.(); console.error('CALENDAR_ACCOUNTS_LIST_FAILED:', err); return [] }
}

/** Save (or refresh) an extra account. Returns false when the table is missing or the write fails. */
export async function saveExtraCalendarAccount(telegramId: number | string, email: string, encryptedRefreshToken: string): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from('google_calendar_accounts').upsert(
      { telegram_id: tid(telegramId), email: email.toLowerCase(), refresh_token: encryptedRefreshToken, updated_at: new Date().toISOString() },
      { onConflict: 'telegram_id,email' })
    if (error) { console.error('CALENDAR_ACCOUNT_SAVE_FAILED:', error.message); return false }
    return true
  } catch (err) { console.error('CALENDAR_ACCOUNT_SAVE_FAILED:', err); return false }
}

/**
 * Access for every linked account, primary first, one entry per distinct email. A token that no
 * longer refreshes is skipped, so one revoked account never hides the other.
 * Read surfaces use onUnavailable to retain that missing-account evidence.
 */
export async function getCalendarAccountAccess(telegramId: number | string, primaryRefreshToken: string | null | undefined, onUnavailable?: () => void): Promise<CalendarAccountAccess[]> {
  const out: CalendarAccountAccess[] = []
  const seen = new Set<string>()
  if (primaryRefreshToken) {
    const accessToken = await refreshAccessToken(String(primaryRefreshToken)).catch(() => null)
    if (accessToken) {
      const email = (await fetchPrimaryCalendarAccount(accessToken).catch(() => null))?.toLowerCase() || null
      if (!email) onUnavailable?.()
      if (email) seen.add(email)
      out.push({ email, accessToken, primary: true })
    } else onUnavailable?.()
  }
  for (const extra of await listExtraCalendarAccounts(telegramId, onUnavailable)) {
    if (seen.has(extra.email)) continue
    const accessToken = await refreshAccessToken(extra.refreshToken).catch(() => null)
    if (!accessToken) { onUnavailable?.(); continue }
    seen.add(extra.email)
    out.push({ email: extra.email, accessToken, primary: false })
  }
  return out
}

/** Merge per-account event lists: sorted by start, an invite that sits on two calendars appears once. */
export function mergeAccountEvents(perAccount: Array<{ email: string | null; events: any[]; hasMore: boolean }>) {
  const seen = new Set<string>()
  const events: TaggedEvent[] = []
  for (const part of perAccount) {
    for (const event of part.events) {
      const key = String(event?.iCalUID || '')
      if (key) { if (seen.has(key)) continue; seen.add(key) }
      events.push({ ...event, _account: part.email })
    }
  }
  const startOf = (e: any) => Date.parse(String(e?.start?.dateTime || e?.start?.date || '')) || 0
  events.sort((a, b) => startOf(a) - startOf(b))
  return { events, hasMore: perAccount.some(p => p.hasMore) }
}

/** Events across every linked account. Throws only when no account could be read. */
export async function fetchMergedCalendarEventsPage(accounts: CalendarAccountAccess[], timeMin: string, timeMax: string, label: string, limit = 40) {
  const settled = await Promise.allSettled(accounts.map(async a => ({ email: a.email, ...(await fetchPrimaryCalendarEventsPage(a.accessToken, timeMin, timeMax, label, limit)) })))
  const ok = settled.filter((s): s is PromiseFulfilledResult<{ email: string | null; events: any[]; hasMore: boolean }> => s.status === 'fulfilled').map(s => s.value)
  if (!ok.length) throw new Error('calendar_fetch_failed')
  const merged = mergeAccountEvents(ok)
  // One account failing means the picture is incomplete; never present it as the full schedule.
  return { events: merged.events.slice(0, limit), hasMore: merged.hasMore || merged.events.length > limit || ok.length < settled.length, accountsRead: ok.length, accountsTotal: settled.length }
}

/** Same as getCalendarAccountAccess, reading the primary token from the user row. */
export async function getAllCalendarAccountAccess(telegramId: number | string): Promise<CalendarAccountAccess[]> {
  const { data } = await supabaseAdmin.from('users').select('google_calendar_connected,google_refresh_token').eq('telegram_id', telegramId as any).maybeSingle()
  return getCalendarAccountAccess(telegramId, data?.google_calendar_connected ? data?.google_refresh_token : null)
}

/** "Account: a@x.com" / "Accounts: a@x.com, b@y.com" lines for replies. */
export function describeCalendarAccounts(accounts: Array<{ email: string | null }>) {
  const emails = accounts.map(a => a.email).filter((e): e is string => !!e)
  if (!emails.length) return ''
  return emails.length === 1 ? `Account: *${emails[0]}*` : `Accounts: ${emails.map(e => `*${e}*`).join(' and ')}`
}

/** Today's events across every linked account (used by the briefing and day plan). */
export async function getTodayEventsAllAccounts(telegramId: number | string, primaryRefreshToken: string | null | undefined, getToday: (accessToken: string) => Promise<any[]>, primaryExpected = Boolean(primaryRefreshToken)) {
  let incomplete = primaryExpected && !primaryRefreshToken
  const accounts = await getCalendarAccountAccess(telegramId, primaryRefreshToken, () => { incomplete = true })
  if (!accounts.length) {
    if (incomplete) throw new Error('calendar_fetch_failed')
    return { connected: false as const, events: [] as TaggedEvent[], multi: false, incomplete: false }
  }
  const settled = await Promise.allSettled(accounts.map(async a => ({ email: a.email, events: await getToday(a.accessToken), hasMore: false })))
  const ok = settled.filter((s): s is PromiseFulfilledResult<{ email: string | null; events: any[]; hasMore: boolean }> => s.status === 'fulfilled').map(s => s.value)
  if (!ok.length) throw new Error('calendar_fetch_failed')
  return { connected: true as const, events: mergeAccountEvents(ok).events, multi: accounts.length > 1, incomplete: incomplete || ok.length < settled.length }
}

/** Access token for one named linked account, or null when it is not linked or no longer refreshes. */
export async function getAccessTokenForCalendarAccount(telegramId: number | string, email: string): Promise<string | null> {
  const wanted = String(email || '').toLowerCase()
  if (!wanted) return null
  const match = (await getAllCalendarAccountAccess(telegramId)).find(a => a.email === wanted)
  return match?.accessToken || null
}

/**
 * Which linked account a message names: the full address, or the address's domain label
 * ("tipplr", "gmail") as a whole word. The part before the @ is never used because both of
 * a person's accounts often share it. Returns null unless exactly one account matches.
 */
export function pickCalendarAccountFromText<T extends { email: string | null }>(accounts: T[], text: string): T | null {
  const lower = String(text || '').toLowerCase()
  const named = accounts.filter(a => {
    if (!a.email) return false
    if (lower.includes(a.email)) return true
    const label = a.email.split('@')[1]?.split('.')[0]
    return !!label && new RegExp(`\\b${label.replace(/[^a-z0-9]/g, '')}\\b`).test(lower)
  })
  return named.length === 1 ? named[0] : null
}

const IST_FORMAT = { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true } as const
const IST_TIME = { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true } as const
const istDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(ms))

/**
 * "Thu, 8 Oct, 11:30 am–12:00 pm" for a same-day event, "Thu, 8 Oct, 11:30 am → Mon, 13 Oct, 5:00 pm"
 * when it runs past midnight, so a long event is never shown as if it were a single moment.
 */
export function describeEventRange(event: any): string {
  const startIso = event?.start?.dateTime || event?.start?.date
  if (!startIso) return 'time not set'
  if (!event?.start?.dateTime) return new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(startIso)) + ' (all day)'
  const startMs = Date.parse(event.start.dateTime)
  const endMs = event?.end?.dateTime ? Date.parse(event.end.dateTime) : NaN
  const start = new Intl.DateTimeFormat('en-IN', IST_FORMAT).format(new Date(startMs))
  if (!Number.isFinite(endMs)) return start
  if (istDay(startMs) === istDay(endMs)) return `${start}–${new Intl.DateTimeFormat('en-IN', IST_TIME).format(new Date(endMs))}`
  return `${start} → ${new Intl.DateTimeFormat('en-IN', IST_FORMAT).format(new Date(endMs))}`
}

/**
 * The first timed event that really overlaps [startMs, endMs). Events the user declined and events
 * marked "free" do not block the slot.
 */
export function findConflictingEvent(events: TaggedEvent[], startMs: number, endMs: number): TaggedEvent | null {
  for (const x of events || []) {
    if (!x || x.status === 'cancelled' || x.transparency === 'transparent') continue
    const self = Array.isArray(x.attendees) ? x.attendees.find((a: any) => a?.self) : null
    if (self?.responseStatus === 'declined') continue
    const xs = x?.start?.dateTime ? Date.parse(x.start.dateTime) : NaN
    const xe = x?.end?.dateTime ? Date.parse(x.end.dateTime) : NaN
    if (Number.isFinite(xs) && Number.isFinite(xe) && xs < endMs && xe > startMs) return x
  }
  return null
}

/** One line, "Daily Standup on a@x.com (Thu, 8 Oct, 11:30 am–12:00 pm)": the WhatsApp card carries it in one template slot. */
export function describeConflict(event: TaggedEvent, multi: boolean): string {
  const account = multi && event._account ? ` on ${event._account}` : ''
  return `${event.summary || 'Calendar event'}${account} (${describeEventRange(event)})`
}
