#!/usr/bin/env python3
"""Make reminders conversational: route complex/recurring phrasings to Claude first,
teach Claude the exact cron pattern vocabulary, and extend the cron to understand
every_Nh / every_Nd + IST-windowed hourly_between. Idempotent + fail-loud.
Run from repo root:  python patch_conversational.py"""
import io, os, sys
def load(p): r=io.open(p,encoding='utf-8').read(); return r.replace('\r\n','\n'),('\r\n' in r)
def save(p,t,c): io.open(p,'w',encoding='utf-8',newline='').write(t.replace('\n','\r\n') if c else t)
def rep(t,old,new,label,sent):
    if sent in t: print(f'  = {label}: already applied'); return t
    if t.count(old)!=1: sys.exit(f'  ! {label}: anchor found {t.count(old)}x. ABORT.')
    print(f'  + {label}'); return t.replace(old,new,1)
R=os.getcwd()

# ---------------- 1) cron: every_N + windowed hourly_between ----------------
p=os.path.join(R,'app/api/cron/reminders/route.ts'); t,c=load(p); print('cron/reminders/route.ts')
t=rep(t,
"  if (lower.includes('hourly_between')) { next.setHours(next.getHours() + 1); return next }\n",
"  const ev = lower.match(/^every_(\\d+)(h|d)\\b/)\n"
"  if (ev) { const n = parseInt(ev[1], 10); if (ev[2] === 'h') next.setHours(next.getHours() + n); else next.setDate(next.getDate() + n); return next }\n"
"\n"
"  if (lower.includes('hourly_between')) {\n"
"    const m = lower.match(/hourly_between:(\\d{2}):(\\d{2})-(\\d{2}):(\\d{2})/)\n"
"    const IST = 5.5 * 60 * 60 * 1000\n"
"    const istNext = new Date(next.getTime() + IST + 60 * 60 * 1000)\n"
"    if (m) {\n"
"      const sH = +m[1], sM = +m[2], eH = +m[3], eM = +m[4]\n"
"      const h = istNext.getUTCHours(), mm = istNext.getUTCMinutes()\n"
"      const pastEnd = h > eH || (h === eH && mm > eM)\n"
"      const beforeStart = h < sH || (h === sH && mm < sM)\n"
"      if (pastEnd || beforeStart) { if (pastEnd) istNext.setUTCDate(istNext.getUTCDate() + 1); istNext.setUTCHours(sH, sM, 0, 0) }\n"
"    }\n"
"    return new Date(istNext.getTime() - IST)\n"
"  }\n",
'every_N + windowed hourly_between','const ev = lower.match(/^every_')
save(p,t,c)

# ---------------- 2) claude.ts: pattern vocabulary in the REMINDER rule ----------------
p=os.path.join(R,'lib/services/claude.ts'); t,c=load(p); print('claude.ts')
old_rule=(
"1. REMINDER: If user wants a reminder, output on FIRST LINE:\n"
"   One-time:  REMINDER: [ISO datetime +05:30] | [message]\n"
"   Recurring: REMINDER: [ISO datetime +05:30] | [message] | [pattern]\n"
"   Examples:\n"
"   \"remind me in 2 minutes\" -> REMINDER: 2026-04-20T09:45:00+05:30 | Reminder\n"
"   \"remind me every Monday at 9am\" -> REMINDER: 2026-04-21T09:00:00+05:30 | Review goals | every Monday\n"
)
new_rule=(
"1. REMINDER: If the user wants a reminder, output on the FIRST LINE:\n"
"   One-time:  REMINDER: [ISO datetime +05:30] | [clean task label]\n"
"   Recurring: REMINDER: [ISO datetime +05:30] | [clean task label] | [pattern]\n"
"   The first datetime is the FIRST fire in IST (+05:30) - calculate it yourself from the current time above.\n"
"   [clean task label] is a short action only (e.g. \"Drink water\", \"Call the bank\") - never include date/time words.\n"
"   [pattern] MUST be exactly ONE of:\n"
"     daily | weekly | monday | tuesday | wednesday | thursday | friday | saturday | sunday\n"
"     every_Nh   (every N hours, e.g. every_2h)\n"
"     every_Nd   (every N days, e.g. every_3d)\n"
"     hourly_between:HH:MM-HH:MM   (every hour within an IST window, 24-hour clock)\n"
"   Examples:\n"
"   \"remind me in 2 minutes to stretch\" -> REMINDER: 2026-07-16T15:47:00+05:30 | Stretch\n"
"   \"remind me every Monday at 9am to review goals\" -> REMINDER: 2026-07-20T09:00:00+05:30 | Review goals | monday\n"
"   \"drink water every 1 hr from 9am to 9pm daily\" -> REMINDER: 2026-07-17T09:00:00+05:30 | Drink water | hourly_between:09:00-21:00\n"
"   \"remind me every 2 hours to check the oven\" -> REMINDER: 2026-07-16T17:00:00+05:30 | Check the oven | every_2h\n"
"   \"take medicine every 3 days\" -> REMINDER: 2026-07-19T09:00:00+05:30 | Take medicine | every_3d\n"
)
t=rep(t,old_rule,new_rule,'reminder pattern vocabulary','[pattern] MUST be exactly ONE of')
save(p,t,c)

# ---------------- 3) process-message: Claude-first for complex recurrence ----------------
p=os.path.join(R,'lib/bot/process-message.ts'); t,c=load(p); print('process-message.ts')
anchor="  const eagerReminder = parseReminderIntent(incomingText)\n"
block=(
"  // Conversational parsing: recurring/complex phrasings that the regex chain\n"
"  // mis-parses go to Claude first (it understands language). Simple one-time\n"
"  // reminders still use the fast regex path below. Fail-safe: any error/decline\n"
"  // falls through to the regex chain.\n"
"  if (intent.type === 'set_reminder' && /\\b(every|hourly|twice|between|from .+ to |each (day|week|mon|tue|wed|thu|fri|sat|sun))\\b/i.test(incomingText)) {\n"
"    try {\n"
"      const cRaw = await askClaude(incomingText, [], [], resolvedUser.name, '')\n"
"      const cParsed = parseClaudeResponse(cRaw)\n"
"      if (cParsed.type === 'reminder' && cParsed.remindAt) {\n"
"        const ms = Date.parse(cParsed.remindAt)\n"
"        if (!isNaN(ms) && ms > Date.now() - 60000) {\n"
"          const normalizePat = (raw?: string): string | undefined => {\n"
"            if (!raw) return undefined\n"
"            const s = raw.toLowerCase().trim()\n"
"            const hb = s.match(/hourly_between:\\d{2}:\\d{2}-\\d{2}:\\d{2}/); if (hb) return hb[0]\n"
"            const en = s.match(/^every_(\\d+)([hd])\\b/); if (en) return `every_${en[1]}${en[2]}`\n"
"            let mm = s.match(/every\\s*(\\d+)\\s*hours?/); if (mm) return `every_${mm[1]}h`\n"
"            mm = s.match(/every\\s*(\\d+)\\s*days?/); if (mm) return `every_${mm[1]}d`\n"
"            for (const d of ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']) if (s.includes(d)) return d\n"
"            if (s.includes('week')) return 'weekly'\n"
"            if (s.includes('day') || s === 'daily') return 'daily'\n"
"            return undefined\n"
"          }\n"
"          const pat = normalizePat(cParsed.pattern)\n"
"          await createReminder(resolvedUser.telegramId, resolvedUser.telegramId, cParsed.remindAt, cParsed.message, pat, params.channel === 'whatsapp' ? resolvedUser.whatsappId : null)\n"
"          const conf = buildReminderConfirmation({ kind: pat ? 'recurring' : 'one_time', remindAtIso: new Date(ms).toISOString(), message: cParsed.message, pattern: pat } as any)\n"
"          const rr = styleReplyByIntent('set_reminder', conf)\n"
"          await saveConversation(resolvedUser.telegramId, 'assistant', rr)\n"
"          return { text: formatOutgoingText(params.channel, rr), resolvedUser }\n"
"        }\n"
"      }\n"
"    } catch (e) { console.error('Claude-first reminder parse failed, falling back to regex:', e) }\n"
"  }\n"
"\n"
)
t=rep(t,anchor,block+anchor,'Claude-first complex-recurrence','Conversational parsing: recurring/complex')
save(p,t,c)
print('\nDONE.')
