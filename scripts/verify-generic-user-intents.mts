import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseReminderIntent } from '../lib/bot/handlers/reminders.ts'
import { naturalReminderTask, normalizeNaturalReminderSave, parseNumberedChecklist } from '../lib/bot/handlers/natural-command-routing.ts'

const reminderText='Save this as reminder I am travels on 27th September to us'
const normalized=normalizeNaturalReminderSave(reminderText)
assert.equal(normalized,'remind me I am travels on 27th September to us','natural save-as-reminder wording must normalize into reminder intent')
const reminder=normalized?parseReminderIntent(normalized):null
assert.ok(reminder,'dated natural reminder must parse instead of falling to notes/general chat')
assert.ok(reminder!.message.length>0,'reminder must keep a useful subject')
assert.doesNotMatch(reminder!.message,/save this as reminder/i,'command wrapper must not leak into reminder subject')
assert.equal(normalizeNaturalReminderSave('save this memory about my US trip'),null,'ordinary memory saves must not be hijacked as reminders')

const noTime=normalizeNaturalReminderSave('save this as reminder call Mom')
assert.equal(noTime,'remind me call Mom')
assert.equal(parseReminderIntent(noTime!),null,'no-time reminder should ask for time rather than inventing one')
assert.equal(naturalReminderTask(noTime!),'call Mom','task must survive the clarification turn')

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

console.log('✅ Generic-user reminder/checklist routing regression passed')
