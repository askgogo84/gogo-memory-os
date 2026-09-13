import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getAmbiguousReminderTime, parseReminderIntent } from '../lib/bot/handlers/reminders.ts'
import { buildReminderFromAmPmChoice, isAmPmChoice } from '../lib/bot/handlers/reminder-ampm-followup.ts'
import { resolvePendingReminder } from '../lib/bot/pending-followup.ts'
import { hasExplicitReminderTiming, naturalReminderPendingContext, naturalReminderTask, normalizeNaturalReminderSave, parseNumberedChecklist } from '../lib/bot/handlers/natural-command-routing.ts'
import { isReservedSaveLastActionDestination } from '../lib/bot/handlers/save-last-context-routing.ts'

// Exact screenshot flow: date first, clock time second. It must never become a note.
const reminderText='Save this as reminder I travel to US on 27th September'
const normalized=normalizeNaturalReminderSave(reminderText)
assert.equal(normalized,'remind me I travel to US on 27th September')
assert.equal(isReservedSaveLastActionDestination(reminderText),true,'save-last-context must never claim natural reminder wording')
assert.equal(hasExplicitReminderTiming(normalized!),false)
const datedCtx=naturalReminderPendingContext(normalized!)
assert.equal(datedCtx.task,'I travel to US','absolute date must not pollute the reminder subject')
assert.match(datedCtx.dateText||'',/27th September/i,'absolute date must be retained as schedule context')
const datedFollowup=resolvePendingReminder(datedCtx,'8 pm')
assert.ok(datedFollowup,'8 pm must complete the pending dated reminder')
assert.equal(datedFollowup!.message,'I travel to US','two-turn reminder must retain the exact trip subject')
const datedParts=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',day:'numeric',month:'long',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(datedFollowup!.remindAtIso))
assert.match(datedParts,/27/)
assert.match(datedParts,/September/i)
assert.match(datedParts,/8:00\s*pm/i)
assert.equal(normalizeNaturalReminderSave('save this memory about my US trip'),null)

// Task first, time next: original task must survive the clarification turn.
const noTime=normalizeNaturalReminderSave('Save this as reminder call Mom')
assert.equal(noTime,'remind me call Mom')
assert.equal(isReservedSaveLastActionDestination('Save this as reminder call Mom'),true)
assert.equal(parseReminderIntent(noTime!),null)
assert.equal(naturalReminderTask(noTime!),'call Mom')
assert.equal(hasExplicitReminderTiming(noTime!),false)
const callMomFollowup=resolvePendingReminder({task:'call Mom'},'tomorrow 6 pm')
assert.ok(callMomFollowup)
assert.equal(callMomFollowup!.message,'call Mom')

// Bare 8 must use AM/PM clarification, and a normal human reply "8 pm" must work.
const ambiguous=normalizeNaturalReminderSave('Save this as reminder call Mom at 8')
assert.equal(ambiguous,'remind me call Mom at 8')
assert.equal(isReservedSaveLastActionDestination('Save this as reminder call Mom at 8'),true)
assert.ok(getAmbiguousReminderTime(ambiguous!))
assert.equal(hasExplicitReminderTiming(ambiguous!),false)
assert.equal(isAmPmChoice('8 pm'),true,'clock-bearing AM/PM reply must be accepted')
const resolvedEight=buildReminderFromAmPmChoice(ambiguous!,'8 pm')
assert.ok(resolvedEight,'8 pm must resolve the original ambiguous reminder')
const eightParts=new Intl.DateTimeFormat('en-IN',{timeZone:'Asia/Kolkata',hour:'numeric',minute:'2-digit',hour12:true}).format(new Date(resolvedEight!.remindAtIso))
assert.match(eightParts,/8:00\s*pm/i)
assert.equal(buildReminderFromAmPmChoice(ambiguous!,'9 pm'),null,'a different clock time must not silently answer the 8 AM/PM question')

// Day-parts are conversational but not precise enough to schedule without a clock.
const daypart=normalizeNaturalReminderSave('Save this as reminder call Mom tomorrow evening')
assert.equal(hasExplicitReminderTiming(daypart!),false,'day-part must ask for a concrete time')
const daypartCtx=naturalReminderPendingContext(daypart!)
assert.equal(daypartCtx.task,'call Mom')
assert.match(daypartCtx.dateText||'',/tomorrow/i)
const daypartResolved=resolvePendingReminder(daypartCtx,'7 pm')
assert.ok(daypartResolved)
assert.equal(daypartResolved!.message,'call Mom')

// First-class actions must never be reinterpreted as names for saving prior context.
for (const command of [
  'Save this as reminder call Mom tomorrow',
  'Save this as a task buy medicines',
  'Save this as list US trip',
  'Save this as checklist packing',
  'Save this as calendar event dinner',
  'Remember this as appointment dentist',
]) assert.equal(isReservedSaveLastActionDestination(command),true,`${command} must bypass save-last-context`)
assert.equal(isReservedSaveLastActionDestination('Save this as Claude counter'),false,'legacy named-note save must keep working')

// Complete trip checklist must route to Lists and ignore the empty 11th row.
const checklistText=`Things to do before my US trip
1 - nail polish for feet and Mani
2 - waxing
3 - facial
4 - suitcase purchase
5 - meds like dolo and cough syrup and for cold
6 - chutney powder
7 - soft bras from Uniqlo
8 - Lucknow fabric for stitching
9 - DL
10 - shopping for Keum
11 -`
const checklist=parseNumberedChecklist(checklistText)
assert.ok(checklist)
assert.equal(checklist!.listName,'US trip')
assert.equal(checklist!.items.length,10)
assert.equal(checklist!.items[0],'nail polish for feet and Mani')
assert.equal(checklist!.items[9],'shopping for Keum')

const router=fs.readFileSync('lib/feature-intents.ts','utf8')
const natural=fs.readFileSync('lib/bot/handlers/natural-command-routing.ts','utf8')
const saveLast=fs.readFileSync('lib/bot/handlers/save-last-context.ts','utf8')
const reminderPos=router.indexOf('normalizeNaturalReminderSave(text)')
const checklistPos=router.indexOf('parseNumberedChecklist(text)')
const legacyPos=router.indexOf('routeLegacyFeatureIntent(phone, text, extra)')
assert.ok(reminderPos>=0&&reminderPos<legacyPos)
assert.ok(checklistPos>=0&&checklistPos<legacyPos)
assert.match(router,/won't save it as a note instead/)
assert.match(router,/const stored = await getList\(extra\.telegramId, listName\)/,'checklist success must be read back from storage')
assert.match(router,/checklist_persistence_incomplete/,'partial checklist persistence must fail closed')
assert.match(saveLast,/isReservedSaveLastActionDestination\(raw\)/,'live save-last-context handler must enforce the reserved-action precedence guard')
assert.match(natural,/saveFollowupState\(params\.telegramId,'pending_reminder'/)
assert.match(natural,/dateText:pending\.dateText/,'pending reminder must preserve the date separately')
assert.match(natural,/saveFollowupState\(params\.telegramId,'reminder_ampm'/)
assert.match(natural,/originalText:normalized/)
assert.match(natural,/pickRecurringDuplicate/,'recurring dedupe must include time-of-day')
assert.match(natural,/\.eq\('message', parsed\.message\)/,'recurring dedupe must include reminder identity')
assert.match(natural,/is_recurring\.is\.null,is_recurring\.eq\.false/,'one-time dedupe must never overwrite a recurring series')

console.log('✅ Generic-user conversational reminder/checklist + WhatsApp precedence regressions passed')