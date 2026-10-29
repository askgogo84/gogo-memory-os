// 29 Oct retest: watch cadence in words, movie asks never become map pins.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const wc = await import('../lib/agent/watch-command')
assert.equal(wc.cadenceWords(1440), 'once a day'); assert.equal(wc.cadenceWords(180), 'every 3 hours'); assert.equal(wc.cadenceWords(60), 'every hour'); assert.equal(wc.cadenceWords(15), 'every 15 minutes')
assert.doesNotMatch(readFileSync('lib/agent/watch-command.ts', 'utf8'), /every \$\{condition\.cadenceMinutes\} minutes initially/)
for (const p of ['app/api/dashboard/chat/route.ts', 'app/api/webhooks/whatsapp/route.ts']) assert.match(readFileSync(p, 'utf8'), /!\/\\b\(\?:shows\?\|showtimes\?\|movies\?\|films\?\|screening\|tickets\?\|seats\?\|playing\)\\b\/i\.test\(text\)/, p)
console.log('✓ "once a day" instead of 1440 minutes; "evening shows at PVR Orion Mall" is not a places search')
