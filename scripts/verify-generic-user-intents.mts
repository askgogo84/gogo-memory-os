import assert from 'node:assert/strict'
import fs from 'node:fs'
import { getAmbiguousReminderTime, parseReminderIntent } from '../lib/bot/handlers/reminders.ts'
import { hasExplicitReminderTiming, naturalReminderTask, normalizeNaturalReminderSave, parseNumberedChecklist } from '../lib/bot/handlers/natural-command-routing.ts'

// Screenshot regression 1: a dated natural reminder is a reminder command, never a note.
// Because no clock time was supplied, the natural-save layer must retain the full task/date
// and ask a conversational follow-up rather than silently inventing a time.
const reminderText='Save this as reminder I travel to US on 27th September'
const normalized=normalizeNaturalReminderSave(reminderText)
assert.equal(normalized,'remind me I travel to US on 27th September','natural save-as-reminder wording must normalize into reminder intent')
assert.equal(hasExplicitReminderTiming(normalized!),false,'date-only natural reminder must ask for a clock time')
assert.equal(naturalReminderTask(normalized!),'I travel to US on 27th September','date/task must survive the follow-up turn')
assert.equal(normalizeNaturalReminderSave('save this memory about my US trip'),null,'ordinary memory saves must not be hijacked as reminders')

// Screenshot regression 2: task first, time next. The task must be kept in pending_reminder.
const noTime=normalizeNaturalReminderSave('Save this as reminder call Mom')
assert.equal(noTime,'remind me call Mom')
assert.equal(parseReminderIntent(noTime!),null,'no-time reminder should ask for time rather than inventing one')
assert.equal(naturalReminderTask(noTime!),'call Mom','task must survive the clarification turn')
assert.equal(hasExplicitReminderTiming(noTime!),false)

// Screenshot regression 3: bare 8 is an AM/PM clarification, NOT a missing-time flow.
const ambiguous=normalizeNaturalReminderSave('Save this as reminder call Mom at 8')
assert.equal(ambiguous,'remind me call Mom at 8')
assert.ok(getAmbiguousReminderTime(ambiguous!),'bare 7-11 clock hour must use AM/PM clarification')
assert.equal(hasExplicitReminderTiming(ambiguous!),false,'bare ambiguous hour is not complete timing until AM/PM is chosen')

// Screenshot regression 4: the complete trip checklist must route to Lists and ignore 11 -.
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
assert.ok(checklist,'numbered preparation message must be recognised as a checklist')
assert.equal(checklist!.listName,'US trip')
assert.equal(checklist!.items.length,10,'blank numbered rows must be ignored')
assert.equal(checklist!.items[0],'nail polish for feet and Mani')
assert.equal(checklist!.items[9],'shopping for Keum')

const router=fs.readFileSync('lib/feature-intents.ts','utf8')
const natural=fs.readFileSync('lib/bot/handlers/natural-command-routing.ts','utf8')
const reminderPos=router.indexOf('normalizeNaturalReminderSave(text)')
const checklistPos=router.indexOf('parseNumberedChecklist(text)')
const legacyPos=router.indexOf('routeLegacyFeatureIntent(phone, text, extra)')
assert.ok(reminderPos>=0&&reminderPos<legacyPos,'natural reminder capture must run before generic/legacy fallback')
assert.ok(checklistPos>=0&&checklistPos<legacyPos,'numbered checklist capture must run before generic/agent fallback')
assert.match(router,/won't save it as a note instead/,'reminder persistence failure must fail closed rather than silently become a note')
assert.match(natural,/saveFollowupState\(params\.telegramId,'pending_reminder'/,'no-time reminder must persist pending reminder context')
assert.match(natural,/task:naturalReminderTask\(normalized\)/,'pending reminder must retain the original task')
assert.match(natural,/saveFollowupState\(params\.telegramId,'reminder_ampm'/,'ambiguous natural reminders must reuse the existing AM\/PM follow-up state')
assert.match(natural,/originalText:normalized/,'AM\/PM state must store parser-compatible normalized reminder text')
assert.match(natural,/\.eq\('recurring_pattern', parsed\.pattern\)\.eq\('message', parsed\.message\)/,'recurring dedupe must include reminder identity, not cadence alone')

console.log('✅ Generic-user screenshot reminder/checklist regressions passed')