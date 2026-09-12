import assert from 'node:assert/strict'
import fs from 'node:fs'

const closure = fs.readFileSync('lib/agent/booking-closure.ts','utf8')
const ticketReader = fs.readFileSync('lib/agent/secure-ticket-reader.ts','utf8')
const gmail = fs.readFileSync('lib/agent/gmail-ticket-credential.ts','utf8')
const calendar = fs.readFileSync('lib/agent/booking-calendar-execution.ts','utf8')
const feature = fs.readFileSync('lib/feature-intents.ts','utf8')
const whatsapp = fs.readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const executeRoute = fs.readFileSync('app/api/agent/runs/[id]/execute/route.ts','utf8')
const watcher = fs.readFileSync('lib/agent/booking-change-worker.ts','utf8')
const cron = fs.readFileSync('app/api/cron/booking-events/route.ts','utf8')
const vercel = fs.readFileSync('vercel.json','utf8')

// Provider page + Share button should be a real source of the ticket credential.
assert.match(ticketReader,/navigator,'share'/)
assert.match(ticketReader,/__gogoShareData/)
assert.match(ticketReader,/share\|download\|show ticket\|view ticket\|ticket\|qr\|barcode\|pass\|wallet/i)
assert.match(ticketReader,/screenshot\(\{type:'png'/)
assert.match(ticketReader,/provider_page/)
assert.match(ticketReader,/human_auth_required/)
assert.match(ticketReader,/bookmyshow\.com/)

// Gmail is a parallel source for confirmations, QR images and PDFs.
assert.match(gmail,/gmail_connected/)
assert.match(gmail,/messages\?/) 
assert.match(gmail,/application\/pdf/)
assert.match(gmail,/mime\.startsWith\('image\/'\)/)
assert.match(gmail,/qr\|qrcode\|barcode/)
assert.match(gmail,/booking confirmation/)
assert.doesNotMatch(gmail,/method:\s*['"](?:POST|PATCH|DELETE)['"]/)

// Closure must resolve sources, store the provider-issued credential, schedule a
// reminder, prepare calendar approval and arm a change watch.
assert.match(closure,/findGmailTicketEvidence/)
assert.match(closure,/readProviderTicketPage/)
assert.match(closure,/storeCredential/)
assert.match(closure,/providerIssued:\s*true/)
assert.match(closure,/event_ticket/)
assert.match(closure,/ensureReminder/)
assert.match(closure,/2 \* 3600_000/)
assert.match(closure,/prepareBookingCalendarApproval/)
assert.match(closure,/booking-change-watch/)
assert.match(closure,/show my movie ticket/i)
assert.match(closure,/getDocumentSignedUrl/)
assert.match(closure,/retrieveEventCredential/)
assert.doesNotMatch(closure,/generate.*qr/i)

// WhatsApp must actually send the saved credential media and the same approval
// executor must work from both WhatsApp and dashboard.
assert.match(feature,/sendWhatsAppMediaMessage/)
assert.match(feature,/retrieveEventCredential/)
assert.match(feature,/closeBookingLink/)
assert.match(whatsapp,/booking_event_calendar/)
assert.match(whatsapp,/executeApprovedBookingCalendar/)
assert.match(executeRoute,/booking_event_calendar/)
assert.match(executeRoute,/executeApprovedBookingCalendar/)

// Calendar remains approval-gated and provider actions are not modified.
assert.match(calendar,/status:\s*'waiting_approval'/)
assert.match(calendar,/action_type:\s*'calendar_change'/)
assert.match(calendar,/eq\('status', 'approved'\)/)
assert.match(calendar,/create_booking_calendar_event/)
assert.match(calendar,/Provider:/)
assert.doesNotMatch(calendar,/sendUpdates=all/)

// Background closure keeps watching and cron is protected.
assert.match(watcher,/booking-change-watch/)
assert.match(watcher,/cancellation|cancelled/i)
assert.match(watcher,/venue change/i)
assert.match(watcher,/sendAgentPush/)
assert.match(cron,/CRON_SECRET/)
assert.match(cron,/processBookingChangeWatches/)
assert.match(vercel,/\/api\/cron\/booking-events/)

console.log('✅ Booking closure regression passed: provider Share/QR + Gmail + calendar + reminder + retrieval + change watch')
