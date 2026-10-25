import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 13 Oct 20:10: "Add 'Gogo test' to my calendar tomorrow at 4 pm" staged an event titled "'Gogo test' to my",
// and with two linked Google accounts it never said which one would get the event.
// Run: npx tsx scripts/verify-calendar-title-and-account-choice.mts
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://dummy.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'dummy-key'
process.env.OPENAI_API_KEY ||= 'dummy-key'
const ca: any = await import('../lib/bot/handlers/calendar-actions')
const acc: any = await import('../lib/services/google-calendar-accounts')

const t = (text: string) => ca.parseCalendarCreate(text)?.title
assert.equal(t("Add 'Gogo test' to my calendar tomorrow at 4 pm"), 'Gogo test')
assert.equal(t('Add "Gogo test" to my calendar tomorrow at 4 pm'), 'Gogo test')
assert.equal(t('Add ‘Gogo test’ to my calendar tomorrow at 4 pm'), 'Gogo test')
assert.equal(t('Schedule a meeting called "Board prep" tomorrow at 4 pm'), 'Board prep')
assert.equal(t('Add a meeting with Srini to my calendar tomorrow at 4 pm'), 'A meeting with Srini', 'no "to my" left in the title')
assert.ok(!/\bto my\b/i.test(String(t('Add dentist to my calendar tomorrow at 5 pm'))), 'plain titles lose the "to my calendar" words')
assert.equal(t("Add Gogo's lunch to my calendar tomorrow at 1 pm")?.toLowerCase().includes("gogo's lunch"), true, 'an apostrophe inside a title is not a quote')

const accounts = [{ email: 'goverdhan@tipplr.in', primary: true }, { email: 'goverdhan.md@gmail.com', primary: false }]
const pick = (text: string) => acc.pickCalendarAccountFromText(accounts, text)?.email ?? null
assert.equal(pick('add it to goverdhan.md@gmail.com'), 'goverdhan.md@gmail.com')
assert.equal(pick('use my tipplr calendar'), 'goverdhan@tipplr.in')
assert.equal(pick('gmail one'), 'goverdhan.md@gmail.com')
assert.equal(pick('the first one'), null, 'no account named: ask')
assert.equal(pick('goverdhan'), null, 'the shared name before the @ never decides')
assert.equal(pick('tipplr and gmail'), null, 'two accounts named is not an answer')

const fi = readFileSync(new URL('../lib/feature-intents.ts', import.meta.url), 'utf8')
assert.match(fi, /Which calendar should I add this to\?/)
assert.match(fi, /calendar_create_account_choice/)
assert.match(fi, /Calendar: \$\{payload\.accountEmail\}/, 'the approval names the account')
assert.match(fi, /getAccessTokenForCalendarAccount\(telegramId,String\(pending\.payload\.accountEmail\)\)/, 'the readback checks the account that was written to')
const cax = readFileSync(new URL('../lib/bot/handlers/calendar-actions.ts', import.meta.url), 'utf8')
assert.match(cax, /getAccessTokenForCalendarAccount\(telegramId, payload\.accountEmail\)/, 'the event is created on the chosen account')
console.log('Calendar: quoted titles are kept, and with two accounts Gogo asks which one gets the event')
