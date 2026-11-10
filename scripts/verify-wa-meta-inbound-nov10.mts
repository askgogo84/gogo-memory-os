// Meta inbound webhook for the consumer number: signature, handshake, parsing, and the bridge into the existing pipeline.
// Offline: fixtures only.
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { metaHandshakeChallenge, parseMetaWebhook, pipelineParams, verifyMetaSignature } from '../lib/channels/whatsapp-provider/meta-inbound.ts'
import { candidateWebhookUrls, computeTwilioSignature, evaluateTwilioSignature, parseTwilioSignatureParams } from '../lib/security/webhook-signature.ts'

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const PHONE_ID = '123456789012345'
const wamid = (n: number) => `wamid.HBgMOTE5OTAwMDAwMDAy${String(n).padStart(4, '0')}`
const envelope = (value: any, phoneId = PHONE_ID) => ({ object: 'whatsapp_business_account', entry: [{ id: 'WABA', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '15550001111', phone_number_id: phoneId }, ...value } }] }] })
const contact = [{ wa_id: '919900000002', profile: { name: 'Divya' } }]

// 1. Signature: fails closed.
const raw = JSON.stringify(envelope({ contacts: contact, messages: [{ from: '919900000002', id: wamid(1), timestamp: '1', type: 'text', text: { body: 'remind me to call Nithin at 5' } }] }))
const sign = (body: string, secret: string) => 'sha256=' + createHmac('sha256', secret).update(body, 'utf8').digest('hex')
ok(verifyMetaSignature(raw, sign(raw, 'app-secret'), 'app-secret'), 'a correct signature is accepted')
ok(verifyMetaSignature(raw, sign(raw, 'app-secret').toUpperCase().replace('SHA256=', 'sha256='), 'app-secret'), 'hex case does not matter')
ok(!verifyMetaSignature(raw + ' ', sign(raw, 'app-secret'), 'app-secret'), 'a changed body is rejected')
ok(!verifyMetaSignature(raw, sign(raw, 'other-secret'), 'app-secret'), 'a different secret is rejected')
ok(!verifyMetaSignature(raw, null, 'app-secret') && !verifyMetaSignature(raw, '', 'app-secret'), 'a missing header is rejected')
ok(!verifyMetaSignature(raw, sign(raw, ''), '') && !verifyMetaSignature(raw, sign(raw, 'x'), undefined), 'a missing secret rejects everything')
ok(!verifyMetaSignature(raw, 'sha1=' + 'a'.repeat(40), 'app-secret') && !verifyMetaSignature(raw, 'sha256=zz', 'app-secret'), 'a malformed header is rejected')

// 2. Handshake.
const q = (o: Record<string, string>) => new URLSearchParams(o)
eq(metaHandshakeChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': '4242' }), 'tok'), '4242', 'handshake echoes the challenge')
eq(metaHandshakeChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': 'nope', 'hub.challenge': '4242' }), 'tok'), null, 'wrong token')
eq(metaHandshakeChallenge(q({ 'hub.mode': 'subscribe', 'hub.verify_token': '', 'hub.challenge': '4242' }), ''), null, 'no configured token means no handshake')
eq(metaHandshakeChallenge(q({ 'hub.mode': 'unsubscribe', 'hub.verify_token': 'tok', 'hub.challenge': '4242' }), 'tok'), null, 'wrong mode')

// 3. Parsing.
const parsed = parseMetaWebhook(JSON.parse(raw), PHONE_ID)
eq(parsed.messages.length, 1, 'one text message')
eq(pipelineParams(parsed.messages[0]), { From: 'whatsapp:+919900000002', To: 'whatsapp:+15550001111', WaId: '919900000002', MessageSid: wamid(1), SmsMessageSid: wamid(1), ProfileName: 'Divya', NumMedia: '0', Body: 'remind me to call Nithin at 5' }, 'text maps to the pipeline fields')
eq(parseMetaWebhook(JSON.parse(raw), '999999999999999').messages.length, 0, 'a message for another phone number id is ignored')
eq(parseMetaWebhook(JSON.parse(raw), undefined).messages.length, 0, 'no configured phone id means nothing is handled')
eq(parseMetaWebhook({ object: 'page', entry: JSON.parse(raw).entry }, PHONE_ID).messages.length, 0, 'a non-WhatsApp object is ignored')
const many = parseMetaWebhook(envelope({ contacts: contact, messages: [
  { from: '919900000002', id: wamid(2), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'approve', title: 'Approve' } }, context: { id: wamid(1) } },
  { from: '919900000002', id: wamid(3), type: 'button', button: { text: 'Done', payload: 'done' } },
  { from: '919900000002', id: wamid(4), type: 'interactive', interactive: { type: 'list_reply', list_reply: { id: 'morning', title: 'Morning' } } },
  { from: '919900000002', id: wamid(5), type: 'audio', audio: { id: 'MEDIA1', mime_type: 'audio/ogg' } },
  { from: '919900000002', id: wamid(6), type: 'reaction', reaction: { emoji: '👍' } },
  { from: '919900000002', id: 'SM-not-a-wamid', type: 'text', text: { body: 'x' } },
  { from: '12', id: wamid(7), type: 'text', text: { body: 'x' } },
  { from: '919900000002', id: wamid(8), type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'transfer_all', title: 'Yes' } } },
] }), PHONE_ID)
eq(many.messages.map(m => m.kind), ['button', 'button', 'list', 'media', 'button'], 'kinds in order; reaction and malformed entries are dropped')
eq(many.ignored, 3, 'three entries ignored')
const approve = pipelineParams(many.messages[0])
eq([approve.Body, approve.ButtonText, approve.ButtonPayload, approve.OriginalRepliedMessageSid], ['Approve', 'Approve', undefined, wamid(1)], 'an ordinary button behaves like its typed title and keeps the quoted message')
eq(pipelineParams(many.messages[1]).ButtonPayload, 'done', 'a reminder tap keeps its payload')
eq(pipelineParams(many.messages[4]).ButtonPayload, undefined, 'an unknown button id never becomes a payload')
const listParams = pipelineParams(many.messages[2])
eq([listParams.Body, listParams.ListId, listParams.ListTitle], ['Morning', 'morning', 'Morning'], 'list reply fields')
assert.throws(() => pipelineParams(many.messages[3]), /media_not_bridged/); checks++
const statuses = parseMetaWebhook(envelope({ statuses: [{ id: wamid(9), status: 'delivered' }, { id: wamid(9), status: 'failed', errors: [{ code: 131047 }] }, { id: wamid(9), status: 'deleted' }, { id: 'SMx', status: 'read' }] }), PHONE_ID)
eq(statuses.statuses, [{ id: wamid(9), status: 'delivered', errorCode: '' }, { id: wamid(9), status: 'failed', errorCode: '131047' }], 'known statuses only, with the error code as text')
ok(parsed.messages.every(m => typeof m.from === 'string') && /^\d+$/.test(parsed.messages[0].from), 'sender ids stay strings')

// 4. The bridge signature is exactly what the existing pipeline's gate verifies.
const url = 'https://app.askgogo.in/api/webhooks/whatsapp'
const params = pipelineParams(parsed.messages[0])
const form = new FormData(); for (const [k, v] of Object.entries(params)) form.append(k, v)
eq({ ...parseTwilioSignatureParams(form) }, params, 'the bridged fields survive the pipeline form parser unchanged (no duplicate keys)')
const verdict = evaluateTwilioSignature({ authToken: 'pipeline-secret', signature: computeTwilioSignature('pipeline-secret', url, params), candidateUrls: candidateWebhookUrls(url, new Headers({ host: 'app.askgogo.in' }), {}), params })
eq(verdict.outcome, 'valid', 'the pipeline gate accepts the bridged request')
eq(evaluateTwilioSignature({ authToken: 'pipeline-secret', signature: computeTwilioSignature('pipeline-secret', url, { ...params, From: 'whatsapp:+919900000009' }), candidateUrls: candidateWebhookUrls(url, new Headers({ host: 'app.askgogo.in' }), {}), params }).outcome, 'invalid', 'a changed sender fails the pipeline gate')

// 5. Route: order of checks and what it never does.
const route = readFileSync(new URL('../app/api/webhooks/whatsapp-meta/route.ts', import.meta.url), 'utf8')
const post = route.slice(route.indexOf('export async function POST'))
ok(post.indexOf('verifyMetaSignature(') > 0 && post.indexOf('verifyMetaSignature(') < post.indexOf('JSON.parse(raw)'), 'the signature is checked before the body is parsed')
ok(/if \(!verifyMetaSignature\(raw, req\.headers\.get\('x-hub-signature-256'\), process\.env\.GOGO_META_WA_APP_SECRET\)\) return new NextResponse\('Forbidden', \{ status: 403 \}\)/.test(post), 'a bad signature is a 403 with no other effect')
ok(/parseMetaWebhook\(body, process\.env\.GOGO_META_WA_PHONE_ID\)/.test(post), 'only our phone number id is handled')
ok(/waProviderFor\(m\.from\) !== 'meta'[\s\S]{0,160}continue/.test(post), 'a sender whose replies would leave through Twilio is not handled here')
ok(/status < 200 \|\| status >= 300[\s\S]{0,200}status: 500/.test(post), 'a pipeline failure asks Meta to redeliver')
ok(!/console\.(?:log|error)\([^\n]*(?:m\.text|params\b|m\.profileName|raw\b)/.test(route), 'no message text, name or raw body is logged')
ok(!/supabaseAdmin|processIncomingMessage|sendWhatsAppMessage/.test(route), 'the route does not run the assistant itself; the existing pipeline does')
const exportsFound = [...route.matchAll(/^export (?:async function|const) (\w+)/gm)].map(m => m[1]).sort()
eq(exportsFound, ['GET', 'POST', 'dynamic', 'maxDuration'], 'only route exports')
const pipeline = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
ok(/auditInboundTwilioSignature\(\{/.test(pipeline) && !/whatsapp-meta|GOGO_META/.test(pipeline), 'the existing pipeline and its signature gate are untouched')

console.log(`WA_META_INBOUND_OK ${checks} checks`)
