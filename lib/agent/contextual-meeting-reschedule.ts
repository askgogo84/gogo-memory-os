import {createHash} from 'node:crypto'
import {isMetaMessageId} from '@/lib/channels/whatsapp-provider/provider'
import {supabaseAdmin} from '@/lib/supabase-admin'
import {formatInTimezone, getLocalParts, isValidTimezone, zonedLocalTimeToUtc} from '@/lib/timezone'
import {getCalendarAccountAccess, fetchMergedCalendarEventsPage} from '@/lib/services/google-calendar-accounts'
import {capabilityPermissionLevel} from './adaptive-autonomy'

const UNKNOWN = 'I couldn’t verify that meeting reminder change. Please check your reminders; I haven’t retried the write.'
const norm = (s: unknown) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim()
const phoneKey = (s: unknown) => String(s || '').replace(/^whatsapp:/i, '')
const meetLinks = (s: unknown): string[] => [...new Set((String(s || '').match(/https:\/\/[^\s<>]+/g) || []).flatMap(raw => {
  try {
    const u = new URL(raw.replace(/[)\]},.;!?]+$/g,''))
    return u.hostname === 'meet.google.com' && !u.username && !u.password && !u.port && !u.search && !u.hash && /^\/[a-z]{3}-[a-z]{4}-[a-z]{3}$/.test(u.pathname) ? [u.origin + u.pathname] : []
  } catch {return []}
}))]

function moveClock(text: string) {
  // Bare pronouns after a delivered meeting reminder, not an explicitly named
  // calendar object or an explicit reminder-only clock change.
  const m = String(text || '').trim().match(/^(?:please\s+)?(?:move|reschedule|shift|postpone)\s+(?:this|that|it)(?:\s+(?:meeting|call))?\s+(?:to\s+)?(today|tomorrow|tmrw|tmw)\s*(?:at\s+)?(\d{1,2})(?:[:.](\d{2}))?\s*(am|pm)(?:\s+(IST|UTC))?[.!]*$/i)
  if (!m) return null
  const h = Number(m[2]), minute = Number(m[3] || 0)
  const daysAhead = m[1].toLowerCase() === 'today' ? 0 : 1
  return {daysAhead, hour: h % 12 + (m[4].toLowerCase() === 'pm' ? 12 : 0), minute, zone: m[5]?.toUpperCase(), valid: h >= 1 && h <= 12 && minute <= 59}
}

export function isContextualMeetingMove(text: string): boolean { return moveClock(text) !== null }

function exactLocal(parts: {year:number;month:number;day:number;hour:number;minute:number}, timezone: string) {
  const at = zonedLocalTimeToUtc({...parts, timezone})
  const same = (d: Date) => {const p = getLocalParts(d, timezone); return Object.entries(parts).every(([k,v]) => p[k as keyof typeof p] === v)}
  if (!same(at) || [-7200000,-3600000,-1800000,1800000,3600000,7200000].some(n => same(new Date(at.getTime() + n)))) return null
  return at
}

function storedMeeting(message: string, timezone: string) {
  const first = String(message || '').split('\n')[0]
  const m = first.match(/^(.{1,180}) — starts (\d{1,2}) ([A-Za-z]+) (\d{4}), (\d{1,2}):(\d{2})\s*(am|pm)$/i)
  if (!m || /[\u0000-\u001f]/.test(m[1])) return null
  const names = ['january','february','march','april','may','june','july','august','september','october','november','december']
  const month = names.findIndex(n => n === m[3].toLowerCase() || n.slice(0,3) === m[3].toLowerCase()) + 1
  const h = Number(m[5]), minute = Number(m[6])
  if (!month || h < 1 || h > 12 || minute > 59) return null
  const start = exactLocal({year:Number(m[4]), month, day:Number(m[2]), hour:h % 12 + (m[7].toLowerCase() === 'pm' ? 12 : 0), minute}, timezone)
  const links = meetLinks(message)
  return start && links.length === 1 ? {title:m[1], start, meet:links[0]} : null
}

/** Reconcile an already-rescheduled Calendar event with its delivered reminder.
 * Calendar is read-only here. Sent occurrences are never re-armed or rewritten. */
export async function tryContextualMeetingReschedule(p: {telegramId:number;phone:string;text:string;surface:'web'|'whatsapp';replyToSid?:string}): Promise<string|null> {
  const clock = moveClock(p.text)
  // A same-day move uses the explicitly quoted delivery as its only source.
  if (!clock || (clock.daysAhead === 0 && !p.replyToSid)) return null
  if (!Number.isSafeInteger(p.telegramId) || p.telegramId === 0) return 'I couldn’t verify the reminder owner. Nothing was changed.'
  if (!clock.valid) return 'Please give one valid meeting time. Nothing was changed.'
  if (p.replyToSid && (p.surface !== 'whatsapp' || p.replyToSid.length > 256 ||
    !(/^(?:SM|MM)[a-f0-9]{32}$/i.test(p.replyToSid) || isMetaMessageId(p.replyToSid)))) return null
  const maxAgeMs = (p.replyToSid ? 24 : 1) * 60 * 60_000
  const owner = p.telegramId
  try {
    const reminderLevel = await capabilityPermissionLevel(owner, 'reminders')
    const calendarLevel = await capabilityPermissionLevel(owner, 'calendar')
    if (!['ask','auto'].includes(reminderLevel) || calendarLevel === 'off') return 'Your reminder or Calendar permission does not allow this change. Nothing was changed.'
    const now = Date.now()
    const delivered = supabaseAdmin.from('reminders')
      .select('id,message,remind_at,sent_at,twilio_sid,timezone,whatsapp_to,is_recurring,recurring_pattern')
      .eq('telegram_id',owner).eq('sent',true).in('delivery_state',['delivered','read'])
      .gte('sent_at',new Date(now - maxAgeMs).toISOString())
    const {data:recent,error:recentError} = await (p.replyToSid ? delivered.eq('twilio_sid',p.replyToSid) : delivered)
      .order('sent_at',{ascending:false}).limit(2)
    if (recentError) return UNKNOWN
    const source = recent?.[0]
    if (!source || !isValidTimezone(source.timezone) || source.is_recurring || source.recurring_pattern) return null
    if (recent?.[1] && (p.replyToSid || recent[1].sent_at === source.sent_at)) return 'I found more than one matching reminder. Please name the meeting. Nothing was changed.'
    if (!/^\+\d{8,15}$/.test(phoneKey(p.phone)) || phoneKey(source.whatsapp_to) !== phoneKey(p.phone)) return null
    const sentAt = Date.parse(source.sent_at)
    if (!Number.isFinite(sentAt) || sentAt > now || now - sentAt > maxAgeMs) return null
    const meeting = storedMeeting(source.message, source.timezone)
    if (!meeting) return null
    const {data:receipt,error:receiptError} = await supabaseAdmin.from('delivery_receipts')
      .select('receipt_verified,status,chunk,chunks').eq('provider_sid',source.twilio_sid).maybeSingle()
    if (receiptError || receipt?.receipt_verified !== true || !['delivered','read'].includes(receipt?.status) || receipt?.chunk !== 1 || receipt?.chunks !== 1) return UNKNOWN
    // A verified quote identifies the original delivery directly. For a bare
    // pronoun, intervening requests can change its meaning.
    if (!p.replyToSid) {
      const {data:turns,error:turnError} = await supabaseAdmin.from('conversations').select('content')
        .eq('telegram_id',owner).eq('role','user').gte('created_at',source.sent_at).order('created_at',{ascending:false}).limit(21)
      if (turnError) return UNKNOWN
      if ((turns || []).length > 20 || (turns || []).some((r:any) => !moveClock(r.content) && !/^(?:yes|yep|yeah|ok|okay|no|cancel)[.!]*$/i.test(String(r.content || '').trim()))) return null
    }
    const canonical = (z:string) => new Intl.DateTimeFormat('en',{timeZone:z}).resolvedOptions().timeZone
    if (clock.zone && canonical(clock.zone === 'IST' ? 'Asia/Kolkata' : 'UTC') !== canonical(source.timezone)) return 'Please confirm the timezone for this meeting. Nothing was changed.'
    const today = getLocalParts(new Date(now),source.timezone)
    const day = new Date(Date.UTC(today.year,today.month-1,today.day+clock.daysAhead,12))
    const target = exactLocal({year:day.getUTCFullYear(),month:day.getUTCMonth()+1,day:day.getUTCDate(),hour:clock.hour,minute:clock.minute},source.timezone)
    if (!target || target.getTime() <= now) return 'That meeting time is invalid or ambiguous in your timezone. Nothing was changed.'
    const lead = meeting.start.getTime() - Date.parse(source.remind_at)
    if (!Number.isFinite(lead) || lead < 0 || lead > 24 * 60 * 60_000) return UNKNOWN
    const {data:user,error:userError} = await supabaseAdmin.from('users').select('google_calendar_connected,google_refresh_token').eq('telegram_id',owner).maybeSingle()
    if (userError || !user) return UNKNOWN
    let incomplete = Boolean(user.google_calendar_connected && !user.google_refresh_token)
    if (incomplete) return 'I couldn’t verify every connected Calendar account. Nothing was changed.'
    const accounts = await getCalendarAccountAccess(owner,user.google_calendar_connected ? user.google_refresh_token : null,() => {incomplete = true})
    if (incomplete) return 'I couldn’t verify every connected Calendar account. Nothing was changed.'
    if (!accounts.length) return 'I found your delivered meeting reminder, but couldn’t read its Calendar account. Nothing was changed.'
    const calendar = await fetchMergedCalendarEventsPage(accounts,new Date(now - 5 * 60_000).toISOString(),new Date(now + 8 * 86400_000).toISOString(),'CONTEXTUAL_MEETING_CALENDAR_READ',100)
    if (calendar.hasMore || calendar.accountsRead !== calendar.accountsTotal) return 'I couldn’t verify the complete Calendar result for this meeting. Nothing was changed.'
    const events = calendar.events.filter((e:any) => e.status !== 'cancelled' && norm(e.summary) === norm(meeting.title) &&
      [e.hangoutLink,...(e.conferenceData?.entryPoints || []).map((x:any) => x.uri)].some(v => meetLinks(v).includes(meeting.meet)))
    if (events.length !== 1) return 'I couldn’t identify one Calendar event matching the delivered reminder and Meet link. Nothing was changed.'
    const event = events[0]
    const start = Date.parse(event.start?.dateTime || ''), end = Date.parse(event.end?.dateTime || '')
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return UNKNOWN
    const range = new Intl.DateTimeFormat('en-IN',{timeZone:source.timezone,weekday:'short',year:'numeric',month:'short',day:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).formatRange(new Date(start),new Date(end)) + ` (${source.timezone})`
    if (start !== target.getTime()) return `${meeting.title} is currently on your Calendar ${range}. It is not at the requested time yet. I haven’t changed the Calendar event or reminder.`
    const due = new Date(start - lead).toISOString()
    if (Date.parse(due) <= now) return 'The Calendar event matches, but its reminder time is already past. I haven’t created a late reminder.'
    const message = source.message.replace(/ — starts [^\n]+/,` — starts ${formatInTimezone(new Date(start),source.timezone)}`)
    const {data:inventory,error:inventoryError} = await supabaseAdmin.from('reminders')
      .select('id,message,remind_at,timezone,sent,is_recurring,recurring_pattern,delivery_state,claim_token,send_started_at,whatsapp_to,chat_id')
      .eq('telegram_id',owner).eq('sent',false).order('remind_at',{ascending:true}).limit(101)
    if (inventoryError || !Array.isArray(inventory) || inventory.length > 100) return UNKNOWN
    const dayKey = (at:Date|string) => {const x = getLocalParts(at,source.timezone); return `${x.year}-${x.month}-${x.day}`}
    const candidates = inventory.filter((r:any) => {
      const name = String(r.message || '').split('\n')[0].split(' — starts ')[0]
      const recorded = storedMeeting(r.message,source.timezone)
      return norm(name) === norm(meeting.title) && Number.isFinite(Date.parse(r.remind_at)) && dayKey(recorded?.start || r.remind_at) === dayKey(target)
    })
    if (candidates.length > 1) return 'More than one future reminder matches that meeting. Nothing was changed; please choose the reminder.'
    const existing = candidates[0]
    if (existing && (phoneKey(existing.whatsapp_to) !== phoneKey(p.phone) || String(existing.chat_id) !== String(owner))) return 'A matching reminder has a different recipient. I haven’t changed it or created another.'
    if (existing && (existing.is_recurring || existing.recurring_pattern || existing.delivery_state !== 'pending' || existing.claim_token || existing.send_started_at || meetLinks(existing.message).some(link => link !== meeting.meet))) return 'That future reminder has a different meeting link or a delivery in progress. Nothing was changed.'
    const hash = createHash('sha256').update(JSON.stringify(['contextual-meeting',String(owner),event.iCalUID || [event._account,event.id],new Date(start).toISOString()])).digest('hex')
    const id = existing?.id || `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`
    if (!['ask','auto'].includes(await capabilityPermissionLevel(owner,'reminders'))) return 'Your reminder permission changed while I checked Calendar. Nothing was changed.'
    if (existing) {
      if (existing.message !== message || Date.parse(existing.remind_at) !== Date.parse(due)) {
        const {data:changed,error:changeError} = await supabaseAdmin.from('reminders').update({message,remind_at:due,timezone:source.timezone})
          .eq('id',id).eq('telegram_id',owner).eq('sent',false).eq('delivery_state','pending').is('claim_token',null).is('send_started_at',null)
          .eq('message',existing.message).eq('remind_at',existing.remind_at).eq('timezone',existing.timezone).eq('is_recurring',false).is('recurring_pattern',null)
          .eq('whatsapp_to',existing.whatsapp_to).eq('chat_id',existing.chat_id).select('id').maybeSingle()
        if (changeError || !changed) return UNKNOWN
      }
    } else {
      // Stable primary key gives concurrent/replayed turns one successor. Never
      // retry an uncertain insert; verify its exact owner/object below instead.
      await supabaseAdmin.from('reminders').insert({id,telegram_id:owner,chat_id:owner,whatsapp_to:phoneKey(p.phone),message,remind_at:due,timezone:source.timezone,sent:false,is_recurring:false,recurring_pattern:null}).then(() => {}, () => {})
    }
    const {data:saved,error:savedError} = await supabaseAdmin.from('reminders').select('id,message,remind_at,timezone,sent,delivery_state,whatsapp_to,chat_id')
      .eq('id',id).eq('telegram_id',owner).maybeSingle()
    if (savedError || !saved || saved.sent || saved.delivery_state !== 'pending' || saved.message !== message || saved.timezone !== source.timezone || Date.parse(saved.remind_at) !== Date.parse(due) || phoneKey(saved.whatsapp_to) !== phoneKey(p.phone) || String(saved.chat_id) !== String(owner)) return UNKNOWN
    return `${meeting.title} is already on your Calendar ${range}, with the same Meet link.\nYour reminder is set for ${formatInTimezone(saved.remind_at,saved.timezone)}.\n${meeting.meet}`
  } catch { return UNKNOWN }
}
