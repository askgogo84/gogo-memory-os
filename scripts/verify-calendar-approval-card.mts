import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 8:47 pm: the Yes/Cancel approval card dropped the "Calendar: <account>" line (and would drop a clash
// warning), so the user could not see which Google account the event was going to.
// 8:45 pm: a generic web-page flight watcher sent "Flight update ..." from boilerplate words on a tracker page.
// Run: npx tsx scripts/verify-calendar-approval-card.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const { parseCalendarApproval } = await import('../lib/channels/whatsapp.ts')
const base = '📅 *Ready to add — approval required*\n\nGogo test\nWed, 14 Oct, 4:00 pm\nDuration: 30 mins\n'
const tail = '\nNothing has been added yet.\nReply *yes* to add it, or *cancel* to leave your calendar unchanged.'
const plain = parseCalendarApproval(base + tail)!
assert.deepEqual(plain, { title: 'Gogo test', when: 'Wed, 14 Oct, 4:00 pm', duration: '30 mins' }, 'a single-account card is unchanged')
const acct = parseCalendarApproval(base + 'Calendar: goverdhan@tipplr.in\n' + tail)!
assert.equal(acct.account, 'goverdhan@tipplr.in')
assert.equal(acct.title, 'Gogo test')
const clash = parseCalendarApproval(base + 'Calendar: goverdhan@tipplr.in\n\n⚠️ Conflict: Standup at Wed, 14 Oct, 4:00 pm\n' + tail)!
assert.equal(clash.conflict, 'Standup at Wed, 14 Oct, 4:00 pm')
const wa = readFileSync(new URL('../lib/channels/whatsapp.ts', import.meta.url), 'utf8')
assert.match(wa, /approval\.account \? `\$\{approval\.duration\} · Calendar: \$\{approval\.account\}`/)
assert.match(wa, /Conflict: \$\{approval\.conflict\}/)
const w = readFileSync(new URL('../lib/agent/watchers.ts', import.meta.url), 'utf8')
assert.match(w, /contextClass === 'flight_status' && process\.env\.AERODATABOX_RAPIDAPI_KEY/, 'the web flight watcher stands down when the flight feed is configured')
console.log('Calendar approval card shows the account and any clash; the web flight watcher yields to the flight feed')
