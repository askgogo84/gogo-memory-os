// Make: real slides and sheets (approved 24 Oct mock). Pure logic, generation with a fake model, and real exports.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { exactSessionOwnerId } from '../lib/dashboard/owner-identity.ts'
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
  assert.match(route, /exactSessionOwnerId\(session\.telegramId\)/)
  assert.match(readFileSync('components/dashboard/make-doc-viewer.tsx', 'utf8'), /\/api\/make\/\$\{encodeURIComponent\(id\)\}\/edit/)
})

// Execute the real routes and real updateDoc with inert database/provider boundaries.
function makeRouteProbe(owner: any, rowOwner = String(owner), readError = false) {
  const calls: any = { reads: [], writes: [], body: 0, model: 0, exports: 0 }
  const doc = { format: 'sheet', title: 'Fixture', columns: ['Item', 'Amount'], rows: [['A', 1]] }
  const db = { from(table: string) {
    const filters: any[] = []; let write = false
    const q: any = {
      select() { return q },
      update(value: any) { write = true; calls.writes.push({ table, filters, value }); return q },
      eq(key: string, value: any) { filters.push([key, value]); return q },
      async maybeSingle() {
        calls.reads.push({ table, filters })
        return { data: { telegram_id: rowOwner, content_json: { doc } }, error: readError ? { message: 'inert read failure' } : null }
      },
      then(resolve: any, reject: any) { return Promise.resolve({ error: null }).then(resolve, reject) },
    }
    return q
  } }
  const dependencies: any = {
    'next/server': { NextResponse: Response },
    '@/lib/dashboard/session': { getSession: async () => owner === null ? null : { telegramId: owner } },
    '@/lib/dashboard/owner-identity': { exactSessionOwnerId },
    '@/lib/dashboard/owner-ids': { linkedTelegramIds: async () => [String(owner)] },
    '@/lib/supabase-admin': { supabaseAdmin: db },
    '@/lib/make/generate': { editDoc: async () => { calls.model++; return doc } },
    '@/lib/make/export': { sheetToCsv: () => { calls.exports++; return 'Item,Amount\nA,1' }, exportFileName: () => 'fixture.csv' },
    './documents': {}, './generate': {},
  }
  function load(path: string) {
    const exports: any = {}
    const code = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
    vm.runInNewContext(code, { exports, module: { exports }, require: (name: string) => {
      assert.ok(name in dependencies, 'unexpected dependency: ' + name); return dependencies[name]
    }, Response, URL, Buffer, Uint8Array, Date, console })
    return exports
  }
  dependencies['@/lib/make/store'] = load('lib/make/store.ts')
  const context = { params: Promise.resolve({ id: '11111111-2222-3333-4444-555555555555' }) }
  const request: any = { url: 'https://example.test/api/make/fixture/export?format=csv', json: async () => { calls.body++; return { instruction: 'add a row' } } }
  return { calls, edit: () => load('app/api/make/[id]/edit/route.ts').POST(request, context), download: () => load('app/api/make/[id]/export/route.ts').GET(request, context) }
}

await check('Make routes reject invalid original owners before private reads, body or providers', async () => {
  for (const owner of [null, '', '0', ' 4242 ', '\u00a04242\u00a0', '01', '1e3', '9223372036854775808', 9007199254740992]) {
    for (const route of ['edit', 'download'] as const) {
      const p = makeRouteProbe(owner)
      const response = await p[route]()
      assert.ok(response.status >= 400)
      assert.equal(p.calls.reads.length, 0); assert.equal(p.calls.body, 0)
      assert.equal(p.calls.model, 0); assert.equal(p.calls.exports, 0); assert.equal(p.calls.writes.length, 0)
    }
  }
})

await check('Make routes bind SELECT and actual UPDATE to exact neighboring signed64 owners', async () => {
  for (const owner of ['4242', '-4242', '9007199254740992', '9007199254740993', '9223372036854775807', '-9223372036854775808']) {
    for (const route of ['edit', 'download'] as const) {
      const p = makeRouteProbe(owner)
      assert.equal((await p[route]()).status, 200)
      assert.equal(p.calls.reads.length, 1)
      assert.ok(p.calls.reads[0].filters.some(([k, v]: any) => k === 'telegram_id' && v === owner))
      if (route === 'edit') {
        assert.equal(p.calls.writes.length, 1)
        assert.ok(p.calls.writes[0].filters.some(([k, v]: any) => k === 'telegram_id' && v === owner))
        assert.equal(p.calls.model, 1)
      } else { assert.equal(p.calls.exports, 1); assert.equal(p.calls.model, 0) }
    }
  }
})

await check('Make routes deny mismatched, padded rows and database errors without model/export/write', async () => {
  for (const [rowOwner, error] of [['9007199254740992', false], [' 9007199254740993 ', false], ['9007199254740993', true]] as const) {
    for (const route of ['edit', 'download'] as const) {
      const p = makeRouteProbe('9007199254740993', rowOwner, error)
      assert.ok((await p[route]()).status >= 400)
      assert.equal(p.calls.model, 0); assert.equal(p.calls.exports, 0); assert.equal(p.calls.writes.length, 0)
    }
  }
})

await check('a wrapped or bad cheap edit retries on the strong model', async () => {
  const s = D.validSheet({ title: 'Home', columns: ['Item', 'Amount'], rows: [['Rent', 30000]] })!
  const calls: any[] = []
  const next = await editDoc(s, 'add a row for school fees', { model: async (_p: string, _s: string, o?: any) => { calls.push(!!o?.strong); return o?.strong ? JSON.stringify({ spreadsheet: { ...s, rows: [...s.rows, ['School fees', 8000]] } }) : 'Sure! here it is' } })
  assert.deepEqual(calls, [false, true]); assert.equal(D.sheetTotal(next as any), 38000)
})

if (failures.length) { console.error(failures.join('\n')); process.exit(1) }
console.log('verify-make-docs: all passed')
