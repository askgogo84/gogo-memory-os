#!/usr/bin/env python3
"""Bug A: 'cancel the <meeting>' was swallowed by the edit_reminder branch before
the calendar-mutation dispatch could run. Fix: edit_reminder skips only when the
message names a calendar object (meeting/event/...); bare 'move it to 8 pm'
(reminder quick-action) stays with the reminder editor. Also: isCalendarMutation
never claims messages containing the word 'reminder'.
Idempotent + fail-loud. Run from repo root:  python patch_cancel_routing.py"""
import io, os, sys
def load(p): r=io.open(p,encoding='utf-8').read(); return r.replace('\r\n','\n'),('\r\n' in r)
def save(p,t,c): io.open(p,'w',encoding='utf-8',newline='').write(t.replace('\n','\r\n') if c else t)
def rep(t,old,new,label,sent):
    if sent in t: print(f'  = {label}: already applied'); return t
    if t.count(old)!=1: sys.exit(f'  ! {label}: anchor found {t.count(old)}x. ABORT.')
    print(f'  + {label}'); return t.replace(old,new,1)
R=os.getcwd()

# 1) process-message.ts: calendar-noun cancels/moves skip the reminder editor
p=os.path.join(R,'lib/bot/process-message.ts'); t,c=load(p); print('process-message.ts')
t=rep(t,
"  if (intent.type === 'edit_reminder') {\n"
"    const reply = await editLatestReminder(resolvedUser.telegramId, incomingText)\n",
"  // \"cancel the standup\" / \"move my 3pm meeting\" name a calendar object -> skip the\n"
"  // reminder editor and fall through to the calendar-mutation dispatch below.\n"
"  // Bare \"move it to 8 pm\" (reminder nudge quick-action) has no such noun and stays here.\n"
"  const namesCalendarObject = /\\b(meeting|event|appointment|appt|standup|sync|session|slot|calendar)\\b/i.test(incomingText)\n"
"  if (intent.type === 'edit_reminder' && !(isCalendarMutation(incomingText) && namesCalendarObject)) {\n"
"    const reply = await editLatestReminder(resolvedUser.telegramId, incomingText)\n",
'edit_reminder gate','namesCalendarObject')
save(p,t,c)

# 2) calendar-mutations.ts: never claim messages that say "reminder"
p=os.path.join(R,'lib/bot/handlers/calendar-mutations.ts'); t,c=load(p); print('calendar-mutations.ts')
t=rep(t,
"export function isCalendarMutation(text: string): boolean {\n"
"  const t = (text || '').toLowerCase()\n",
"export function isCalendarMutation(text: string): boolean {\n"
"  const t = (text || '').toLowerCase()\n"
"  if (/\\breminders?\\b/.test(t)) return false // \"cancel my X reminder\" stays with the reminder editor\n",
'reminder-word guard',"stays with the reminder editor")
save(p,t,c)
print('\nDONE.')
