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
  { from: '919900000002', id: wamid(5), type: 'audio', audio: { id: '1234567890123', mime_type: 'audio/ogg; codecs=opus' } },
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
const voice = pipelineParams(many.messages[3])
eq([voice.NumMedia, voice.MediaUrl0, voice.MediaContentType0, voice.Body], ['1', 'meta-media://1234567890123', 'audio/ogg', ''], 'a voice note travels as a media reference with its bare content type')
const mediaCases = parseMetaWebhook(envelope({ contacts: contact, messages: [
  { from: '919900000002', id: wamid(20), type: 'image', image: { id: '5550001112223', mime_type: 'image/jpeg', caption: 'save this bill' } },
  { from: '919900000002', id: wamid(21), type: 'document', document: { id: '5550001112224', mime_type: 'application/pdf', filename: 'ticket.pdf' } },
  { from: '919900000002', id: wamid(22), type: 'image', image: { id: 'https://evil.example/x', mime_type: 'image/jpeg' } },
  { from: '919900000002', id: wamid(23), type: 'image', image: { id: '5550001112225', mime_type: 'image/jpeg\r\nX: y' } },
  { from: '919900000002', id: wamid(24), type: 'sticker', sticker: { id: '5550001112226', mime_type: 'image/webp' } },
] }), PHONE_ID)
eq(mediaCases.messages.map(m => [m.mediaType, m.mediaId, m.text]), [['image', '5550001112223', 'save this bill'], ['document', '5550001112224', '']], 'photo with caption and PDF are carried; a non-numeric media id, a malformed type and a sticker are dropped')
ok(Object.values(pipelineParams(mediaCases.messages[0])).every(v => !/https?:/.test(v)), 'no URL from the webhook body is ever passed on as a media location')
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
ok(!/supabaseAdmin|processIncomingMessage|sendWhatsAppMessage|metaSend|fetchMetaMedia/.test(route), 'the route does not run the assistant, send, or download media itself; the existing pipeline does')
const exportsFound = [...route.matchAll(/^export (?:async function|const) (\w+)/gm)].map(m => m[1]).sort()
eq(exportsFound, ['GET', 'POST', 'dynamic', 'maxDuration'], 'only route exports')
const pipeline = readFileSync(new URL('../app/api/webhooks/whatsapp/route.ts', import.meta.url), 'utf8')
ok(/auditInboundTwilioSignature\(\{/.test(pipeline) && !/whatsapp-meta|GOGO_META/.test(pipeline), 'the existing pipeline and its signature gate are untouched')

// 6. Sender identity is validated, not normalised (independent review, finding 3).
const fromCase = (from: unknown) => parseMetaWebhook(envelope({ messages: [{ from, id: wamid(30), type: 'text', text: { body: 'x' } }] }), PHONE_ID).messages.length
eq(fromCase('919900000002'), 1, 'a plain digit string is a sender')
for (const bad of ['+91 99000-00002', 'IN.919900000002', 'abc9199x0000y0002', 919900000002, ['91990', '0000002'], { toString: () => '919900000002' }, '1234567', '1234567890123456', null])
  eq(fromCase(bad), 0, `not a sender id: ${JSON.stringify(bad)}`)
eq(parseMetaWebhook(envelope({ messages: [{ from: '919900000002', id: wamid(31), type: 'text', text: { body: 'x' } }] }, 123456789012345 as any), PHONE_ID).messages.length, 0, 'a numeric phone number id never matches the configured string')

// 7. The handler itself, run with a stubbed network (independent review, findings 1, 2, 7 and 10).
const { NextRequest } = await import('next/server')
const handler = await import('../app/api/webhooks/whatsapp-meta/route.ts')
const SAVED = { ...process.env }, realFetch = globalThis.fetch
const setEnv = (o: Record<string, string | undefined>) => { for (const k of Object.keys(process.env)) if (/^(?:GOGO_|TWILIO_)/.test(k)) delete process.env[k]; for (const [k, v] of Object.entries(o)) if (v !== undefined) process.env[k] = v }
const deliver = (body: string, secret: string | null, reqUrl = 'https://app.askgogo.in/api/webhooks/whatsapp-meta') => handler.POST(new NextRequest(reqUrl, { method: 'POST', body, headers: secret === null ? {} : { 'x-hub-signature-256': sign(body, secret) } }))
const net: { url: string; body: string; signature: string; redirect: string }[] = []
let pipelineStatus = 200
globalThis.fetch = (async (u: any, init: any) => { net.push({ url: String(u), body: String(init?.body || ''), signature: String(init?.headers?.['X-Twilio-Signature'] || ''), redirect: String(init?.redirect || '') }); return new Response('<Response></Response>', { status: pipelineStatus }) }) as typeof fetch
const PIPE = 'https://app.askgogo.in/api/webhooks/whatsapp'
const LIVE = { GOGO_META_WA_APP_SECRET: 'app-secret', GOGO_META_WA_PHONE_ID: PHONE_ID, GOGO_META_WA_TOKEN: 'fixture-token', GOGO_WA_META_NUMBERS: '+919900000002', TWILIO_AUTH_TOKEN: 'pipeline-secret', TWILIO_WHATSAPP_WEBHOOK_URL: PIPE }
try {
  setEnv({})
  eq((await deliver(raw, 'app-secret')).status, 403, 'off: a signed-looking POST is 403')
  eq((await deliver('', null)).status, 403, 'off: an empty POST is 403')
  eq((await handler.GET(new NextRequest('https://app.askgogo.in/api/webhooks/whatsapp-meta?hub.mode=subscribe&hub.verify_token=&hub.challenge=1'))).status, 403, 'off: the handshake is 403')
  eq(net.length, 0, 'off: nothing leaves the route')

  setEnv(LIVE)
  eq((await deliver(raw, 'wrong-secret')).status, 403, 'a wrong signature is 403'); eq(net.length, 0, 'and nothing is forwarded')
  eq((await deliver(raw, 'app-secret')).status, 200, 'a signed text message is accepted')
  eq(net.length, 1, 'one forward to the pipeline')
  eq([net[0].url, net[0].redirect], [PIPE, 'error'], 'to the configured pipeline URL, redirects refused')
  const forwarded = Object.fromEntries(new URLSearchParams(net[0].body))
  eq([forwarded.From, forwarded.Body, forwarded.MessageSid], ['whatsapp:+919900000002', 'remind me to call Nithin at 5', wamid(1)], 'the pipeline receives the sender, text and message id')
  eq(net[0].signature, computeTwilioSignature('pipeline-secret', PIPE, forwarded), 'signed for exactly that URL and those fields')

  net.length = 0
  eq((await deliver(raw, 'app-secret', 'https://evil.example/api/webhooks/whatsapp-meta')).status, 200, 'a request carrying another Host is still handled')
  eq(net.map(c => c.url), [PIPE], 'but the message only ever goes to the configured pipeline URL')

  for (const bad of [undefined, 'http://app.askgogo.in/api/webhooks/whatsapp', 'https://app.askgogo.in/api/other', 'https://app.askgogo.in/api/webhooks/whatsapp?x=1', 'not a url']) {
    net.length = 0; setEnv({ ...LIVE, TWILIO_WHATSAPP_WEBHOOK_URL: bad })
    eq([(await deliver(raw, 'app-secret')).status, net.length], [503, 0], `no usable pipeline URL (${String(bad)}): 503 and nothing sent`)
  }
  net.length = 0; setEnv({ ...LIVE, TWILIO_WHATSAPP_WEBHOOK_URL: undefined, GOGO_WA_PIPELINE_URL: PIPE })
  eq([(await deliver(raw, 'app-secret')).status, net.map(c => c.url)], [200, [PIPE]], 'GOGO_WA_PIPELINE_URL also configures the pipeline')

  // A media message is forwarded like any other (the pipeline applies its own gates and drops duplicates); the route sends nothing itself.
  setEnv(LIVE); net.length = 0
  const photo = JSON.stringify(envelope({ contacts: contact, messages: [{ from: '919900000002', id: wamid(40), type: 'image', image: { id: '5550001112223', mime_type: 'image/jpeg' } }] }))
  for (let i = 0; i < 3; i++) eq((await deliver(photo, 'app-secret')).status, 200, `photo delivery ${i + 1} accepted`)
  eq(net.filter(c => /graph\.facebook\.com/.test(c.url)).length, 0, 'three deliveries of one photo cause no Meta send from the route')
  ok(net.length === 3 && net.every(c => c.url === PIPE && new URLSearchParams(c.body).get('MediaUrl0') === 'meta-media://5550001112223'), 'each is handed to the pipeline, which drops duplicates by message id')

  net.length = 0; pipelineStatus = 503
  eq((await deliver(raw, 'app-secret')).status, 500, 'a pipeline failure is a 500 so Meta redelivers'); pipelineStatus = 200

  net.length = 0; setEnv({ ...LIVE, GOGO_WA_META_NUMBERS: '+919900000099' })
  eq([(await deliver(raw, 'app-secret')).status, net.length], [200, 0], 'a sender who is not served by Meta is not forwarded')
  net.length = 0; setEnv({ ...LIVE, TWILIO_AUTH_TOKEN: undefined })
  eq([(await deliver(raw, 'app-secret')).status, net.length], [503, 0], 'no pipeline secret: 503 and nothing sent')
} finally { globalThis.fetch = realFetch; for (const k of Object.keys(process.env)) delete process.env[k]; Object.assign(process.env, SAVED) }

console.log(`WA_META_INBOUND_OK ${checks} checks`)
