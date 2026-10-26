// Make: real slides and sheets (approved 24 Oct mock). Pure logic, generation with a fake model, and real exports.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import * as D from '../lib/make/documents.ts'
import { generateDoc, editDoc } from '../lib/make/generate.ts'
import { deckToPptx, sheetToXlsx } from '../lib/make/export.ts'

const failures: string[] = []
async function check(label: string, fn: () => unknown) { try { await fn(); console.log('PASS ' + label) } catch (e: any) { failures.push(`${label}: ${e.message}`) } }

await check('make requests are recognised; reminders, Google apps and plain chat are not', () => {
  assert.equal(D.makeDocRequest('Make a pitch deck for AskGogo, 6 slides')?.format, 'deck')
  assert.equal(D.makeDocRequest('Create a presentation on our Q3 plan')?.format, 'deck')
  assert.equal(D.makeDocRequest('Can you build me a budget for a Goa trip for 4 people')?.format, 'sheet')
  assert.equal(D.makeDocRequest('Prepare a spreadsheet of wedding costs')?.format, 'sheet')
  assert.equal(D.makeDocRequest('Create a reminder to review the budget sheet tomorrow'), null)
  assert.equal(D.makeDocRequest('Make a Google Sheet in my drive for expenses'), null)
  assert.equal(D.makeDocRequest('What is a pitch deck?'), null)
  // 24 Oct live: a deck about a WhatsApp product was rejected as a message.
  assert.equal(D.makeDocRequest('Make a 6 slide pitch deck for AskGogo, a WhatsApp-first AI memory assistant for India')?.format, 'deck')
  assert.equal(D.makeDocRequest('Add a task: send the deck to Ravi'), null)
})

await check('edits bind only to the last Make reply', () => {
  const reply = D.chatReply({ format: 'deck', title: 'T', theme: 'light', slides: [{ kicker: '', title: 'A', points: [], notes: '' }, { kicker: '', title: 'B', points: [], notes: '' }] }, '11111111-2222-3333-4444-555555555555')
  assert.equal(D.madeIdFromReply(reply), '11111111-2222-3333-4444-555555555555')
  assert.equal(D.madeIdFromReply(D.editedReply({ format: 'deck', title: 'T', theme: 'light', slides: [{ kicker: '', title: 'A', points: [], notes: '' }, { kicker: '', title: 'B', points: [], notes: '' }] }, '11111111-2222-3333-4444-555555555555')), '11111111-2222-3333-4444-555555555555')
  assert.equal(D.madeIdFromReply('Here is /dashboard/reports/11111111-2222-3333-4444-555555555555'), null)
  assert.equal(D.madeIdFromReply('📊 Not updated: try again\nhttps://app.askgogo.in/dashboard/reports/11111111-2222-3333-4444-555555555555'), '11111111-2222-3333-4444-555555555555')
  assert.ok(D.isMakeEdit('make slide 3 shorter'))
  assert.ok(D.isMakeEdit('Make the hotel ₹5,000 a night'))
  assert.ok(D.isMakeEdit('add a row for snacks'))
  assert.ok(!D.isMakeEdit('what is the weather'))
  assert.ok(!D.isMakeEdit('add milk to my list'))
  assert.ok(!D.isMakeEdit('set a reminder for 5pm'))
  assert.ok(D.isMakeEdit('add a slide on WhatsApp reminders'))
  assert.ok(!D.isMakeEdit('make a pitch deck for my bakery'))
})

await check('sheet totals are computed in code; model totals rows and currency strings are handled', () => {
  const s = D.validSheet({ title: 'Goa', columns: ['Item', 'Qty', 'Amount'], rows: [['Flights', 4, '₹36,000'], ['Hotel', 3, 15000], ['Food', 1, 'Rs 8,500']], estimateRows: [2, 9] })!
  assert.equal(s.totalColumn, 2)
  assert.equal(D.sheetTotal(s), 59500)
  assert.deepEqual(s.estimateRows, [2])
  assert.match(D.chatReply(s, '11111111-2222-3333-4444-555555555555'), /total ₹59,500/)
  const csv = D.sheetCsv(s)
  assert.match(csv, /Food \(est\.\),1,8500/)
  assert.match(csv, /\nTotal,,59500$/)
})

await check('invalid model output is rejected; JSON is found inside fences', () => {
  assert.equal(D.validDeck({ slides: [{ title: 'Only one' }] }), null)
  assert.equal(D.validSheet({ columns: ['A'], rows: [['x']] }), null)
  assert.deepEqual(D.firstJson('Sure!\n```json\n{"a":{"b":"}"}}\n```'), { a: { b: '}' } })
})

await check('generation uses public facts and retries once on bad JSON; personal asks skip search', async () => {
  let calls = 0, searched = 0
  const model = async () => (++calls === 1 ? 'not json' : JSON.stringify({ title: 'AskGogo', slides: [{ kicker: 'Problem', title: 'Memory is scattered', points: ['[YOUR USERS] lose notes'], notes: 'n' }, { kicker: 'Solution', title: 'One memory', points: ['WhatsApp first'], notes: '' }] }))
  const out = await generateDoc('deck', 'Make a pitch deck for AskGogo', { model, search: async () => { searched++; return [{ title: 'x', snippet: 'y', url: 'https://example.com' }] } })
  assert.equal(calls, 2); assert.equal(searched, 1)
  assert.equal(out?.doc.format, 'deck'); assert.deepEqual(out?.sources, ['https://example.com'])
  searched = 0
  await generateDoc('sheet', 'Make a budget from my bank account statements', { model: async () => JSON.stringify({ columns: ['Item', 'Amount'], rows: [['Rent', 20000]] }), search: async () => { searched++; return [] } })
  assert.equal(searched, 0)
})

await check('edits return a valid document', async () => {
  const s = D.validSheet({ title: 'Goa', columns: ['Item', 'Amount'], rows: [['Hotel', 15000]] })!
  const next = await editDoc(s, 'add a row for snacks', { model: async () => JSON.stringify({ ...s, rows: [...s.rows, ['Snacks', 2000]] }) })
  assert.equal(D.sheetTotal(next as any), 17000)
})

await check('PowerPoint and Excel exports are real files', async () => {
  const deck = D.validDeck({ title: 'AskGogo', slides: [{ kicker: 'Intro', title: 'AskGogo', points: ['Memory on WhatsApp'], notes: 'hi' }, { kicker: 'Why', title: 'Problem', points: ['a', 'b'], notes: '' }] })!
  const pptx = await deckToPptx(deck)
  assert.equal(pptx.subarray(0, 2).toString(), 'PK'); assert.ok(pptx.length > 10000)
  const s = D.validSheet({ title: 'Goa: trip/plan', columns: ['Item', 'Amount'], rows: [['Hotel', 15000], ['Food', 5000]] })!
  const xlsx = await sheetToXlsx(s)
  assert.equal(xlsx.subarray(0, 2).toString(), 'PK')
  const XLSX: any = await import('xlsx')
  const wb = XLSX.read(xlsx, { type: 'buffer' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  assert.equal(ws.A4.v, 'Total'); assert.equal(ws.B4.f, 'SUM(B2:B3)'); assert.equal(ws.B4.v, 20000)
})

await check('invented statistics become [ADD NUMBER]; known ones and small counts stay', () => {
  const deck = D.validDeck({ title: 'T', slides: [{ title: 'Why now', points: ["India's 1.4B users need recall", '500M WhatsApp users', '3 simple steps', 'Launched in 2026'], notes: '' }, { title: 'B', points: ['x'], notes: '' }] })!
  const out = D.scrubInventedNumbers(deck, 'WhatsApp has 500M users in India', 'Make a deck')
  assert.deepEqual(out.slides[0].points, ["India's [ADD NUMBER] users need recall", '500M WhatsApp users', '3 simple steps', 'Launched in 2026'])
})

await check('amount is quantity x unit price, computed in code', () => {
  const s = D.validSheet({ title: 'Goa', columns: ['Item', 'Basis', 'Qty', 'Unit price', 'Amount'], rows: [['Hotel', '2 rooms x 3 nights', 6, '5,000', 20000], ['Flights', '4 people', 4, 9000, 36000]], totalColumn: 4 })!
  assert.equal(s.rows[0][4], 30000)
  assert.equal(D.sheetTotal(s), 66000)
})

await check('in-page edits are signed-in and owner-scoped', () => {
  const route = readFileSync('app/api/make/[id]/edit/route.ts', 'utf8')
  assert.match(route, /getSession\(\)/); assert.match(route, /unauthorized/)
  assert.match(route, /linkedTelegramIds\(session\.telegramId\)/)
  assert.match(readFileSync('components/dashboard/make-doc-viewer.tsx', 'utf8'), /\/api\/make\/\$\{encodeURIComponent\(id\)\}\/edit/)
})

await check('owner-private Make edits never reach a cheap model, including the invalid-output retry', async () => {
  const confidential = 'Internal owner-only acquisition forecast'
  const s = D.validSheet({ title: 'Private plan', columns: ['Item', 'Amount'], rows: [[confidential, 30000]] })!
  const calls: boolean[] = []
  const next = await editDoc(s, 'add a row for school fees', { model: async (prompt: string, scanText: string, opts?: any) => {
    calls.push(!!opts?.strong)
    assert.equal(scanText, 'add a row for school fees', 'innocent instructions cannot classify a stored private document')
    assert.match(prompt, /Internal owner-only acquisition forecast/, 'existing private document is included in the model prompt')
    return calls.length === 1 ? 'Sure! here it is' : JSON.stringify({ spreadsheet: { ...s, rows: [...s.rows, ['School fees', 8000]] } })
  } })
  assert.deepEqual(calls, [true, true], 'both attempts must stay on the strong/primary provider')
  assert.equal(D.sheetTotal(next as any), 38000)
  assert.match(readFileSync('lib/make/generate.ts', 'utf8'), /model\(editPrompt\(doc, instruction\), instruction, \{ strong: true \}\)/, 'privacy boundary must be applied by actual editDoc caller')
})

function actualMakeModelBoundary(doc: D.MakeDoc, options: { replies?: string[]; throwAt?: number[]; noKey?: boolean } = {}) {
  const cheapCalls: any[] = [], primaryCalls: any[] = []
  class FixturePrimary {
    constructor(config: any) { assert.equal(config.apiKey, 'fixture-primary-only') }
    messages = { create: async (params: any, requestOptions: any) => {
      primaryCalls.push(params)
      assert.equal(params.model, 'claude-haiku-4-5'); assert.equal(params.max_tokens, 4000)
      assert.equal(requestOptions.timeout, 45_000)
      if (options.throwAt?.includes(primaryCalls.length)) throw new Error('fixture primary unavailable')
      return { content: [{ type: 'text', text: options.replies?.[primaryCalls.length - 1] ?? JSON.stringify(doc) }] }
    } }
  }
  const exports: any = {}
  const deps: Record<string, any> = {
    './documents': D,
    '@anthropic-ai/sdk': { __esModule: true, default: FixturePrimary },
    '@/lib/inference/cheap': { cheapComplete: async (params: any) => { cheapCalls.push(params); return JSON.stringify(doc) } },
  }
  runInNewContext(ts.transpileModule(readFileSync('lib/make/generate.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, {
    exports, require: (name: string) => { if (!(name in deps)) throw new Error(`unexpected model-boundary dependency: ${name}`); return deps[name] },
    process: { env: options.noKey ? {} : { ANTHROPIC_API_KEY: 'fixture-primary-only' } }, console,
  })
  return { api: exports, cheapCalls, primaryCalls }
}

await check('actual default model keeps saved sheet and deck prompts off cheap routing on first attempt and retry', async () => {
  const privateText = 'SYNTHETIC OWNER ONLY ACQUISITION FORECAST'
  const docs: D.MakeDoc[] = [
    D.validSheet({ title: 'Private plan', columns: ['Item', 'Amount'], rows: [[privateText, 30000]] })!,
    D.validDeck({ title: 'Private deck', slides: [{ title: 'Plan', points: ['Fixture'], notes: privateText }, { title: 'Next', points: ['Fixture'], notes: '' }] })!,
  ]
  for (const doc of docs) for (const retry of [false, true]) {
    const fixture = actualMakeModelBoundary(doc, { replies: retry ? ['not document JSON', JSON.stringify(doc)] : [JSON.stringify(doc)] })
    const result = await fixture.api.editDoc(doc, 'rename the final heading')
    assert.equal(result?.format, doc.format)
    assert.equal(fixture.cheapCalls.length, 0, 'a saved private prompt must never reach cheap routing')
    assert.equal(fixture.primaryCalls.length, retry ? 2 : 1)
    for (const call of fixture.primaryCalls) assert.ok(call.messages[0].content.includes(privateText), 'the actual primary call carries the existing document')
  }
})

await check('actual private edits fail closed without a primary key or on primary failure; fresh nonpersonal creation keeps cheap routing', async () => {
  const doc = D.validSheet({ title: 'Private plan', columns: ['Item', 'Amount'], rows: [['SYNTHETIC PRIVATE ROW', 30000]] })!
  const retry = actualMakeModelBoundary(doc, { throwAt: [1] })
  assert.equal((await retry.api.editDoc(doc, 'rename heading'))?.format, 'sheet')
  assert.equal(retry.primaryCalls.length, 2); assert.equal(retry.cheapCalls.length, 0)
  for (const options of [{ noKey: true }, { throwAt: [1, 2] }, { replies: ['invalid', 'invalid'] }]) {
    const fixture = actualMakeModelBoundary(doc, options)
    assert.equal(await fixture.api.editDoc(doc, 'rename heading'), null)
    assert.equal(fixture.cheapCalls.length, 0, 'unavailable/invalid primary output must not fall back to cheap')
  }
  const creation = actualMakeModelBoundary(doc)
  const made = await creation.api.generateDoc('sheet', 'Make a spreadsheet of public park names', { search: async () => [] })
  assert.equal(made?.doc.format, 'sheet'); assert.equal(creation.cheapCalls.length, 1); assert.equal(creation.primaryCalls.length, 0)
  assert.equal(creation.cheapCalls[0].taskClass, 'make_draft_nonpersonal')
  assert.equal(creation.cheapCalls[0].scanText, 'Make a spreadsheet of public park names')
})

if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('verify-make-docs: all passed')
