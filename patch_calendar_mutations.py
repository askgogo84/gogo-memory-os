#!/usr/bin/env python3
"""Wire calendar move/reschedule/cancel into the dispatch. Idempotent + fail-loud.
Run from repo root:  python patch_calendar_mutations.py"""
import io, os, sys
p=os.path.join(os.getcwd(),'lib/bot/process-message.ts')
raw=io.open(p,encoding='utf-8').read(); crlf='\r\n' in raw; t=raw.replace('\r\n','\n')

# 1) import the mutation handler
imp="import { buildCalendarActionReply, createCalendarConflictEvent, isCalendarAction } from './handlers/calendar-actions'\n"
imp_new=imp+"import { isCalendarMutation, isCalendarMutationConfirm, buildCalendarMutationReply, confirmCalendarMutation } from './handlers/calendar-mutations'\n"
if "from './handlers/calendar-mutations'" in t:
    print('= import: already applied')
else:
    if t.count(imp)!=1: sys.exit(f'! import anchor found {t.count(imp)}x. ABORT.')
    t=t.replace(imp,imp_new,1); print('+ import calendar-mutations')

# 2) confirm-check + mutation trigger, before the calendar-view dispatch
anchor="  if (isCalendarAction(incomingText)) {\n"
block=(
"  // Calendar mutation confirm (yes / pick a number) — only when one is pending.\n"
"  {\n"
"    const pendingCalMut = await getLatestFollowupState(resolvedUser.telegramId, 'calendar_mutation')\n"
"    if (pendingCalMut && isCalendarMutationConfirm(incomingText)) {\n"
"      const reply = await confirmCalendarMutation(resolvedUser.telegramId, incomingText, pendingCalMut.payload)\n"
"      if (reply) {\n"
"        await saveConversation(resolvedUser.telegramId, 'assistant', reply)\n"
"        return { text: formatOutgoingText(params.channel, reply), resolvedUser }\n"
"      }\n"
"    }\n"
"  }\n"
"\n"
"  // Calendar mutation: move / reschedule / cancel an event (confirms before mutating).\n"
"  if (isCalendarMutation(incomingText)) {\n"
"    const mut = await buildCalendarMutationReply(resolvedUser.telegramId, incomingText)\n"
"    if (mut.handled) {\n"
"      await saveConversation(resolvedUser.telegramId, 'assistant', mut.reply)\n"
"      return { text: formatOutgoingText(params.channel, mut.reply), resolvedUser }\n"
"    }\n"
"  }\n"
"\n"
)
if "Calendar mutation: move / reschedule / cancel" in t:
    print('= dispatch: already applied')
else:
    if t.count(anchor)!=1: sys.exit(f'! dispatch anchor found {t.count(anchor)}x. ABORT.')
    t=t.replace(anchor,block+anchor,1); print('+ calendar mutation dispatch')

io.open(p,'w',encoding='utf-8',newline='').write(t.replace('\n','\r\n') if crlf else t)
print('DONE.')
