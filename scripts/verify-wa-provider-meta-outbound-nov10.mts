// WhatsApp provider layer (Twilio default, Meta Cloud API behind a switch). Offline: fake fetch only, no network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isMetaMessageId, metaPilotNumbers, metaWaConfigured, waDigits, waProviderFor } from '../lib/channels/whatsapp-provider/provider.ts'
import { MetaSendError, metaButtonsPayload, metaGraphBase, metaListPayload, metaMediaKind, metaMediaPayload, metaSend, metaTemplatePayload, metaTextPayload, metaTypingPayload } from '../lib/channels/whatsapp-provider/meta.ts'

let checks = 0
const ok = (cond: unknown, msg: string) => { assert.ok(cond, msg); checks++ }
const eq = (a: unknown, b: unknown, msg: string) => { assert.deepEqual(a, b, msg); checks++ }
const creds = { GOGO_META_WA_TOKEN: 'fixture-token', GOGO_META_WA_PHONE_ID: '123456789012345' }

// 1. Provider choice: Twilio unless Meta is configured AND selected.
eq(waProviderFor('whatsapp:+919900000001', {}), 'twilio', 'nothing set means Twilio')
eq(waProviderFor('+919900000001', { GOGO_WA_PROVIDER: 'meta' }), 'twilio', 'the switch alone, without credentials, stays on Twilio')
eq(waProviderFor('+919900000001', { ...creds }), 'twilio', 'credentials alone, without the switch, stay on Twilio')
eq(waProviderFor('+919900000001', { ...creds, GOGO_WA_PROVIDER: 'meta' }), 'meta', 'switch plus credentials selects Meta')
eq(waProviderFor('+919900000001', { ...creds, GOGO_WA_PROVIDER: ' META ' }), 'meta', 'the switch is trimmed and case-insensitive')
eq(waProviderFor('+919900000001', { ...creds, GOGO_WA_PROVIDER: 'on' }), 'twilio', 'an unknown switch value stays on Twilio')
const pilot = { ...creds, GOGO_WA_META_NUMBERS: '+91 99000 00002, whatsapp:+919900000003' }
eq(waProviderFor('whatsapp:+919900000002', pilot), 'meta', 'a pilot number goes to Meta')
eq(waProviderFor('+919900000003', pilot), 'meta', 'pilot entries accept the whatsapp: prefix')
eq(waProviderFor('+919900000001', pilot), 'twilio', 'a number off the pilot list stays on Twilio')
eq(waProviderFor('+9199000000021', pilot), 'twilio', 'a longer number that only starts like a pilot number does not match')
eq(waProviderFor('+19900000002', pilot), 'twilio', 'a number that only ends like a pilot number does not match')
eq(waProviderFor('', pilot), 'twilio', 'an empty recipient never matches the pilot list')
eq(metaPilotNumbers({ GOGO_WA_META_NUMBERS: '12, ,abc,+919900000002' }), ['919900000002'], 'malformed pilot entries are dropped')
ok(!metaWaConfigured({ GOGO_META_WA_TOKEN: 'x', GOGO_META_WA_PHONE_ID: 'not-a-number' }), 'a non-numeric phone id is not a configuration')
eq(waDigits('whatsapp:+91 99000-00002'), '919900000002', 'digits are taken as a string')
ok(typeof waDigits('+919900000002') === 'string', 'a phone number is never a JavaScript number')
ok(isMetaMessageId('wamid.HBgMOTE5OTAwMDAwMDAyFQIAEhgg') && !isMetaMessageId('SM0123456789abcdef0123456789abcdef') && !isMetaMessageId(''), 'Meta ids and Twilio SIDs are told apart')

// 2. Payloads.
const text = metaTextPayload('whatsapp:+919900000002', 'Hello Divya', 'wamid.ABCDEFGH12345')
eq(text.to, '919900000002', 'recipient is digits only')
eq(text.context, { message_id: 'wamid.ABCDEFGH12345' }, 'a quoted reply carries the message id')
eq(text.text.preview_url, false, 'no link, no preview')
ok(metaTextPayload('+919900000002', 'see https://askgogo.in').text.preview_url, 'a link turns the preview on')
eq(metaTextPayload('+919900000002', 'x'.repeat(5000)).text.body.length, 4096, 'text is capped at the Cloud API limit')
assert.throws(() => metaTextPayload('abc', 'hi'), /Invalid WhatsApp phone number/); checks++
eq(metaMediaKind('https://x.example/a.PNG'), 'image', 'extension decides the kind')
eq(metaMediaKind('https://x.example/voice.ogg'), 'audio', 'voice note extension')
eq(metaMediaKind('https://x.example/file'), 'document', 'unknown content goes as a document')
eq(metaMediaKind('https://x.example/file', 'image/jpeg'), 'image', 'a content type wins over the extension')
eq(metaMediaKind('https://x.example/a.png', 'application/pdf'), 'document', 'a PDF content type is a document')
const media = metaMediaPayload('+919900000002', 'https://x.example/card.png', 'c'.repeat(2000)) as any
eq(media.type, 'image', 'media payload type'); eq(media.image.caption.length, 1024, 'caption is capped')
ok(!('caption' in (metaMediaPayload('+919900000002', 'https://x.example/a.mp3', 'note') as any).audio), 'audio carries no caption')
assert.throws(() => metaMediaPayload('+919900000002', 'http://x.example/a.png'), /https/); checks++
const buttons = metaButtonsPayload('+919900000002', 'Pick', [{ id: 'a', title: 'One' }, { id: 'b', title: 'Two' }, { id: 'c', title: 'Three' }, { id: 'd', title: 'Four' }])
eq(buttons.interactive.action.buttons.length, 3, 'at most three buttons')
eq(buttons.interactive.action.buttons[0].reply, { id: 'a', title: 'One' }, 'button id and title')
const list = metaListPayload('+919900000002', 'When?', 'Choose time', Array.from({ length: 12 }, (_, i) => ({ id: `r${i}`, title: `Row ${i}`, description: 'd' })))
eq(list.interactive.action.sections[0].rows.length, 10, 'at most ten rows')
const tpl = metaTemplatePayload('+919900000002', 'gogo_reminder_buttons_v1', { bodyParams: ['Call Nithin'], quickReplyPayloads: ['done', 'snooze_10', 'move_8pm'] })
eq(tpl.template.components[0], { type: 'body', parameters: [{ type: 'text', text: 'Call Nithin' }] }, 'template body variable')
eq(tpl.template.components.slice(1).map((c: any) => c.parameters[0].payload), ['done', 'snooze_10', 'move_8pm'], 'reminder taps keep the payloads the inbound handler knows')
assert.throws(() => metaTemplatePayload('+919900000002', 'Bad Name'), /Invalid Meta template name/); checks++
eq(metaTypingPayload('wamid.ABCDEFGH12345'), { messaging_product: 'whatsapp', status: 'read', message_id: 'wamid.ABCDEFGH12345', typing_indicator: { type: 'text' } }, 'read receipt plus typing')
eq(metaGraphBase({}), 'https://graph.facebook.com/v21.0', 'default Graph version')
eq(metaGraphBase({ GOGO_META_GRAPH_VERSION: 'v99.0/../x' }), 'https://graph.facebook.com/v21.0', 'a malformed version cannot change the URL')

// 3. Sender: one POST to the phone id, bearer token in the header only, Meta's id comes back as sid.
const calls: { url: string; init: any }[] = []
const fakeFetch = (status: number, body: unknown) => (async (url: any, init: any) => { calls.push({ url: String(url), init }); return new Response(JSON.stringify(body), { status }) }) as typeof fetch
const sent = await metaSend(text, { env: creds, fetchImpl: fakeFetch(200, { messages: [{ id: 'wamid.SENT12345678' }] }) })
eq(sent, { sid: 'wamid.SENT12345678', status: 'accepted' }, 'accepted send returns the Meta id')
eq(calls[0].url, 'https://graph.facebook.com/v21.0/123456789012345/messages', 'posts to the configured phone id')
eq(calls[0].init.headers.Authorization, 'Bearer fixture-token', 'token travels in the Authorization header')
ok(!calls[0].url.includes('fixture-token') && !String(calls[0].init.body).includes('fixture-token'), 'token is never in the URL or the body')
await assert.rejects(metaSend(text, { env: creds, fetchImpl: fakeFetch(400, { error: { message: 'Re-engagement message', code: 131047 } }) }), (e: any) => e instanceof MetaSendError && e.status === 400 && e.code === 131047); checks++
await assert.rejects(metaSend(text, { env: creds, fetchImpl: fakeFetch(200, {}) }), /meta_no_message_id/); checks++
await assert.rejects(metaSend(text, { env: {}, fetchImpl: fakeFetch(200, {}) }), /meta_not_configured/); checks++
eq((await metaSend(metaTypingPayload('wamid.ABCDEFGH12345'), { env: creds, fetchImpl: fakeFetch(200, { success: true }) })).sid, '', 'a read receipt has no message id and is not an error')

// 4. lib/whatsapp.ts: every send function asks the provider first; Twilio code is still there; no secret is logged.
const src = readFileSync(new URL('../lib/whatsapp.ts', import.meta.url), 'utf8')
for (const fn of ['sendWhatsApp', 'sendWhatsAppReminderTemplate', 'sendWhatsAppReminderButtons', 'sendWhatsAppCalendarApprovalButtons', 'sendWhatsAppChoice', 'sendWhatsAppAuthOtp', 'sendWhatsAppAccessGranted']) {
  const at = src.indexOf(`export async function ${fn}(`)
  const body = src.slice(at, src.indexOf('\nexport ', at + 10) > 0 ? src.indexOf('\nexport ', at + 10) : undefined)
  ok(at >= 0 && /waProviderFor\((?:to|toNumber)\) === 'meta'/.test(body), `${fn} has a Meta branch`)
  ok(/meteredCreate\(/.test(body), `${fn} keeps its Twilio path`)
}
ok(/maskOutboundIdentifiers\(text \|\| ''\)\)\)\n  qaTraceReply[\s\S]{0,120}if \(waProviderFor\(to\) === 'meta'\)/.test(src), 'the outbound leak filter and sanitizer run before the Meta branch')
ok((src.match(/persistAcceptedChunk\(message\.sid, deliveryToken/g) || []).length >= 6, 'Meta sends record the accepted message for delivery tracking, like Twilio')
ok(!/console\.(?:log|error)\([^)]*GOGO_META_WA_TOKEN/.test(src) && !/console\.(?:log|error)\([^)]*GOGO_META_WA_TOKEN/.test(readFileSync(new URL('../lib/channels/whatsapp-provider/meta.ts', import.meta.url), 'utf8')), 'the Meta token is never logged')

console.log(`WA_PROVIDER_META_OUTBOUND_OK ${checks} checks`)
