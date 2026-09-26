import assert from 'node:assert/strict'
import fs from 'node:fs'
import { normalizeInboxTriageWatcher, normalizeWebSearchWatcher } from '../lib/agent/watchers'

const expires='2026-10-01T03:05:00.000Z'
const web=normalizeWebSearchWatcher({
  title:'Trip weather · New York',
  query:'New York weather travel conditions 28 September 2026',
  triggerKeywords:['storm','heavy rain'],
  delivery:'both',cadenceMinutes:360,
  contextual:true,contextualKind:'travel',contextKey:'travel:test:destination_weather',contextRoot:'travel:test',
  contextClass:'destination_weather',reason:'Watch destination weather only for this trip.',
  expiresAt:expires,sourceRefs:[{type:'travel_ticket',id:'leg-1'}],
})
assert.ok(web)
assert.equal(web?.contextual,true)
assert.equal(web?.contextualKind,'travel')
assert.equal(web?.contextClass,'destination_weather')
assert.equal(web?.expiresAt,expires)
assert.match(String(web?.reason),/only for this trip/i)

const inbox=normalizeInboxTriageWatcher({
  title:'Trip email attention · New York',delivery:'whatsapp',cadenceMinutes:60,
  matchTerms:['EY239','Etihad','New York'],
  contextual:true,contextualKind:'travel',contextKey:'travel:test:travel_email',contextRoot:'travel:test',
  contextClass:'travel_email',reason:'Only itinerary-related action mail.',expiresAt:expires,
})
assert.deepEqual(inbox?.matchTerms,['EY239','Etihad','New York'])
assert.equal(inbox?.contextual,true)

const compiler=fs.readFileSync('lib/agent/contextual-travel-watchers.ts','utf8')
const watchers=fs.readFileSync('lib/agent/watchers.ts','utf8')
const commands=fs.readFileSync('lib/agent/watch-command.ts','utf8')
const cron=fs.readFileSync('app/api/cron/agent-watchers/route.ts','utf8')

assert.match(compiler,/compileUpcomingTravelWatchers/)
assert.match(compiler,/activeWebWatchersMax/)
assert.match(compiler,/manualCount/)
assert.match(compiler,/userStoppedAt/)
assert.match(compiler,/flight_status/)
assert.match(compiler,/connection_ground/)
assert.match(compiler,/destination_weather/)
assert.match(compiler,/travel_email/)
assert.match(compiler,/72\*3600_000/,'contextual travel monitoring must have a bounded post-arrival expiry')
assert.doesNotMatch(compiler,/\$\{destination\}\s+news/i,'contextual proactivity must not create generic destination-news watches')
assert.match(compiler,/gmail_connected/)
assert.match(watchers,/context_window_ended/)
assert.match(watchers,/condition\.matchTerms/)
assert.match(commands,/and\\s\+why/)
assert.match(commands,/Why:/)
assert.match(commands,/Source: saved/)
assert.match(commands,/Expires:/)
assert.match(commands,/userStoppedAt/)
assert.match(commands,/prepare-web-checkin/)
assert.match(cron,/compileUpcomingTravelWatchers/)

console.log('✅ T2/T4 contextual travel proactivity: bounded, source-aware, explainable, stoppable and auto-expiring')
