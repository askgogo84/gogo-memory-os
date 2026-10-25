import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { cleanEmailSnippet, formatEmailDateIST, wantsSingleLatestEmail } from '../lib/agent/email-format'
// 15 Oct live test of the dashboard chat in the owner's Chrome. Each block is one failure seen there.
// Run: npx tsx scripts/verify-dashboard-usecases-oct15.mts

// 1. "Find my Amsterdam flight ticket" got "I'm not certain which travel option you mean". The "which one?"
//    guard is there so Gogo never acts on the wrong object; reading or searching acts on nothing, so it lists.
const code = ts.transpileModule(readFileSync('lib/agent/jev-router.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const router: any = {}; runInNewContext(code, { exports: router, require: () => ({ supabaseAdmin: {} }), console, Number, String })
const jev = (mode: string, conf = 0.9) => ({ ok: true, contextual: true, actionMode: { choice: mode, confidence: conf }, decisionReadiness: { choice: 'clarify', confidence: 0.95 }, referentKind: { choice: 'travel_option', confidence: 0.9 } })
assert.equal(router.jevClarificationReply(jev('read')), null, 'a read is not blocked by the guard')
assert.equal(router.jevClarificationReply(jev('research')), null, 'a search is not blocked by the guard')
assert.match(String(router.jevClarificationReply(jev('private_write'))), /not certain which travel option/, 'a change still asks which one')
assert.match(String(router.jevClarificationReply(jev('consequential_write'))), /not certain/)
assert.match(String(router.jevClarificationReply(jev('read', 0.4))), /not certain/, 'an unsure read reading keeps the guard')

// 2. "What's the latest email from Google?" listed two emails with Pacific-time dates and newsletter boilerplate.
for (const t of ["What's the latest email from Google?", 'show me the last email from Swiggy', 'most recent mail from HDFC', 'newest message from Amazon']) assert.equal(wantsSingleLatestEmail(t), true, t)
for (const t of ['show my latest emails', 'find emails from Google', 'last 5 emails from Amazon', 'read my inbox']) assert.equal(wantsSingleLatestEmail(t), false, t)
assert.equal(formatEmailDateIST('Thu, 08 Oct 2026 08:44:39 -0700'), 'Thu 8 Oct, 9:14 pm')
assert.equal(formatEmailDateIST('not a date'), 'not a date')
assert.equal(formatEmailDateIST(''), '')
assert.equal(cleanEmailSnippet("What's new in Google Play and Android Email not displaying correctly? View it online Google Play logo September"), "What's new in Google Play and Android Google Play logo September")
assert.equal(cleanEmailSnippet('a'.repeat(300)).length, 200)
const brain = readFileSync('lib/agent/same-brain.ts', 'utf8')
assert.ok(brain.includes('wantsSingleLatestEmail(text)') && brain.includes('Your latest matching email') && brain.includes('formatEmailDateIST(m.date)'))
// 3. "Find my Amsterdam flight ticket" sent the saved Mirzapur movie ticket (and pushed it to WhatsApp from the
//    dashboard). Travel tickets are not event credentials; a named ticket with no match returns nothing; the
//    dashboard never pushes a WhatsApp message for a dashboard request.
const bcCode = ts.transpileModule(readFileSync('lib/agent/booking-closure.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const events = [{ id: 'm1', title: 'Mirzapur: The Movie (A)', subtype: 'movie_booking', provider: 'District', start_at: '2026-10-20T13:00:00Z', location: 'PVR', metadata_json: { credential: { storagePath: 'x/qr.png', mimeType: 'image/png' } } }]
const q: any = { select: () => q, eq: () => q, order: () => q, limit: async () => ({ data: events, error: null }) }
const bc: any = {}
runInNewContext(bcCode, { exports: bc, module: { exports: bc }, console, Date, URL, String, Number, Boolean, Array, Object, JSON, Math, process: { env: {} },
  require: (n: string) => n === '@/lib/supabase-admin' ? { supabaseAdmin: { from: () => q } } : n === '@/lib/services/document-store' ? { getDocumentSignedUrl: async () => 'https://signed.example/qr.png' } : n === '@anthropic-ai/sdk' ? { default: function () {} } : {} })
for (const t of ['Find my Amsterdam flight ticket', 'show my boarding pass', 'send my train ticket', 'get my PNR ticket']) assert.equal(bc.isEventCredentialRetrieval(t), false, t)
for (const t of ['show my movie ticket', 'send my ticket', 'find the Mirzapur ticket']) assert.equal(bc.isEventCredentialRetrieval(t), true, t)
assert.equal(await bc.retrieveEventCredential(42, 'find my Coldplay ticket'), null, 'a named ticket that is not saved returns nothing')
assert.equal((await bc.retrieveEventCredential(42, 'find the Mirzapur ticket'))?.title, 'Mirzapur: The Movie (A)')
assert.equal((await bc.retrieveEventCredential(42, 'show my movie ticket'))?.title, 'Mirzapur: The Movie (A)', 'an unnamed request still gets the saved ticket')
const fi = readFileSync('lib/feature-intents.ts', 'utf8')
assert.ok(fi.indexOf("extra?.surface === 'web'") > 0 && fi.indexOf("extra?.surface === 'web'") < fi.indexOf('sendWhatsAppMediaMessage(phone, ticket.caption'), 'dashboard requests return the ticket instead of pushing WhatsApp')
assert.ok(readFileSync('app/api/dashboard/chat/route.ts', 'utf8').includes("surface: 'web',"))
console.log('verify-dashboard-usecases-oct15: ok')
