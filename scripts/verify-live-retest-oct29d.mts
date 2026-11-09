// 29 Oct retest: watch cadence in words, movie asks never become map pins.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const wc = await import('../lib/agent/watch-command')
assert.equal(wc.cadenceWords(1440), 'once a day'); assert.equal(wc.cadenceWords(180), 'every 3 hours'); assert.equal(wc.cadenceWords(60), 'every hour'); assert.equal(wc.cadenceWords(15), 'every 15 minutes')
assert.doesNotMatch(readFileSync('lib/agent/watch-command.ts', 'utf8'), /every \$\{condition\.cadenceMinutes\} minutes initially/)
for (const p of ['app/api/dashboard/chat/route.ts', 'app/api/webhooks/whatsapp/route.ts']) assert.match(readFileSync(p, 'utf8'), /!\/\\b\(\?:shows\?\|showtimes\?\|movies\?\|films\?\|screening\|tickets\?\|seats\?\|playing\)\\b\/i\.test\(text\)/, p)
console.log('✓ "once a day" instead of 1440 minutes; "evening shows at PVR Orion Mall" is not a places search')
const er = readFileSync('lib/bot/handlers/edit-reminder.ts', 'utf8')
const idxRe = new RegExp(er.match(/const match = lower\.match\((\/\^.*?\/)\)\n  if \(!match\) return null/s)![1].slice(1, -1))
const pos = (t: string) => { const m = t.match(idxRe); return m ? Number(m[1]) : null }
assert.equal(pos('cancel the check iphone 16 128gb price on croma reminder'), null, 'a number inside the name is not a position')
assert.equal(pos('cancel the meeting reminder tomorrow at 9 am'), null, 'a clock time is not a position')
assert.equal(pos('cancel 6'), 6); assert.equal(pos('cancel reminder 3'), 3); assert.equal(pos('snooze 2 for 10 minutes'), 2); assert.equal(pos('cancel the 2nd one'), 2)
assert.equal(pos('snooze 10 minutes'), null)
assert.match(er, /const r = await stopReminderSeries\(telegramId, item\); if \(r\.ok\) done\+\+/)
console.log('✓ only "cancel 3"-style numbers pick a list position; "cancel all X reminders" stops every X')
