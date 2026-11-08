// Friend reminders (8 Nov, live): a time inside the task stays in the task; only the trailing "when" schedules it.
import assert from 'node:assert/strict'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
const f = await import('../lib/bot/handlers/friend-reminders')
const NOW = new Date('2026-11-08T05:05:00Z') // 10:35 IST Sun

const live = f.parseFriendTime('attend the 9am meeting at Starbucks with Pradip tomorrow at 8am', NOW)!
assert.equal(live.task, 'attend the 9am meeting at Starbucks with Pradip', live.task)
assert.equal(live.remindAtIso, '2026-11-09T02:30:00.000Z', 'Mon 9 Nov 8:00 IST')
console.log('✓ live case: "the 9am meeting at Starbucks" kept; scheduled Mon 8:00 am')

const cases: [string, string][] = [
  ['call Divya at 6pm', 'call Divya'],
  ['check with Tom tomorrow at 11am', 'check with Tom'],
  ['join the 4pm review, tomorrow 3:30pm', 'join the 4pm review'],
  ['send the deck by 5pm today', 'send the deck'],
  ['pick up the 10:30am parcel at 9am tomorrow', 'pick up the 10:30am parcel'],
  ['take the medicine in 2 hours', 'take the medicine'],
  ['bring the keys on Monday at 7am', 'bring the keys'],
]
for (const [rest, want] of cases) assert.equal(f.friendTaskFromRest(rest), want, rest)
assert.equal(f.friendTaskFromRest('call Divya about the 9am slot'), null, 'no trailing time → parser fallback')
console.log('✓ only the trailing when is removed across 7 phrasings; no trailing time falls back')
console.log('Friend reminder task (8 Nov) checks passed')
