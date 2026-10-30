// TEST ONLY / EXPECTED SAFETY RED. This test executes the shipped meeting upload
// route with entirely synthetic inputs and mocked WhatsApp/OpenAI/DB surfaces.
// It must never send a real message, call a provider, or resolve a real account.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

const path = 'app/api/meeting/upload/route.ts'
const source = readFileSync(path, 'utf8')
const proxySource = readFileSync('proxy.ts', 'utf8')
assert.match(source, /export async function POST\s*\(/, 'exercise actual exported POST handler')
assert.match(source, /sendWhatsAppMessage\s*\(/, 'must test actual outbound side-effect path')
assert.match(source, /resolveUser\s*\(/, 'must test actual owner-binding path')
// The current proxy is observability-only; it does not authenticate this route.
assert.match(proxySource, /return NextResponse\.next\(\)/)

const sent: Array<{to: string, body: string}> = []
const resolved: string[] = []
const notes: number[] = []
let fakeTranscriptions = 0
const rejectedImports: string[] = []

class OfflineOpenAI {
  audio = {transcriptions: {create: async () => {
    fakeTranscriptions++
    return 'Synthetic meeting transcript with enough words for the notes handler to proceed.'
  }}}
}
const fakeModules: Record<string, unknown> = {
  'next/server': {
    NextResponse: {
      json: (body: unknown, opts?: {status?: number}) =>
        ({status: opts?.status ?? 200, body}),
    },
  },
  '@/lib/bot/handlers/meeting-notes': {
    buildMeetingNotesReply: async (p: {telegramId: number}) => {
      notes.push(p.telegramId)
      return {
        summaryReply: 'SYNTHETIC NOTES, NOT DELIVERED',
        transcriptChunks: ['SYNTHETIC TRANSCRIPT, NOT DELIVERED'],
        speakerPrompt: null,
      }
    },
  },
  '@/lib/channels/whatsapp': {
    sendWhatsAppMessage: async (to: string, body: string) => {
      sent.push({to, body})
      return {status: 'synthetic-only'}
    },
  },
  '@/lib/bot/resolve-user': {
    resolveUser: async (p: {externalUserId: string}) => {
      resolved.push(p.externalUserId)
      return {telegramId: 777777, whatsappId: p.externalUserId}
    },
  },
  openai: {__esModule: true, default: OfflineOpenAI},
}
// transpileModule + runInNewContext loads the actual route, replacing every
// imported provider with an inert stub; no HTTP, Twilio or database is exposed.
const output = ts.transpileModule(source, {compilerOptions: {
  module: ts.ModuleKind.CommonJS,
  target: ts.ScriptTarget.ES2022,
  esModuleInterop: true,
}}).outputText
const shipped: Record<string, any> = {}
runInNewContext(output, {
  exports: shipped,
  module: {exports: shipped},
  require: (name: string) => {
    if (Object.prototype.hasOwnProperty.call(fakeModules, name)) return fakeModules[name]
    rejectedImports.push(name)
    throw new Error('Synthetic fixture blocked unknown private/provider import: ' + name)
  },
  File: globalThis.File,
  Blob: globalThis.Blob,
  ArrayBuffer,
  Uint8Array,
  Buffer,
  URL,
  Date,
  setTimeout,
  clearTimeout,
  console: {log() {}, warn() {}, error() {}},
  process: {env: {}},
  fetch: () => {throw new Error('Real network is forbidden in synthetic route test')},
}, {filename: 'shipped-meeting-upload-route.js', timeout: 3000})
assert.equal(typeof shipped.POST, 'function', 'load actual shipped route handler')

const audio = {
  size: 24, type: 'audio/webm', name: 'synthetic.webm',
  arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
}
function reset() {
  sent.length = 0
  resolved.length = 0
  notes.length = 0
  fakeTranscriptions = 0
}
async function request(fields: Record<string, unknown>) {
  const form = {get: (name: string) =>
    Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : null}
  return shipped.POST({formData: async () => form, headers: new Headers()})
}
let controlCount = 0
let safetyPassCount = 0
const expectedSafetyFailures: string[] = []
async function control(label: string, fn: () => Promise<void>) {
  reset()
  await fn()
  controlCount++
  console.log('PASS positive:', label)
}
async function safety(label: string, fn: () => Promise<void>) {
  reset()
  try {
    await fn()
    safetyPassCount++
    console.log('PASS safety:', label)
  } catch (error: any) {
    const why = String(error?.message || error)
    expectedSafetyFailures.push(label + ': ' + why)
    console.error('EXPECTED RED safety:', label, why)
  }
}
await control('missing audio rejects before WhatsApp or owner resolution', async () => {
  const result = await request({phone: '+14155550121'})
  assert.equal(result.status, 400)
  assert.equal(sent.length, 0)
  assert.equal(resolved.length, 0)
})
await control('missing phone rejects before WhatsApp or owner resolution', async () => {
  const result = await request({audio})
  assert.equal(result.status, 400)
  assert.equal(sent.length, 0)
  assert.equal(resolved.length, 0)
})
await safety('anonymous phone-specified upload is denied before any outbound WhatsApp', async () => {
  const result = await request({phone: '+14155550122', audio, title: 'Synthetic only'})
  assert.ok([401, 403].includes(result.status), 'unverified uploader must receive 401/403')
  assert.equal(sent.length, 0, 'an unverified uploader must not send to a chosen phone number')
})
await safety('anonymous payload never resolves or writes another phone owner context', async () => {
  await request({phone: '+14155550123', audio, title: 'Synthetic only'})
  assert.equal(resolved.length, 0, 'phone in unauthenticated multipart body is a target, not an owner proof')
  assert.equal(notes.length, 0, 'unverified upload must not synthesize saved notes as another user')
})
await safety('anonymous upload never spends provider transcription capacity', async () => {
  await request({phone: '+14155550124', audio, title: 'Synthetic only'})
  assert.equal(fakeTranscriptions, 0, 'validate binding, size and consent before paid transcription')
})
assert.deepEqual(rejectedImports, [], 'do not load unexpected provider/network modules')
console.log('Meeting-upload authentication controls:', controlCount,
  'safety passes:', safetyPassCount, 'safety failures:', expectedSafetyFailures.length)
if (expectedSafetyFailures.length) {
  console.error(expectedSafetyFailures.join('\n'))
  process.exitCode = 1
}
