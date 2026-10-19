// 20 Oct round-2 dashboard retest after #684: "Jailer qr code" replayed the save confirmation
// ("Event ticket saved!", a past "Event alert"), and "My bookings" called the watched-and-ticketed
// Jailer 2 show "waiting for your approval, not booked yet".
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://example.supabase.co'; process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'x'
process.env.OPENAI_API_KEY ||= 'x'; process.env.ANTHROPIC_API_KEY ||= 'x'
const { retrievalSummary } = await import('../lib/services/asset-memory.ts')
const { renderMyBookingsReply, hasSavedTicket } = await import('../lib/agent/my-bookings.ts')

const live = '🎟️ Event ticket saved!\n\nJailer 2\n19 Oct 2026 · 21:45\n📍 PVR: Orion Mall, Dr Rajkumar Ro...\n\n⏰ Event alert Mon 19 Oct 18:45 (Asia/Kolkata)\n\nSay my reminders to see all alerts'
const cleaned = retrievalSummary(live)
assert.equal(cleaned, 'Jailer 2\n19 Oct 2026 · 21:45\n📍 PVR: Orion Mall, Dr Rajkumar Ro...')
// positive control: ordinary descriptions survive
assert.equal(retrievalSummary('Passport\nExpires 12 Mar 2031'), 'Passport\nExpires 12 Mar 2031')
console.log('PASS retrieval summary drops save-confirmation lines')

const now = Date.parse('2026-10-19T21:30:00Z') // 03:00 IST 20 Oct
const ticketed = { event_type: 'event', title: 'Jailer 2', location: 'PVR Orion Mall', start_at: '2026-10-19T16:15:00Z', timezone: 'Asia/Kolkata', lifecycle_state: 'waiting_approval', source_refs: [{ kind: 'ticket', documentId: 'd1' }] }
assert.equal(hasSavedTicket(ticketed as any), true)
let out = renderMyBookingsReply([ticketed as any], now)
assert.doesNotMatch(out, /waiting for your approval/)
assert.match(out, /\*Earlier\*\n• Jailer 2/)
// past booking never shows the approval note even without a ticket
out = renderMyBookingsReply([{ ...ticketed, source_refs: [] } as any], now)
assert.doesNotMatch(out, /waiting for your approval/)
// upcoming, no ticket, waiting approval: still flagged (positive control)
out = renderMyBookingsReply([{ ...ticketed, source_refs: [], start_at: '2026-10-20T14:30:00Z' } as any], now)
assert.match(out, /waiting for your approval, not booked yet/)
console.log('PASS my bookings: ticketed or past bookings are not "waiting for approval"')

const am = readFileSync(new URL('../lib/services/asset-memory.ts', import.meta.url), 'utf8')
const i = am.indexOf('const fromDocuments = await buildAssetRetrievalReply')
assert.ok(i > 0 && /getLatestFollowupState\(telegramId, 'last_asset'\)[\s\S]{0,600}getDocumentSignedUrl/.test(am.slice(i, i + 1500)))
assert.match(am.slice(i, i + 1500), /!isSensitiveDoc\(doc\)/)
console.log('PASS document-matched ticket reply attaches the file (never a sensitive doc)')
console.log('X1_X2_POLISH_OK 3/3')
