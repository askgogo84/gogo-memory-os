import { randomUUID } from 'node:crypto'
import { deliveryRpc, nextFutureOccurrence } from '@/lib/services/reminder-delivery'
import { isDefiniteProviderRejection } from '@/lib/services/delivery-state'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp, sendWhatsAppReminderTemplate, sendWhatsAppReminderButtons } from '@/lib/whatsapp'
import { isSuppressed } from '@/lib/bot/handlers/reminder-optout'
// getNextOccurrence now lives in the shared reminder-series module so skip-occurrence
// advances a series exactly the way this cron does — one implementation, no drift.
import { describeCadence } from '@/lib/services/reminder-series'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
// Friend-to-friend delivery gate. Default OFF (unset): a reminder bound for a
// friend (recipient ≠ owner) is still created and the sender was already told it
// was saved, but this cron does NOT deliver it to the recipient — the row is
// consumed (markReminderSent at the end of the loop) so it won't retry forever.
// The owner's own reminders are never affected. Set to '1'/'true' to deliver.
const F2F_REMINDERS_ENABLED =
  process.env.F2F_REMINDERS_ENABLED === '1' || process.env.F2F_REMINDERS_ENABLED === 'true'

// Keywords that mean "send the actual morning briefing" not a dumb notification
const BRIEFING_KEYWORDS = /^(morning briefing|good morning|daily briefing|morning brief|briefing|my briefing)$/i

function isAuthorized(req: Request) {
  const { searchParams } = new URL(req.url)
  const querySecret = searchParams.get('secret')
  const authHeader = req.headers.get('authorization') || ''
  const bearerSecret = authHeader.replace(/^Bearer\s+/i, '').trim()
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return querySecret === expected || bearerSecret === expected
}

// Context emoji for a reminder label. First keyword match wins; order matters
// (health/celebration before generic). Prefixes the label so the icon rides
// inside the template {{1}} variable and shows on out-of-session sends too.
function pickReminderEmoji(label: string): string {
  const s = (label || '').toLowerCase()
  const rules: [RegExp, string][] = [
    [/\b(medicine|medication|meds|pill|tablet|dose|insulin|vitamins?|syrup|antibiotic)\b/, '💊'],
    [/\b(mask|face mask|n95)\b/, '😷'],
    [/\b(doctor|dentist|clinic|hospital|checkup|check[- ]?up|physio|blood test|scan|x-?ray)\b/, '🩺'],
    [/\b(birthday|anniversary|bday)\b/, '🎂'],
    [/\b(plant|plants|garden|watering the)\b/, '🌱'],
    [/\b(drink water|water|hydrate|hydration)\b/, '💧'],
    [/\b(call|phone|ring|dial)\b/, '📞'],
    [/\b(pay|payment|bill|emi|rent|invoice|recharge|premium|installment|instalment|due)\b/, '💰'],
    [/\b(flight|airport|travel|trip|boarding|check[- ]?in|pnr|departure)\b/, '✈️'],
    [/\b(gym|workout|exercise|run|running|walk|jog|yoga|training|cardio)\b/, '🏋️'],
    [/\b(lunch|dinner|breakfast|meal|eat|food|cook)\b/, '🍽️'],
    [/\b(coffee|tea|chai)\b/, '☕'],
    [/\b(email|mail|reply|inbox)\b/, '📧'],
    [/\b(buy|shop|shopping|grocery|groceries|order|purchase)\b/, '🛒'],
    [/\b(package|parcel|delivery|courier|pick up|pickup)\b/, '📦'],
    [/\b(car|parking|fuel|petrol|diesel|service the)\b/, '🚗'],
    [/\b(sunscreen|sunblock|spf)\b/, '🧴'],
    [/\b(laundry|wash clothes|clothes)\b/, '🧺'],
    [/\b(trash|garbage|bins?|recycl)\b/, '🗑️'],
    [/\b(meditate|meditation|sleep|rest|wind down|bedtime|bed)\b/, '🧘'],
    [/\b(meeting|appointment|appt|standup|sync|interview|catch up)\b/, '📅'],
    [/\b(study|homework|assignment|exam|revise|revision|class|lecture)\b/, '🎓'],
    [/\b(submit|report|deadline|presentation|deck)\b/, '💼'],
    [/\b(dog|cat|pet|feed the|vet)\b/, '🐶'],
    [/\b(charge|charger|battery|plug in)\b/, '🔌'],
    [/\b(pray|prayer|temple|puja|namaz|church|mosque)\b/, '🙏'],
  ]
  for (const [re, emoji] of rules) if (re.test(s)) return emoji
  return '⏰'
}

async function sendTelegram(chatId: number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) throw new Error('Missing TELEGRAM_BOT_TOKEN')
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  })
  const body = await res.text()
  if (!res.ok) throw Object.assign(new Error('Telegram send rejected'), { status: res.status })
  return body
}

// Resolve the user's saved timezone so a rescheduled recurring reminder never
// re-writes timezone:null. Legacy digest rows created before the timezone fix
// carry null; without this fallback the null would propagate forever because
// each reschedule copies it straight from the parent row.
async function resolveUserTimezone(telegramId: number | null | undefined): Promise<string> {
  if (!telegramId) return 'Asia/Kolkata'
  const { data } = await supabaseAdmin
    .from('users')
    .select('timezone')
    .eq('telegram_id', telegramId)
    .maybeSingle()
  return data?.timezone || 'Asia/Kolkata'
}

async function findWhatsAppForReminder(reminder: any): Promise<string | null> {
  if (reminder.whatsapp_to) return reminder.whatsapp_to
  if (reminder.telegram_id) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('whatsapp_id, phone')
      .eq('telegram_id', reminder.telegram_id)
      .maybeSingle()
    if (data?.whatsapp_id) return data.whatsapp_id
    if (data?.phone) return data.phone
  }
  return null
}

// Quick-Reply buttons (Done / Snooze 10m / Move to 8pm) mutate the reminder row by
// the OWNER's telegram_id, so a tap only works for the person who owns the row. A
// friend-reminder recipient does NOT own the row — their tap 404s ("couldn't find a
// recent reminder"). So buttons are for the owner's OWN reminders only: true iff the
// delivery number is the owner's own WhatsApp number. Note both owner and friend
// reminders carry whatsapp_to, so we compare numbers (last 10 digits) rather than
// gating on whatsapp_to being set.
async function reminderGoesToOwner(reminder: any, whatsappTo: string): Promise<boolean> {
  if (!reminder.telegram_id) return false
  const { data } = await supabaseAdmin
    .from('users')
    .select('whatsapp_id')
    .eq('telegram_id', reminder.telegram_id)
    .maybeSingle()
  const ownDigits = String(data?.whatsapp_id || '').replace(/\D/g, '').slice(-10)
  const toDigits = String(whatsappTo || '').replace(/\D/g, '').slice(-10)
  return !!ownDigits && ownDigits === toDigits
}


export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  const started = Date.now()
  const now = new Date().toISOString()
  try { await deliveryRpc('reconcile_delivery_callbacks', { p_limit: 100 }) }
  catch { return NextResponse.json({ ok: false, error: 'callback_reconciliation_failed' }, { status: 503 }) }
  const results: { id: string; status: string }[] = []
  const { data: due, error } = await supabaseAdmin.from('reminders').select('*')
    .eq('sent', false).in('delivery_state', ['pending', 'claimed'])
    .lte('remind_at', now).or('retry_at.is.null,retry_at.lte.' + now)
    .order('remind_at', { ascending: true }).limit(50)
  if (error) return NextResponse.json({ ok: false, error: 'reminder_queue_read_failed' }, { status: 500 })

  for (const candidate of due || []) {
    if (Date.now() - started > 45000) break
    const token = randomUUID()
    let reminder: any = null
    let sendStarted = false
    let providerReturned = false
    try {
      const claimed = await deliveryRpc('claim_reminder_delivery', { p_id: candidate.id, p_token: token })
      reminder = claimed?.[0]
      if (!reminder) continue
      const finish = async (state: string, sid: string | null = null) => {
        if (!await deliveryRpc('finish_reminder_delivery', { p_id: reminder.id, p_token: token, p_state: state, p_sid: sid })) {
          throw new Error('reminder_finish_not_persisted')
        }
      }
      const whatsappTo = await findWhatsAppForReminder(reminder)
      const owner = whatsappTo ? await reminderGoesToOwner(reminder, whatsappTo) : false
      if (whatsappTo && ((!F2F_REMINDERS_ENABLED && !owner) || await isSuppressed(reminder.telegram_id, whatsappTo))) {
        await finish('suppressed'); results.push({ id: reminder.id, status: 'suppressed' }); continue
      }
      const raw = String(reminder.message || '').trim()
      const isBriefing = BRIEFING_KEYWORDS.test(raw)
      const followup = String(reminder.recurring_pattern || '').startsWith('followup:')
      const topic = raw.startsWith('[topic_digest]') ? raw.replace(/^\[topic_digest\]\s*/i, '').trim() : null
      const label = pickReminderEmoji(raw) + ' ' + raw.replace(/^to\s+/i, '')
      let text = followup ? '🔔 *Follow-up reminder*\n\n' + raw + '\n\nDid you hear back? Reply *done* or *snooze 2 days*.'
        : label + '\n\nQuick actions: snooze 10 mins · move it to 8 pm · done' + (reminder.is_recurring ? '\nRepeats: ' + describeCadence(reminder.recurring_pattern) : '')
      let empty = false
      if (topic) {
        const { data, error: digestError } = await supabaseAdmin.from('memory_embeddings').select('content, created_at')
          .eq('telegram_id', reminder.telegram_id).ilike('topic', topic).is('deleted_at', null)
          .order('created_at', { ascending: false }).limit(10)
        if (digestError) throw new Error('digest_read_failed')
        empty = !data?.length
        text = '📂 *' + topic + ' digest*\n\n' + (data || []).map((r: any) => '• ' + r.content).join('\n')
      }
      if (isBriefing && whatsappTo) {
        const response = await fetch(APP_URL + '/api/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: whatsappTo }), signal: AbortSignal.timeout(15000) })
        if (!response.ok) throw new Error('briefing_prepare_failed')
        const body = await response.json()
        text = body?.reply || '🌅 Good morning! Type *morning* to get your daily briefing.'
      }
      if (!whatsappTo && !(Number(reminder.chat_id) > 0)) throw new Error('no_delivery_target')
      let next: string | null = null
      const capped = followup && ((reminder.nudge_count || 0) + 1 >= 20 ||
        (reminder.followup_started_at && Date.now() - Date.parse(reminder.followup_started_at) >= 7 * 86400000))
      if (reminder.is_recurring && reminder.recurring_pattern && !capped) {
        next = nextFutureOccurrence(reminder.recurring_pattern, new Date(reminder.remind_at), new Date()).toISOString()
      }
      const timezone = reminder.timezone || await resolveUserTimezone(reminder.telegram_id)
      // Final consent check follows all content preparation. begin RPC fences
      // cancellation/move and commits recurrence + intent before the network boundary.
      if (whatsappTo && await isSuppressed(reminder.telegram_id, whatsappTo)) {
        await finish('suppressed'); results.push({ id: reminder.id, status: 'suppressed' }); continue
      }
      if (Date.now() - started > 45000) break // lease is safely recoverable: no send intent yet
      const ready = await deliveryRpc('begin_reminder_delivery', { p_id: reminder.id, p_token: token,
        p_due: reminder.remind_at, p_next: next, p_timezone: timezone, p_target: whatsappTo })
      if (!ready) { results.push({ id: reminder.id, status: 'cancelled_or_changed' }); continue }
      sendStarted = true
      if (empty) { await finish('suppressed'); results.push({ id: reminder.id, status: 'suppressed' }); continue }
      let message: any = null
      if (whatsappTo) {
        if (!topic && !isBriefing && (process.env.TWILIO_REMINDER_BUTTONS_CONTENT_SID || process.env.TWILIO_REMINDER_CONTENT_SID)) {
          message = process.env.TWILIO_REMINDER_BUTTONS_CONTENT_SID && owner
            ? await sendWhatsAppReminderButtons(whatsappTo, label, token)
            : await sendWhatsAppReminderTemplate(whatsappTo, label, token)
        } else {
          message = await sendWhatsApp(whatsappTo, text, null, token)
        }
      } else await sendTelegram(Number(reminder.chat_id), text)
      providerReturned = true
      await finish('provider_accepted', message?.sid || null)
      results.push({ id: reminder.id, status: 'provider_accepted' })
    } catch (e) {
      console.error('REMINDER_DELIVERY_ERROR:', candidate.id, e instanceof Error ? e.message : 'unknown')
      let status = sendStarted ? 'outcome_unknown' : 'failed'
      if (reminder && !providerReturned && (!sendStarted || isDefiniteProviderRejection(e))) {
        try {
          await deliveryRpc('retry_reminder_delivery', { p_id: reminder.id, p_token: token, p_definite_rejection: sendStarted })
          status = 'failed'
        } catch { status = sendStarted ? 'outcome_unknown' : 'persistence_failed' }
      }
      results.push({ id: candidate.id, status })
    }
  }
  const failed = results.filter(r => ['failed', 'outcome_unknown', 'persistence_failed'].includes(r.status)).length
  const accepted = results.filter(r => r.status === 'provider_accepted').length
  return NextResponse.json({ ok: failed === 0, checked_at: now, due_count: due?.length || 0,
    accepted_count: accepted, sent_count: accepted, failed_count: failed, results }, { status: failed ? 503 : 200 })
}
