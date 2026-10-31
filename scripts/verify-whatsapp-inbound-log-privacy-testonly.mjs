// TEST ONLY: unchanged production AST + wholly synthetic form values, no providers or customer data.
// Mandatory negative assertions are expected RED until Claude's independently reviewed source fix.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('app/api/webhooks/whatsapp/route.ts', 'utf8')
const ast = ts.createSourceFile('route.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const handler = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'handleWhatsAppPost')
assert.ok(handler?.body, 'unchanged signed WhatsApp handler must exist')
const body = handler.body.statements.find(ts.isTryStatement)?.tryBlock.statements
assert.ok(body, 'expected original handler try block')

const declaration = body.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(ast) === 'loggedBody'))
const rawLog = body.find(s => ts.isExpressionStatement(s) && s.getText(ast).includes("console.log('RAW_TWILIO:'"))
const inboundLog = body.find(s => ts.isExpressionStatement(s) && s.getText(ast).includes("console.log('WhatsApp inbound:'"))
assert.ok(declaration && rawLog && inboundLog, 'original diagnostics must be AST-extracted, not simulated')
assert.match(source, /auditInboundTwilioSignature\s*\(/, 'signature verification guard must remain')
assert.match(source, /if\s*\(signatureAudit\.reject\)/, 'signed-webhook gate must remain fail-closed')

const snippet = [declaration, rawLog, inboundLog].map(s => s.getText(ast)).join('\n')
const executable = ts.transpileModule(snippet, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None}}).outputText
const privateMessage = 'Synthetic private message / personal details for log privacy test'
const syntheticPhone = 'whatsapp:+14155550199'
const syntheticName = 'Synthetic Private Sender'
const syntheticMediaUrl = 'https://media.example.test/fixture?token=SYNTHETIC_MEDIA_SECRET'
const syntheticExtra = 'SYNTHETIC_ARBITRARY_FIELD_SECRET'
function capture(bodyText) {
  const fields = {
    From: syntheticPhone,
    ProfileName: syntheticName,
    NumMedia: '1',
    MediaUrl0: syntheticMediaUrl,
    MediaContentType0: 'image/jpeg',
    MessageSid: 'SMsynthetic012345',
    UnexpectedPrivateField: syntheticExtra,
    Body: bodyText,
  }
  const formData = new Map(Object.entries(fields))
  const output = []
  const context = vm.createContext({
    formData,
    otpReply: s => /^\d{6}$/.test(String(s)),
    fromRaw: fields.From,
    from: fields.From.replace(/^whatsapp:/, ''),
    profileName: fields.ProfileName,
    numMedia: 1,
    inboundMessageSid: fields.MessageSid,
    console: {log: (label, data) => output.push({label, data})},
  })
  vm.runInContext(executable, context, {timeout: 1200})
  return output
}

let controls = 0
let mandatoryFailures = 0
let controlFailures = 0
function check(kind, name, fn) {
  try {
    fn()
    if (kind === 'control') controls++
    console.log('PASS ' + kind + ': ' + name)
  } catch (error) {
    if (kind === 'control') controlFailures++
    else mandatoryFailures++
    console.error('FAIL ' + kind + ': ' + name + ' (' + String(error?.message || error).slice(0, 180) + ')')
  }
}
const ordinary = capture(privateMessage)
const otp = capture('482930')
const raw = ordinary.find(e => e.label === 'RAW_TWILIO:')
const inbound = ordinary.find(e => e.label === 'WhatsApp inbound:')
const diagnostic = JSON.stringify(ordinary)

check('control', 'unchanged RAW_TWILIO diagnostic event present', () => assert.ok(raw))
check('control', 'unchanged inbound diagnostic event present', () => assert.ok(inbound))
check('control', 'OTP masks Body in raw event', () => assert.equal(otp.find(e => e.label === 'RAW_TWILIO:')?.data.Body, '[code withheld]'))
check('control', 'OTP masks body in inbound event', () => assert.equal(otp.find(e => e.label === 'WhatsApp inbound:')?.data.body, '[code withheld]'))
check('control', 'both original events log benign MessageSid for operational trace', () => {
  assert.equal(raw?.data.MessageSid, 'SMsynthetic012345')
  assert.equal(inbound?.data.messageSid, 'SMsynthetic012345')
})
check('mandatory', 'ordinary inbound message text absent from runtime diagnostics', () => assert.equal(diagnostic.includes(privateMessage), false))
check('mandatory', 'E.164 sender and From absent from runtime diagnostics', () => assert.equal(diagnostic.includes('14155550199'), false))
check('mandatory', 'private profile name absent from runtime diagnostics', () => assert.equal(diagnostic.includes(syntheticName), false))
check('mandatory', 'media URL and signed-looking query absent from runtime diagnostics', () => assert.equal(diagnostic.includes(syntheticMediaUrl), false))
check('mandatory', 'arbitrary forwarded form field absent from runtime diagnostics', () => assert.equal(diagnostic.includes(syntheticExtra), false))
console.log('RESULT positive_controls_pass=' + controls + '/5; positive_controls_fail=' + controlFailures + '; mandatory_privacy_fail=' + mandatoryFailures + '/5')
if (controlFailures) process.exit(2)
if (mandatoryFailures) process.exit(1)
