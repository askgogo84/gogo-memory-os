// TEST ONLY. Executes unchanged production PDF/ticket logging AST with fictitious inputs.
// Expected mandatory privacy RED; never touches actual PDFs, credentials, providers or networks.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('lib/services/pdf-reader.ts', 'utf8')
const ast = ts.createSourceFile('pdf-reader.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const parser = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'parseTicketJson')
assert.ok(parser?.body, 'original ticket JSON parser must be present')
const pdfLogs = []
const imageLogs = []
function collectOriginalLogging(node) {
  if (ts.isExpressionStatement(node)) {
    const expr = node.getText(ast)
    if (expr.includes("console.log('[pdf-reader] Fetching PDF from Twilio:'")) pdfLogs.push(node)
    if (expr.includes("console.log('[ticket-reader] Fetching ticket image from Twilio:'")) imageLogs.push(node)
  }
  ts.forEachChild(node, collectOriginalLogging)
}
collectOriginalLogging(ast)
assert.equal(pdfLogs.length, 1, 'must extract exactly one original Twilio PDF URL diagnostic')
assert.equal(imageLogs.length, 1, 'must extract exactly one original Twilio ticket-image URL diagnostic')
const js = ts.transpileModule(parser.getText(ast) + '\nglobalThis.__parser = parseTicketJson;', {
  compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
}).outputText
const parserLogs = []
const sandbox = vm.createContext({console: {
  log: (...args) => parserLogs.push({level: 'log', args}),
  error: (...args) => parserLogs.push({level: 'error', args}),
}})
vm.runInContext(js, sandbox, {timeout: 1500})
assert.equal(typeof sandbox.__parser, 'function', 'the actual parser must execute')

const fixturePNR = 'SYP9R1' // entirely invented and never used for an actual booking
const fixturePassenger = 'Synthetic Example Passenger'
const ticket = JSON.stringify({
  type: 'flight', flights: [{from: 'Fixture A', to: 'Fixture B', date: '30 Nov 2026',
    departure: '10:00', arrival: '12:00', airline: 'Fixture Air', flightNo: 'FX100', pnr: fixturePNR}],
  passengers: [fixturePassenger],
})
const parsed = sandbox.__parser(ticket)
const empty = sandbox.__parser('null')
const broken = '{"private_fixture":"SYNTHETIC_BROKEN_DOCUMENT_DATA","ticket":'
const rejected = sandbox.__parser(broken)
const parserDiagnostics = JSON.stringify(parserLogs)

const fixtureMediaUrl = 'https://media.example.test/fixture.pdf?token=SYNTHETIC_MEDIA_QUERY_SECRET'
function captureOriginalStatement(statement) {
  const output = []
  const js = ts.transpileModule(statement.getText(ast), {
    compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None},
  }).outputText
  vm.runInContext(js, vm.createContext({
    mediaUrl: fixtureMediaUrl,
    console: {log: (...args) => output.push(args)},
  }), {timeout: 1500})
  return output
}
const pdfOutput = captureOriginalStatement(pdfLogs[0])
const imageOutput = captureOriginalStatement(imageLogs[0])

let controlPass = 0, controlFail = 0, mandatoryFail = 0, mandatoryPass = 0
function check(kind, label, fn) {
  try {
    fn()
    if (kind === 'control') controlPass++
    else mandatoryPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (e) {
    if (kind === 'control') controlFail++
    else mandatoryFail++
    console.error('FAIL ' + kind + ': ' + label + ' (' + String(e?.message || e).slice(0, 120) + ')')
  }
}
check('control', 'actual original parser retains fixture flight and PNR semantics', () => {
  assert.equal(parsed?.type, 'flight')
  assert.equal(parsed?.flights?.[0]?.pnr, fixturePNR)
})
check('control', 'original parser preserves synthetic passenger list', () => {
  assert.equal(parsed?.passengers?.[0], fixturePassenger)
})
check('control', 'null and malformed fixture ticket responses remain non-tickets', () => {
  assert.equal(empty, null); assert.equal(rejected, null)
})
check('control', 'original parser diagnostic labels captured without any provider IO', () => {
  assert.equal(parserLogs.some(e => e.args[0] === '[ticket-reader] Claude response:'), true)
  assert.equal(parserLogs.some(e => e.args[0] === '[ticket-reader] JSON parse failed:'), true)
})
check('control', 'both original PDF and image fetching diagnostics were executed', () => {
  assert.equal(pdfOutput[0]?.[0], '[pdf-reader] Fetching PDF from Twilio:')
  assert.equal(imageOutput[0]?.[0], '[ticket-reader] Fetching ticket image from Twilio:')
})
check('mandatory', 'ticket PNR absent from runtime diagnostics', () => {
  assert.equal(parserDiagnostics.includes(fixturePNR), false)
})
check('mandatory', 'passenger name absent from runtime diagnostics', () => {
  assert.equal(parserDiagnostics.includes(fixturePassenger), false)
})
check('mandatory', 'unparseable private model payload absent from diagnostics', () => {
  assert.equal(parserDiagnostics.includes('SYNTHETIC_BROKEN_DOCUMENT_DATA'), false)
})
check('mandatory', 'PDF media URL and query token absent from runtime diagnostics', () => {
  assert.equal(JSON.stringify(pdfOutput).includes(fixtureMediaUrl), false)
})
check('mandatory', 'ticket-image media URL and query token absent from runtime diagnostics', () => {
  assert.equal(JSON.stringify(imageOutput).includes(fixtureMediaUrl), false)
})
console.log('RESULT controls_pass=' + controlPass + '/5; controls_fail=' + controlFail
  + '; mandatory_privacy_pass=' + mandatoryPass + '/5; mandatory_privacy_fail=' + mandatoryFail)
if (controlFail) process.exit(2)
if (mandatoryFail) process.exit(1)
