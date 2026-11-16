// 17 Nov Muse/Instinct use-case run: a job handed to Gogo that merely names a day is not a reminder.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
import assert from 'node:assert/strict'
const { detectIntent } = await import('../lib/bot/detect-intent.ts')
const type = async (t: string) => (await detectIntent(t)).type
let checks = 0
for (const job of [
  'Reorganise my training this week around Tuesday travel and the Saturday 10k, keep easy volume the same and explain the changes',
  'Reorganize my week around the Friday offsite',
  'Negotiate my ACT bill before Monday',
  'Turn this recipe into a grocery list for Saturday dinner',
  'Fill the Cult.fit cancellation form by Friday and stop before submitting',
  'Sell my old sofa on OLX this Saturday, draft the listing first',
  'Unsubscribe me from newsletters by tomorrow',
  'Call the salon and book a haircut for Saturday 11 am',
  'Call Truffles and reserve a table for Sunday lunch',
  'Adjust my meal plan for the trip on Thursday',
]) { assert.notEqual(await type(job), 'set_reminder', job); assert.notEqual(await type(job), 'bare_time', job); checks++ }
// Still reminders: the everyday shorthand, and anything that asks for one.
for (const rem of [
  'call mom on Sunday',
  'call the bank tomorrow at 11am',
  'remind me to negotiate my ACT bill on Monday',
  'Fill the form by Friday, remind me on Thursday evening',
  'pay rent on Friday',
  'remind me to sell the sofa on Saturday',
]) { assert.equal(await type(rem), 'set_reminder', rem); checks++ }
// Unchanged neighbours.
assert.equal(await type('Movies showing near Rajajinagar this Sunday evening'), 'web_search'); checks++
console.log(`PASS verify-muse-usecases-nov17: ${checks} checks`)
