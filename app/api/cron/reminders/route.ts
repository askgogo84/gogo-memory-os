import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsApp, sendWhatsAppReminderTemplate, sendWhatsAppReminderButtons } from '@/lib/whatsapp'
import { isSuppressed } from '@/lib/bot/handlers/reminder-optout'
// getNextOccurrence now lives in the shared reminder-series module so skip-occurrence
// advances a series exactly the way this cron does — one implementation, no drift.
import { getNextOccurrence, describeCadence } from '@/lib/services/reminder-series'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_FAIL_ATTEMPTS = 3
// Recurring dedupe: skip inserting a next-occurrence row if an identical pending
// reminder already exists within ±this window of the computed nextDate, so
// recurring + snooze/move copies don't stack. Fail-open (never drop on error).
const DEDUPE_WINDOW_MIN = 30
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in'
// Delivery-truth gate. When unset, markReminderSent writes exactly {sent, sent_at}
// as before — the twilio_sid/delivery_status columns stay untouched, so unsetting
// the env var reverts behaviour to HEAD instantly. Fail-open: never drops a reminder.
const REMINDER_DELIVERY_TRACKING =
  process.env.REMINDER_DELIVERY_TRACKING === '1' || process.env.REMINDER_DELIVERY_TRACKING === 'true'
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
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status} ${body}`)
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

// sid/status are the values returned by the Twilio send at the call site; abandoned
// marks a reminder given up after MAX_FAIL_ATTEMPTS. When REMINDER_DELIVERY_TRACKING
// is unset the update object is byte-identical to HEAD ({sent, sent_at} only).
async function markReminderSent(
  id: string,
  sid?: string | null,
  status?: string | null,
  abandoned?: boolean,
  suppressed?: boolean,
) {
  const update: any = { sent: true, sent_at: new Date().toISOString() }
  if (REMINDER_DELIVERY_TRACKING) {
    if (sid) {
      update.twilio_sid = sid
      update.delivery_status = 'accepted'
      console.log('REMINDER_TRACKED:', { id, sid, acceptStatus: status || 'accepted' })
    } else if (abandoned) {
      update.delivery_status = 'abandoned'
    } else if (suppressed) {
      // Consumed by the opt-out gate, not a real delivery. Tag it so the audit
      // doesn't conflate it with untracked (Telegram/freeform) sends — same reason
      // the abandon path tags 'abandoned'. Gated: unset ⇒ {sent, sent_at} only.
      update.delivery_status = 'suppressed'
    }
  }
  const { error } = await supabaseAdmin
    .from('reminders')
    .update(update)
    .eq('id', id)
  if (error) console.error('Failed to mark reminder sent:', error.message)
}

async function incrementFailAttempts(id: string, current: number): Promise<number> {
  const next = (current || 0) + 1
  const { error } = await supabaseAdmin
    .from('reminders')
    .update({ fail_attempts: next, last_failed_at: new Date().toISOString() })
    .eq('id', id)
  if (error) console.error('Failed to increment fail_attempts:', id, error.message)
  return next
}

// Fire the actual morning briefing for a user's WhatsApp number
async function triggerMorningBriefing(whatsappTo: string): Promise<boolean> {
  try {
    const res = await fetch(`${APP_URL}/api/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: whatsappTo }),
    })
    if (!res.ok) return false
    // POST returns { ok: true, reply } — we must send it to WhatsApp ourselves
    const data = await res.json()
    const briefingText = data?.reply
    if (briefingText) {
      await sendWhatsApp(whatsappTo, briefingText)
      console.log(`BRIEFING_SENT: ${whatsappTo}`)
    } else {
      console.error('BRIEFING_EMPTY_REPLY:', data)
      await sendWhatsApp(whatsappTo, '🌅 Good morning! Type *morning* to get your daily briefing.')
    }
    return true
  } catch (e) {
    console.error('BRIEFING_TRIGGER_FAILED:', e)
    return false
  }
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const now = new Date().toISOString()

  // Returns null when the bucket is empty so the caller can skip the send
  // entirely instead of messaging the user "Nothing saved in this bucket yet."
  async function buildTopicDigest(telegramId: number, topic: string): Promise<string | null> {
    const { data } = await supabaseAdmin
      .from('memory_embeddings')
      .select('content, created_at')
      .eq('telegram_id', telegramId)
      .ilike('topic', topic)
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
      .limit(10)
    const rows = data || []
    if (!rows.length) return null
    return `📂 *${topic} digest*\n\n${rows.map((r: any) => `• ${r.content}`).join('\n')}`
  }

  const { data: due, error: dueError } = await supabaseAdmin
    .from('reminders')
    .select('*')
    .eq('sent', false)
    .lte('remind_at', now)
    .order('remind_at', { ascending: true })
    .limit(50)

  if (dueError) {
    console.error('CRON_REMINDERS_SELECT_FAILED:', dueError)
    return NextResponse.json({ ok: false, error: dueError.message }, { status: 500 })
  }

  const results: any[] = []

  for (const reminder of due || []) {
    // ── Consent gate (FAIL CLOSED) ──────────────────────────────────────────────
    // A recipient who replied STOP must never receive a reminder from this owner.
    // Only reminders with whatsapp_to can be third-party friend reminders; the check
    // is harmless for the owner's own number (never suppressed against themselves).
    // This is the ONE guard in this cron that fails CLOSED: if the opt-out lookup
    // throws we DO NOT SEND and leave the row pending to retry next run — every other
    // guard here fails open. If suppressed, consume the row (mark sent) so it doesn't
    // retry forever.
    if (reminder.whatsapp_to) {
      let suppressed: boolean
      try {
        suppressed = await isSuppressed(reminder.telegram_id, reminder.whatsapp_to)
      } catch (e: any) {
        console.error('OPTOUT_CHECK_FAILED (fail-closed, not sending):', reminder.id, e?.message || e)
        results.push({ id: reminder.id, channel: 'whatsapp', to: reminder.whatsapp_to, message: String(reminder.message || ''), status: 'optout_check_failed' })
        continue
      }
      if (suppressed) {
        await markReminderSent(reminder.id, null, null, false, true)
        console.log('OPTOUT_SUPPRESSED:', { id: reminder.id, to: reminder.whatsapp_to, owner: reminder.telegram_id })
        results.push({ id: reminder.id, channel: 'whatsapp', to: reminder.whatsapp_to, message: String(reminder.message || ''), status: 'suppressed_optout' })
        continue
      }
    }

    const msgRaw = String(reminder.message || '').trim()
    const isBriefing = BRIEFING_KEYWORDS.test(msgRaw)
    const isFollowup = String(reminder.recurring_pattern || '').startsWith('followup:')

    // Topic digest (1.5/#18): message is "[topic_digest] <topic>"
    const digestTopic = msgRaw.startsWith('[topic_digest]') ? msgRaw.replace(/^\[topic_digest\]\s*/i, '').trim() : null

    // Build the reminder text
    let reminderText = isFollowup
      ? `🔔 *Follow-up reminder*\n\n📋 ${msgRaw}\n\nDid you hear back?\n• Reply *done* — mark as resolved\n• Reply *snooze 2 days* — remind again later\n• Reply *snooze friday* — remind on Friday`
      : (() => { const lbl = msgRaw.replace(/^to\s+/i, ''); const emo = pickReminderEmoji(lbl); return `${emo} *Reminder*\n\n${emo} ${lbl}\n\nQuick actions:\n• snooze 10 mins\n• move it to 8 pm\n• done${reminder.is_recurring ? `\n\nRepeats: ${describeCadence(reminder.recurring_pattern)}` : ''}` })()
    // An empty topic-digest bucket has nothing worth sending. Skip the send
    // (but still consume/reschedule the reminder below) rather than messaging
    // the user "Nothing saved in this bucket yet."
    let skipEmptyDigest = false
    if (digestTopic) {
      const digest = await buildTopicDigest(Number(reminder.telegram_id), digestTopic)
      if (digest === null) {
        skipEmptyDigest = true
      } else {
        reminderText = digest
      }
    }

    try {
      // Holds the Twilio message returned by whichever send branch fired, so its
      // sid/status can be recorded by markReminderSent below. Null for branches
      // with no direct Twilio return (briefing, telegram) — those stay untracked.
      let sentMsg: any = null
      // Resolve once up front so the recurrence reschedule (below) can carry a
      // real WhatsApp number forward even when the parent row's whatsapp_to is
      // null — e.g. legacy topic-digest rows created without it.
      const whatsappTo = await findWhatsAppForReminder(reminder)

      if (skipEmptyDigest) {
        console.log(`TOPIC_DIGEST_EMPTY: nothing to send, skipping. telegram_id=${reminder.telegram_id} topic="${digestTopic}"`)
        results.push({ id: reminder.id, channel: 'none', to: null, message: msgRaw, status: 'skipped_empty' })
      } else {
        if (whatsappTo) {
          if (!F2F_REMINDERS_ENABLED && !(await reminderGoesToOwner(reminder, whatsappTo))) {
            // F2F gate OFF: recipient is not the owner → do not deliver. The row is
            // consumed by markReminderSent at the end of this iteration so it won't
            // retry forever. No routing/parsing/schema change; delivery only.
            console.log('F2F_DISABLED_SUPPRESSED:', { id: reminder.id, to: whatsappTo, owner: reminder.telegram_id })
            results.push({ id: reminder.id, channel: 'none', to: whatsappTo, message: msgRaw, status: 'f2f_disabled' })
          } else {
            if (isBriefing) {
              // Trigger the actual briefing instead of a dumb notification
              console.log(`BRIEFING_REMINDER: triggering actual briefing for ${whatsappTo}`)
              const ok = await triggerMorningBriefing(whatsappTo)
              if (!ok) {
                // Fallback: send a nudge if briefing API fails
                await sendWhatsApp(whatsappTo, '🌅 Good morning! Type *morning* to get your daily briefing.')
              }
            } else if (digestTopic) {
              // Topic digests are rich dynamic content - freeform (in-session only for now).
              sentMsg = await sendWhatsApp(whatsappTo, reminderText)
            } else if (process.env.TWILIO_REMINDER_BUTTONS_CONTENT_SID || process.env.TWILIO_REMINDER_CONTENT_SID) {
              // Reminders are business-initiated: ALWAYS use an approved Utility
              // template. Freeform outside the 24h window is accepted then dropped
              // async with 63016 (uncatchable) - the Jul 19 outage.
              // Prefer the Quick-Reply buttons template when its SID is set (both are
              // Utility, so the out-of-24h-window guarantee is unchanged); fall back to
              // the text template otherwise — reversible rollout via the env var alone.
              const reminderLabel = (() => { const lbl = msgRaw.replace(/^to\s+/i, ''); return `${pickReminderEmoji(lbl)} ${lbl}` })()
              // Buttons only for the owner's OWN reminders — a friend recipient can't act
              // on buttons that mutate a row they don't own (they'd get "couldn't find a
              // recent reminder"). Friend reminders get the plain text template instead.
              if (process.env.TWILIO_REMINDER_BUTTONS_CONTENT_SID && await reminderGoesToOwner(reminder, whatsappTo)) {
                sentMsg = await sendWhatsAppReminderButtons(whatsappTo, reminderLabel)
              } else {
                sentMsg = await sendWhatsAppReminderTemplate(whatsappTo, reminderLabel)
              }
            } else {
              console.warn('NO_REMINDER_TEMPLATE_SID: freeform send - will NOT deliver outside the 24h window')
              sentMsg = await sendWhatsApp(whatsappTo, reminderText)
            }
            results.push({ id: reminder.id, channel: 'whatsapp', to: whatsappTo, message: msgRaw, status: 'sent', isBriefing })
          }
        } else if (reminder.chat_id && Number(reminder.chat_id) > 0) {
          await sendTelegram(Number(reminder.chat_id), reminderText)
          results.push({ id: reminder.id, channel: 'telegram', to: reminder.chat_id, message: msgRaw, status: 'sent' })
        } else {
          throw new Error(`No delivery target. whatsapp_to=${reminder.whatsapp_to || ''}, telegram_id=${reminder.telegram_id || ''}, chat_id=${reminder.chat_id || ''}`)
        }
      }

      if (reminder.is_recurring && reminder.recurring_pattern) {
        const isFu = String(reminder.recurring_pattern).startsWith('followup:')
        const nextDate = getNextOccurrence(reminder.recurring_pattern, new Date(reminder.remind_at))
        const baseInsert: any = {
          telegram_id: reminder.telegram_id,
          chat_id: reminder.chat_id,
          whatsapp_to: reminder.whatsapp_to || whatsappTo || null,
          message: reminder.message,
          remind_at: nextDate.toISOString(),
          sent: false,
          is_recurring: true,
          recurring_pattern: reminder.recurring_pattern,
          timezone: reminder.timezone || (await resolveUserTimezone(reminder.telegram_id)),
        }
        if (isFu) {
          // Safety cap: stop after ~7 days or 20 nudges so we never spam.
          const startedAt = reminder.followup_started_at ? new Date(reminder.followup_started_at) : new Date()
          const nudgeCount = (reminder.nudge_count || 0) + 1
          const daysElapsed = (Date.now() - startedAt.getTime()) / 86400000
          if (nudgeCount >= 20 || daysElapsed >= 7) {
            const label = String(reminder.message || 'that').replace(/^follow up (with|about)\s*/i, '').trim()
            if (whatsappTo) {
              try { await sendWhatsApp(whatsappTo, `\ud83d\udd15 I've reminded you several times about *${label}* \u2014 I'll stop nagging now so I don't spam you. Just ask me to set it again anytime.`) } catch (e) { console.error('FOLLOWUP_STOP_MSG_FAILED:', e) }
            }
          } else {
            baseInsert.nudge_count = nudgeCount
            baseInsert.followup_started_at = startedAt.toISOString()
            const { error: recurError } = await supabaseAdmin.from('reminders').insert(baseInsert)
            if (recurError) console.error('FOLLOWUP_REMINDER_INSERT_FAILED:', reminder.id, recurError.message)
          }
        } else {
          // Dedupe guard (plain recurring only): skip if the SAME user already has a
          // pending, identical-label reminder near nextDate — stops recurring +
          // snooze/move copies from stacking. Fail-open: any query error → insert.
          let alreadyPending = false
          try {
            const winMs = DEDUPE_WINDOW_MIN * 60 * 1000
            const lo = new Date(nextDate.getTime() - winMs).toISOString()
            const hi = new Date(nextDate.getTime() + winMs).toISOString()
            let dupeQuery = supabaseAdmin
              .from('reminders')
              .select('id')
              .eq('telegram_id', reminder.telegram_id)
              .eq('message', reminder.message)
              .eq('sent', false)
              .gte('remind_at', lo)
              .lte('remind_at', hi)
              .limit(1)
            if (reminder.whatsapp_to) dupeQuery = dupeQuery.eq('whatsapp_to', reminder.whatsapp_to)
            const { data: existingDupe, error: dupeErr } = await dupeQuery
            if (dupeErr) console.error('RECURRING_DEDUPE_QUERY_FAILED:', reminder.id, dupeErr.message)
            else alreadyPending = !!(existingDupe && existingDupe.length)
          } catch (e: any) {
            console.error('RECURRING_DEDUPE_QUERY_FAILED:', reminder.id, e?.message || e)
          }
          if (alreadyPending) {
            console.log('RECURRING_DEDUPE_SKIP:', reminder.id)
          } else {
            const { error: recurError } = await supabaseAdmin.from('reminders').insert(baseInsert)
            if (recurError) console.error('RECURRING_REMINDER_INSERT_FAILED:', reminder.id, recurError.message)
          }
        }
      }

      await markReminderSent(reminder.id, sentMsg?.sid, sentMsg?.status)
    } catch (error: any) {
      const message = error?.message || String(error)
      const currentAttempts = reminder.fail_attempts || 0
      const newAttempts = await incrementFailAttempts(reminder.id, currentAttempts)

      console.error('REMINDER_SEND_FAILED:', {
        id: reminder.id, message: msgRaw,
        whatsapp_to: reminder.whatsapp_to, telegram_id: reminder.telegram_id,
        fail_attempts: newAttempts, error: message,
      })

      if (newAttempts >= MAX_FAIL_ATTEMPTS) {
        console.error(`REMINDER_ABANDONED id=${reminder.id} after ${newAttempts} attempts`)
        await markReminderSent(reminder.id, null, null, true)
      }

      results.push({
        id: reminder.id,
        channel: reminder.whatsapp_to ? 'whatsapp' : 'unknown',
        to: reminder.whatsapp_to || reminder.chat_id || null,
        message: msgRaw,
        status: newAttempts >= MAX_FAIL_ATTEMPTS ? 'abandoned' : 'failed',
        fail_attempts: newAttempts,
        error: message,
      })
    }
  }

  return NextResponse.json({
    ok: true,
    checked_at: now,
    due_count: due?.length || 0,
    sent_count: results.filter((r) => r.status === 'sent').length,
    skipped_count: results.filter((r) => r.status === 'skipped_empty').length,
    failed_count: results.filter((r) => r.status === 'failed').length,
    abandoned_count: results.filter((r) => r.status === 'abandoned').length,
    results,
  })
}

