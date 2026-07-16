#!/usr/bin/env python3
"""Cron changes for follow-up reminders: interval-aware re-fire + safety cap.
Idempotent + fail-loud. Run from repo root:  python patch_followups_cron.py"""
import io, os, sys
p = os.path.join(os.getcwd(), 'app/api/cron/reminders/route.ts')
raw = io.open(p, encoding='utf-8').read()
crlf = '\r\n' in raw
t = raw.replace('\r\n', '\n')

# ── A) getNextOccurrence: read followup:<n><h|d>: interval ──
A_anchor = ("function getNextOccurrence(pattern: string, fromDate: Date): Date {\n"
            "  const next = new Date(fromDate)\n"
            "  const lower = pattern.toLowerCase()\n")
A_new = A_anchor + (
    "\n  // Follow-up cadence: followup:<interval>:<message>  e.g. followup:2h:..., followup:1d:...\n"
    "  const fu = lower.match(/^followup:(\\d+)(h|d):/)\n"
    "  if (fu) {\n"
    "    const n = parseInt(fu[1], 10)\n"
    "    if (fu[2] === 'h') next.setHours(next.getHours() + n)\n"
    "    else next.setDate(next.getDate() + n)\n"
    "    return next\n"
    "  }\n"
)
if 'Follow-up cadence: followup' in t:
    print('= getNextOccurrence: already applied')
else:
    if t.count(A_anchor) != 1: sys.exit(f'! getNextOccurrence anchor found {t.count(A_anchor)}x. ABORT.')
    t = t.replace(A_anchor, A_new, 1); print('+ getNextOccurrence interval parsing')

# ── B) reschedule block: follow-up safety cap ──
B_anchor = (
    "      if (reminder.is_recurring && reminder.recurring_pattern) {\n"
    "        const nextDate = getNextOccurrence(reminder.recurring_pattern, new Date(reminder.remind_at))\n"
    "        const { error: recurError } = await supabaseAdmin.from('reminders').insert({\n"
    "          telegram_id: reminder.telegram_id,\n"
    "          chat_id: reminder.chat_id,\n"
    "          // Carry the delivery target + zone forward; fall back to the resolved\n"
    "          // number / the user's saved timezone so a null parent doesn't poison\n"
    "          // the whole recurrence chain.\n"
    "          whatsapp_to: reminder.whatsapp_to || whatsappTo || null,\n"
    "          message: reminder.message,\n"
    "          remind_at: nextDate.toISOString(),\n"
    "          sent: false,\n"
    "          is_recurring: true,\n"
    "          recurring_pattern: reminder.recurring_pattern,\n"
    "          timezone: reminder.timezone || (await resolveUserTimezone(reminder.telegram_id)),\n"
    "        })\n"
    "        if (recurError) console.error('RECURRING_REMINDER_INSERT_FAILED:', reminder.id, recurError.message)\n"
    "      }\n"
)
B_new = (
    "      if (reminder.is_recurring && reminder.recurring_pattern) {\n"
    "        const isFu = String(reminder.recurring_pattern).startsWith('followup:')\n"
    "        const nextDate = getNextOccurrence(reminder.recurring_pattern, new Date(reminder.remind_at))\n"
    "        const baseInsert: any = {\n"
    "          telegram_id: reminder.telegram_id,\n"
    "          chat_id: reminder.chat_id,\n"
    "          whatsapp_to: reminder.whatsapp_to || whatsappTo || null,\n"
    "          message: reminder.message,\n"
    "          remind_at: nextDate.toISOString(),\n"
    "          sent: false,\n"
    "          is_recurring: true,\n"
    "          recurring_pattern: reminder.recurring_pattern,\n"
    "          timezone: reminder.timezone || (await resolveUserTimezone(reminder.telegram_id)),\n"
    "        }\n"
    "        if (isFu) {\n"
    "          // Safety cap: stop after ~7 days or 20 nudges so we never spam.\n"
    "          const startedAt = reminder.followup_started_at ? new Date(reminder.followup_started_at) : new Date()\n"
    "          const nudgeCount = (reminder.nudge_count || 0) + 1\n"
    "          const daysElapsed = (Date.now() - startedAt.getTime()) / 86400000\n"
    "          if (nudgeCount >= 20 || daysElapsed >= 7) {\n"
    "            const label = String(reminder.message || 'that').replace(/^follow up (with|about)\\s*/i, '').trim()\n"
    "            if (whatsappTo) {\n"
    "              try { await sendWhatsApp(whatsappTo, `\\ud83d\\udd15 I've reminded you several times about *${label}* \\u2014 I'll stop nagging now so I don't spam you. Just ask me to set it again anytime.`) } catch (e) { console.error('FOLLOWUP_STOP_MSG_FAILED:', e) }\n"
    "            }\n"
    "          } else {\n"
    "            baseInsert.nudge_count = nudgeCount\n"
    "            baseInsert.followup_started_at = startedAt.toISOString()\n"
    "            const { error: recurError } = await supabaseAdmin.from('reminders').insert(baseInsert)\n"
    "            if (recurError) console.error('FOLLOWUP_REMINDER_INSERT_FAILED:', reminder.id, recurError.message)\n"
    "          }\n"
    "        } else {\n"
    "          const { error: recurError } = await supabaseAdmin.from('reminders').insert(baseInsert)\n"
    "          if (recurError) console.error('RECURRING_REMINDER_INSERT_FAILED:', reminder.id, recurError.message)\n"
    "        }\n"
    "      }\n"
)
if 'const isFu = String(reminder.recurring_pattern).startsWith' in t:
    print('= reschedule cap: already applied')
else:
    if t.count(B_anchor) != 1: sys.exit(f'! reschedule anchor found {t.count(B_anchor)}x. ABORT.')
    t = t.replace(B_anchor, B_new, 1); print('+ follow-up safety cap in reschedule')

io.open(p, 'w', encoding='utf-8', newline='').write(t.replace('\n','\r\n') if crlf else t)
print('DONE.')
