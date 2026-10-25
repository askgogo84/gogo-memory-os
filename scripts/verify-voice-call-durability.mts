// Actual voice adapters with inert persistence/phone provider. Never places a real call.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as crypto from 'node:crypto'
import * as execution from '../lib/agent/voice-call-execution'
const now = new Date('2026-10-21T18:00:00Z')
const plan = () => ({ venue: 'Fixture restaurant', to: '+919999999999', source: 'fixture', guestName: 'Fixture', partySize: 2,
  date: '2026-10-22', dateLabel: 'tomorrow', timeLabel: '8:00 pm', flexWindow: '7:30–9pm', seating: 'no preference',
  purpose: 'Book a table for 2', test: false, redials: 0, createdAt: now.toISOString(), startClock: '20:00' })
function fakeDb() {
  const rows: any[] = [], conversations: any[] = []
  const other: any = { users: [{telegram_id:123,whatsapp_id:'+919999999999'}], reminders: [], life_events: [] }
  let failInsert = false, failUpdates = false, conflict = 'id', ignoreDuplicates = false, failReminder = false
  const db = { from(table: string) {
    let op = 'read', value: any; const filters: Array<(r: any) => boolean> = []
    const field = (r: any, key: string) => key.split(/->>?/).reduce((v, k) => v?.[k], r)
    const result = () => {
      const data = (table === 'conversations' ? conversations : table === 'agent_runs' ? rows : other[table] || []).filter(r => filters.every(f => f(r)))
      if (op === 'insert') {
        if (failInsert) return { data: null, error: { code: 'db_unavailable' } }
        const target = table === 'conversations' ? conversations : table === 'agent_runs' ? rows : other[table]
        if (value.id && target.some((r:any) => r.id === value.id)) return { data: null, error: { code: '23505' } }
        target.push(structuredClone(value)); return { data: [value], error: null }
      }
      if (op === 'upsert') {
        if (table === 'reminders' && failReminder) return {data:null,error:{code:'reminder_failure'}}
        const target = table === 'agent_runs' ? rows : other[table]
        const keys = conflict.split(',')
        const existing = target.find((r:any) => keys.every(k => r[k] === value[k]))
        if (!existing) target.push(structuredClone(value)); else if (!ignoreDuplicates) Object.assign(existing,structuredClone(value))
        return {data:[existing || value],error:null}
      }
      if (op === 'update') {
        if (failUpdates) return { data: null, error: { code: 'db_unavailable' } }
        data.forEach(r => Object.assign(r, structuredClone(value)))
      }
      return { data, error: null }
    }
    const q: any = { select: () => q, upsert:(v:any,opts:any={})=>{op='upsert';value=v;conflict=opts.onConflict || 'id';ignoreDuplicates=!!opts.ignoreDuplicates;return q}, insert: (v: any) => { op = 'insert'; value = v; return q }, update: (v: any) => { op = 'update'; value = v; return q },
      eq: (key: string, v: any) => { filters.push(r => String(field(r, key)) === String(v)); return q },
      order: () => q, limit: () => q, is: (key:string, value:any) => { filters.push(r => (field(r,key) ?? null) === value); return q },
      maybeSingle: async () => { const r = result(); return { ...r, data: r.data?.[0] || null } },
      then: (a: any, b: any) => Promise.resolve(result()).then(a, b) }
    return q
  } }
  return { db, rows, conversations, other, setFailReminder:()=>{failReminder=true}, setFailInsert: () => { failInsert = true }, setFailUpdates: () => { failUpdates = true } }
}
function setup() {
  const h = fakeDb(), p = plan(); let calls = 0
  const params = { owner: '123', plan: p, approvedPlanHash: execution.voicePlanHash('123', p), shownText: 'exact card', expectedText: 'exact card', surface: 'web' as const, db: h.db, now,
    place: async () => { calls++; assert.equal(h.rows[0].metadata_json.call_state, 'submitting', 'intent persisted before external effect'); return 'inert-execution' } }
  return { ...h, p, params, calls: () => calls }
}
let failed = 0
async function check(name: string, work: () => Promise<void>) { try { await work(); console.log('PASS ' + name) } catch (e: any) { failed++; console.error('FAIL ' + name + ': ' + e.message) } }
await check('duplicate/racing approvals create exactly one durable provider attempt', async () => {
  const h = setup(); const results = await Promise.all([execution.beginApprovedVoiceCall(h.params), execution.beginApprovedVoiceCall(h.params)])
  assert.equal(h.calls(), 1); assert.equal(h.rows.length, 1)
  assert.deepEqual(results.map(r => r.status).sort(), ['blocked','started'])
  assert.equal(h.rows[0].metadata_json.execution_id, 'inert-execution')
  assert.equal(h.rows[0].telegram_id, '123')
})
await check('timeout after provider effect is unknown and cannot repeat', async () => {
  const h = setup(); let calls = 0
  const p = { ...h.params, place: async () => { calls++; throw Error('timeout after effect') } }
  assert.equal((await execution.beginApprovedVoiceCall(p)).status, 'outcome_unknown')
  assert.equal(h.rows[0].status, 'outcome_unknown'); assert.equal(h.rows[0].metadata_json.reconciliation_required, true)
  assert.equal((await execution.beginApprovedVoiceCall(p)).status, 'blocked'); assert.equal(calls, 1)
})
await check('intent persistence failure prevents all provider calls', async () => {
  const h = setup(); h.setFailInsert()
  assert.equal((await execution.beginApprovedVoiceCall(h.params)).reason, 'call_intent_persistence_failed'); assert.equal(h.calls(), 0)
})
await check('post-effect persistence failure keeps the pre-call intent and prevents replay', async () => {
  const h = setup(); h.setFailUpdates()
  assert.equal((await execution.beginApprovedVoiceCall(h.params)).status, 'outcome_unknown')
  assert.equal((await execution.beginApprovedVoiceCall(h.params)).reason, 'call_already_attempted'); assert.equal(h.calls(), 1)
})
await check('future/expired timestamps, absent consent and changed target fail closed', async () => {
  for (const change of [ { createdAt: '2026-10-21T18:01:00Z' }, { createdAt: '2026-10-21T17:44:00Z' }, { to: '+918888888888' }, { purpose: 'changed hidden instructions' } ]) {
    const h = setup(); const result = await execution.beginApprovedVoiceCall({ ...h.params, plan: { ...h.p, ...change } })
    assert.equal(result.status, 'blocked'); assert.equal(h.calls(), 0)
  }
  const h = setup()
  assert.equal((await execution.beginApprovedVoiceCall({ ...h.params, approvedPlanHash: '' })).status, 'blocked')
  assert.equal((await execution.beginApprovedVoiceCall({ ...h.params, shownText: 'Other CALL PLAN at another venue' })).status, 'blocked')
  assert.equal(h.calls(), 0)
})
await check('explicit retry cannot redial an unknown/inflight/confirmed previous attempt', async () => {
  for (const status of ['outcome_unknown','running','confirmed']) {
    const h = setup()
    h.rows.push({ id: execution.voiceAttemptId('123', h.p, 0), telegram_id: '123', status: status === 'confirmed' ? 'completed' : status,
      metadata_json: { final_status: 'completed', outcome: { booked: status === 'confirmed' }, reconciliation_required: status === 'outcome_unknown' } })
    h.p.redials = 1
    assert.equal((await execution.beginApprovedVoiceCall(h.params)).reason, 'previous_call_requires_reconciliation'); assert.equal(h.calls(), 0)
  }
})
await check('known definite rejection allows an explicitly requested bounded redial', async () => {
  const h = setup()
  assert.equal((await execution.beginApprovedVoiceCall({ ...h.params, place: async () => { throw Object.assign(Error('provider refused'), { status: 400 }) } })).status, 'rejected')
  h.p.redials = 1
  const result = await execution.beginApprovedVoiceCall({ ...h.params, place: async () => 'retry-execution' })
  assert.equal(result.status, 'started'); assert.equal(h.rows.length, 2)
  assert.equal(h.rows[1].metadata_json.execution_id, 'retry-execution')
})
await check('foreign previous attempt cannot grant redial authority', async () => {
  const h = setup()
  h.rows.push({ id: execution.voiceAttemptId('123', h.p, 0), telegram_id: '999', status: 'failed', metadata_json: { call_state: 'rejected' } })
  h.p.redials = 1
  assert.equal((await execution.beginApprovedVoiceCall(h.params)).status, 'blocked'); assert.equal(h.calls(), 0)
})
await check('actual chat entry cannot call when task persistence fails', async () => {
  const h = fakeDb(), exports: any = {}, p = { ...plan(), createdAt: new Date().toISOString() }
  let providerCalls = 0
  const source = readFileSync(process.env.VOICE_CALL_AUDIT_SOURCE || 'lib/agent/voice-call.ts', 'utf8')
  const mocks: any = {
    'node:crypto': crypto, '@/lib/supabase-admin': { supabaseAdmin: h.db }, './voice-call-execution': execution,
    '@/lib/bot/handlers/followup-state': { getLatestFollowupState: async () => ({ payload: { plan: p, approvalHash: execution.voicePlanHash('123', p) } }), saveFollowupState: async () => {}, clearFollowupState: async () => {} },
  }
  runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, require: (name: string) => { if (!(name in mocks)) throw Error('Unexpected dependency ' + name); return mocks[name] }, console, Date, Intl, URL, AbortSignal,
      process: { env: { BOLNA_API_KEY: 'inert', BOLNA_AGENT_ID: 'inert-agent' } },
      fetch: async () => { providerCalls++; return new Response(JSON.stringify({ execution_id: 'inert' })) } })
  h.conversations.push({ telegram_id: 123, role: 'assistant', content: exports.callPlanText(p) })
  h.setFailInsert()
  const reply = await exports.tryVoiceCall({ actor: { userId: 'fixture', legacyTelegramId: 123, whatsappId: '+919999999999', name: 'Fixture' }, text: 'yes call', surface: 'web' })
  assert.equal(providerCalls, 0, 'no provider effect before durable owner-bound intent')
  assert.doesNotMatch(reply.text, /Calling .* now/)
})
function processHarness(status='completed') {
  const h = fakeDb(), exports:any={}, p={...plan(),test:true,date:new Date(Date.now()+3*86400_000).toISOString().slice(0,10)}
  h.rows.push({id:'call-run',telegram_id:'123',type:'voice_call',status:'running',started_at:new Date().toISOString(),metadata_json:{plan:p,execution_id:'inert-execution'}})
  const mocks:any={'node:crypto':crypto,'@/lib/supabase-admin':{supabaseAdmin:h.db},'./voice-call-execution':execution,'@anthropic-ai/sdk':{__esModule:true,default:class {messages={create:async()=>({content:[{text:JSON.stringify({booked:true,confirmed_time:'8:00 pm',staff_name:'Fixture'})}]})}}}}
  runInNewContext(ts.transpileModule(readFileSync('lib/agent/voice-call.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,
    {exports,require:(name:string)=>{if(!(name in mocks))throw Error('Unexpected '+name);return mocks[name]},console,Date,Intl,URL,AbortSignal,process:{env:{BOLNA_API_KEY:'inert'}},fetch:async()=>new Response(JSON.stringify({status,transcript:'inert transcript'}))})
  return {...h,voice:exports}
}
await check('concurrent terminal pollers report exactly once with an owner-bound result claim',async()=>{
  const h=processHarness();let sends=0
  await Promise.all([h.voice.processVoiceCalls({send:async()=>{sends++}}),h.voice.processVoiceCalls({send:async()=>{sends++}})])
  assert.equal(sends,1);assert.equal(h.conversations.length,1);assert.equal(h.rows[0].status,'completed');assert.ok(h.rows[0].metadata_json.result_claim)
})
await check('interrupted result worker becomes unknown instead of reporting or redialling',async()=>{
  const h=processHarness();h.rows[0].metadata_json.result_claim='crashed';h.rows[0].metadata_json.result_claimed_at='2020-01-01T00:00:00Z';let sends=0
  await h.voice.processVoiceCalls({send:async()=>{sends++}})
  assert.equal(sends,0);assert.equal(h.rows[0].status,'outcome_unknown');assert.equal(h.rows[0].metadata_json.reconciliation_required,true)
})
await check('long-running provider state is uncertain, never falsely not booked',async()=>{
  const h=processHarness('call-disconnected');h.rows[0].started_at='2020-01-01T00:00:00Z';const sent:string[]=[]
  await h.voice.processVoiceCalls({send:async(_to:string,text:string)=>{sent.push(text)}})
  assert.equal(h.rows[0].status,'outcome_unknown');assert.match(sent[0],/couldn't confirm/);assert.doesNotMatch(sent[0],/Nothing was booked/)
})
await check('verified phone result records one booking and deterministic reminder despite duplicate polls',async()=>{
  const h=processHarness();h.rows[0].metadata_json.plan.test=false;let sends=0
  await Promise.all([h.voice.processVoiceCalls({send:async()=>{sends++}}),h.voice.processVoiceCalls({send:async()=>{sends++}})])
  assert.equal(h.other.life_events.length,1);assert.equal(h.other.reminders.length,1);assert.equal(sends,1)
  assert.equal(h.rows[0].metadata_json.reminder_scheduled,true)
})
await check('reminder storage failure never becomes a promised reminder',async()=>{
  const h=processHarness();h.rows[0].metadata_json.plan.test=false;h.setFailReminder();const sent:string[]=[]
  await h.voice.processVoiceCalls({send:async(_to:string,text:string)=>{sent.push(text)}})
  assert.equal(h.other.life_events.length,1);assert.equal(h.other.reminders.length,0)
  assert.equal(h.rows[0].metadata_json.reminder_scheduled,false)
  assert.doesNotMatch(sent[0],/with a reminder 2 hours before/);assert.match(sent[0],/No future 2-hour reminder/)
})
await check('failed call with dialogue cannot claim that nothing was booked or permit blind redial',async()=>{
  const h=processHarness('failed');const sent:string[]=[]
  await h.voice.processVoiceCalls({send:async(_to:string,text:string)=>{sent.push(text)}})
  assert.equal(h.rows[0].status,'outcome_unknown');assert.equal(h.rows[0].metadata_json.reconciliation_required,true)
  assert.doesNotMatch(sent[0],/Nothing was booked/);assert.match(sent[0],/couldn't confirm/)
})

/**
 * P1 WhatsApp voice-note transport: actual function, fake OpenAI, and fully
 * intercepted fetch. No Twilio/OpenAI network, no audio or real accounts.
 */
const VOICE_MEDIA_SID = 'AC' + 'a'.repeat(32)
const VOICE_MEDIA_URL = `https://api.twilio.com/2010-04-01/Accounts/${VOICE_MEDIA_SID}/Messages/SM${'b'.repeat(32)}/Media/ME${'c'.repeat(32)}`
function voiceMediaHarness(transport: (url: string, options?: any) => Promise<Response>) {
  const exports: any = {}
  let providerCalls = 0
  const FakeOpenAI = class {
    audio = { transcriptions: { create: async ({ file }: any) => {
      providerCalls++
      assert.equal(file.name, 'whatsapp-voice.ogg')
      return { text: 'Fixture audio transcription' }
    } } }
  }
  class InertFile {
    constructor(public parts: any[], public name: string, public opts: any) {}
  }
  const source = readFileSync('lib/services/voice-transcription.ts', 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  runInNewContext(compiled, {
    exports,
    require: (name: string) => {
      if (name === 'openai') return { __esModule: true, default: FakeOpenAI }
      throw Error('Unexpected voice media dependency ' + name)
    },
    process: { env: { OPENAI_API_KEY: 'fixture-only', TWILIO_ACCOUNT_SID: VOICE_MEDIA_SID, TWILIO_AUTH_TOKEN: 'fixture-token' } },
    fetch: transport, Buffer, URL, Response, AbortSignal, Uint8Array, ArrayBuffer, File: InertFile, console,
  })
  return { voice: exports, getProviderCalls: () => providerCalls }
}
await check('P1 voice-note: forged media URLs never receive Twilio Basic auth or any server fetch', async () => {
  const attacks = [
    'http://169.254.169.254/latest/meta-data',
    'https://127.0.0.1/internal',
    'http://api.twilio.com/2010-04-01/Accounts/' + VOICE_MEDIA_SID,
    VOICE_MEDIA_URL.replace('api.twilio.com', 'api.twilio.com.evil.invalid'),
    VOICE_MEDIA_URL.replace(VOICE_MEDIA_SID, 'AC' + 'd'.repeat(32)),
    VOICE_MEDIA_URL.replace('api.twilio.com', 'user:pass@api.twilio.com'),
    VOICE_MEDIA_URL.replace('api.twilio.com', 'api.twilio.com:8443'),
    VOICE_MEDIA_URL + '?redirect=https://attacker.invalid/',
    VOICE_MEDIA_URL + '#fragment',
    VOICE_MEDIA_URL.replace('/Media/ME', '/Media/%4dE'),
  ]
  for (const mediaUrl of attacks) {
    let fetchCalls = 0
    const h = voiceMediaHarness(async () => { fetchCalls++; return new Response(new Uint8Array([1, 2, 3])) })
    await assert.rejects(() => h.voice.transcribeTwilioVoiceNote({ mediaUrl, contentType: 'audio/ogg' }), /Untrusted Twilio voice media URL/)
    assert.equal(fetchCalls, 0, 'malicious URL must be rejected before any network request: ' + mediaUrl)
    assert.equal(h.getProviderCalls(), 0)
  }
})
await check('P1 voice-note: valid account URL uses manual redirect and supports direct 200 audio', async () => {
  const calls: any[] = []
  const h = voiceMediaHarness(async (url, options) => {
    calls.push({ url, options })
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/ogg' } })
  })
  assert.equal(await h.voice.transcribeTwilioVoiceNote({ mediaUrl: VOICE_MEDIA_URL, contentType: 'audio/ogg' }), 'Fixture audio transcription')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, VOICE_MEDIA_URL)
  assert.equal(calls[0].options.redirect, 'manual')
  assert.equal(calls[0].options.headers.Authorization, 'Basic ' + Buffer.from(VOICE_MEDIA_SID + ':fixture-token').toString('base64'))
  assert.equal(h.getProviderCalls(), 1)
})
await check('P1 voice-note: external/private redirect is refused before a second fetch', async () => {
  for (const redirect of [
    'http://169.254.169.254/latest/meta-data',
    'https://mms.twiliocdn.com.evil.invalid/audio',
    'https://mms.twiliocdn.com:8443/audio',
    'https://user:pass@mms.twiliocdn.com/audio',
  ]) {
    const calls: any[] = []
    const h = voiceMediaHarness(async (url, options) => {
      calls.push({ url, options })
      return new Response(null, { status: 302, headers: { location: redirect } })
    })
    await assert.rejects(() => h.voice.transcribeTwilioVoiceNote({ mediaUrl: VOICE_MEDIA_URL, contentType: 'audio/ogg' }), /redirect refused/)
    assert.equal(calls.length, 1, 'must never follow unapproved redirect')
    assert.equal(h.getProviderCalls(), 0)
  }
})
await check('P1 voice-note: one valid Twilio CDN hop receives NO Basic auth; second hop blocked', async () => {
  const cdn = 'https://mms.twiliocdn.com/fixture/audio?sig=fixture'
  const calls: any[] = []
  const h = voiceMediaHarness(async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1
      ? new Response(null, { status: 302, headers: { location: cdn } })
      : new Response(new Uint8Array([4, 5]), { status: 200 })
  })
  assert.equal(await h.voice.transcribeTwilioVoiceNote({ mediaUrl: VOICE_MEDIA_URL, contentType: 'audio/ogg' }), 'Fixture audio transcription')
  assert.equal(calls.length, 2)
  assert.equal(calls[1].url, cdn)
  assert.equal(calls[1].options.redirect, 'manual')
  assert.equal(calls[1].options.headers?.Authorization, undefined)
  assert.equal(h.getProviderCalls(), 1)

  let tries = 0
  const second = voiceMediaHarness(async () => {
    tries++
    return new Response(null, { status: 307, headers: { location: cdn } })
  })
  await assert.rejects(() => second.voice.transcribeTwilioVoiceNote({ mediaUrl: VOICE_MEDIA_URL, contentType: 'audio/ogg' }), /download failed: 307/)
  assert.equal(tries, 2)
  assert.equal(second.getProviderCalls(), 0)
})
await check('P1 voice-note: reject declared and streaming >24MiB before model upload', async () => {
  let providerCalls = 0
  const declared = voiceMediaHarness(async () => {
    providerCalls++
    return new Response(new Uint8Array([1]), { status: 200, headers: { 'content-length': String(25 * 1024 * 1024) } })
  })
  await assert.rejects(() => declared.voice.transcribeTwilioVoiceNote({ mediaUrl: VOICE_MEDIA_URL, contentType: 'audio/ogg' }), /too large/)
  assert.equal(providerCalls, 1)
  assert.equal(declared.getProviderCalls(), 0)

  const streamed = voiceMediaHarness(async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(12 * 1024 * 1024))
      controller.enqueue(new Uint8Array(13 * 1024 * 1024))
      controller.close()
    },
  }), { status: 200 }))
  await assert.rejects(() => streamed.voice.transcribeTwilioVoiceNote({ mediaUrl: VOICE_MEDIA_URL, contentType: 'audio/ogg' }), /too large/)
  assert.equal(streamed.getProviderCalls(), 0)
})

if (failed) process.exit(1)
