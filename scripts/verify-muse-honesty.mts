// Muse parity overnight (11 Oct): capabilities AskGogo does not have yet get one honest answer with
// an alternative, and routing no longer hijacks questions, flight claims or DND requests.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const { unsupportedCapability } = await import('../lib/bot/unsupported-capabilities.ts')
const expect: Record<string, string> = {
  'Build me a simple Kanban board for my AskGogo ideas with To do, Doing and Done.': 'custom_app',
  "Make me a Spotify playlist of 20 Kannada indie songs I haven't heard.": 'music',
  'If a family member messages you asking where I am, share where my calendar says I am.': 'share_location_with_others',
  'Watch this wallet address and alert me on any outgoing transaction: bc1qxyz': 'crypto_wallet',
  'Every Monday, draft replies to new comments on my YouTube channel for me to approve.': 'youtube_comments',
  'Watch my Sentry errors and draft a fix in GitHub when a new crash appears.': 'dev_monitoring',
  "I'm stuck in the GST portal. Look at my screen and tell me where to click.": 'screen',
  "Open my 'AskGogo pitch notes' Google Doc and add a paragraph on pricing.": 'doc_edit',
  'Cut this 90-minute match video down to just the rallies.': 'video_edit',
  "Dress your avatar for what's on my calendar today.": 'avatar',
  'Build me a dashboard of my steps and weight from this Health export.': 'health_export',
  'Call Airtel customer care about my broadband outage, wait on hold, and call me when a person picks up.': 'phone_call',
  'Whenever an email confirms a meeting or booking, add it to my calendar automatically.': 'email_to_calendar_automation',
}
for (const [t, id] of Object.entries(expect)) assert.equal(unsupportedCapability(t)?.id, id, t)
for (const t of [
  'Create a board meeting for Monday at 10 am', 'Add my passport document', 'Remind me to call HDFC customer care at 5 pm',
  'call mom tomorrow at 6 pm', 'Make a packing list for Friday', 'What is on my calendar today', 'Draft a LinkedIn post about AskGogo',
  'Book a table for 4 at Toit Indiranagar this Friday at 8 pm.', 'add milk to my grocery list', 'Create a Hugging Face account for a@b.in',
]) assert.equal(unsupportedCapability(t), null, t)
for (const r of Object.keys(expect).map((t) => unsupportedCapability(t)!.reply)) {
  assert.doesNotMatch(r, /\bI(?:'ll| will) (?:check|monitor|watch|track)\b/, 'no promises')
  assert.doesNotMatch(r, /https?:\/\//, 'no invented links')
}

const route = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
assert.ok(route.indexOf('const unsupported=unsupportedCapability(text)') < route.indexOf('// Watcher commands create/read persistent state'), 'answered before any handler')
assert.match(readFileSync('lib/bot/process-message.ts', 'utf8'), /const unsupported = unsupportedCapability\(incomingText\)/)

const { detectIntent } = await import('../lib/bot/detect-intent.ts')
for (const t of ['Which badminton courts near Indiranagar are free this Saturday 7-9 am?', 'What are the evening shows at PVR Orion tomorrow?']) assert.notEqual((await detectIntent(t)).type, 'set_reminder', t)
assert.equal((await detectIntent('remind me on Saturday at 7 am to play badminton')).type, 'set_reminder')
assert.equal((await detectIntent('Do laundry on Sunday at 5 pm')).type, 'set_reminder', 'short notes with a time stay reminders')

const { parseCalendarCreate } = await import('../lib/bot/handlers/calendar-actions.ts')
assert.equal(parseCalendarCreate('My IndiGo flight 6E 123 on 8 Oct was delayed 4 hours. Check if I qualify for compensation and prepare the request for my review.'), null)
assert.ok((parseCalendarCreate('Help me prepare for my dentist appointment tomorrow at 5 pm') as any)?.preparation, 'appointment preparation still clarifies')

const { parseExternalAccountRequest, mayBeAccountRequest } = await import('../lib/agent/external-account-intent.ts')
const dnd = 'Help me register for DND and report the spam numbers that called me this week.'
assert.equal(parseExternalAccountRequest(dnd), null)
assert.equal(mayBeAccountRequest(dnd), false)

console.log('Muse honesty layer and routing fixes passed')
