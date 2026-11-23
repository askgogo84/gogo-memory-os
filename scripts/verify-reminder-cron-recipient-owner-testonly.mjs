// TEST-ONLY. No provider or database access: execute unchanged production recipient helpers.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const sourcePath = 'app/api/cron/reminders/route.ts'
const source = fs.readFileSync(sourcePath, 'utf8')
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const names = ['findWhatsAppForReminder', 'reminderGoesToOwner']
const functions = names.map(name => {
  const fn = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === name)
  assert.ok(fn, 'unchanged production function not found: ' + name)
  return fn.getText(ast)
})
const compiled = ts.transpileModule(functions.join('\n'), {
  compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 }
}).outputText

const A = '9007199254740992'
const B = '9007199254740993'
const NEG = '-9007199254740993'
const PHONE_A = '+911234567890'
const PHONE_B = '+911234567891'
const PHONE_UK = '+441234567890'

function harness({rows = {}, forceRow, dbError = null} = {}) {
  const queries = []
  const db = {
    from(table) {
      assert.equal(table, 'users', 'only intercepted fictional user rows are permitted')
      const q = { table, fields: '', owner: undefined }
      const chain = {
        select(fields) { q.fields = fields; return chain },
        eq(field, value) {
          assert.equal(field, 'telegram_id')
          q.owner = value
          return chain
        },
        maybeSingle() {
          queries.push({...q})
          const row = forceRow !== undefined ? forceRow : (rows[String(q.owner)] ?? null)
          return Promise.resolve({data: row, error: dbError})
        },
      }
      return chain
    }
  }
  const context = {supabaseAdmin: db, String, Number, console}
  const functions = vm.runInNewContext(
    compiled + '\n({findWhatsAppForReminder, reminderGoesToOwner})',
    context,
    {timeout: 1000}
  )
  assert.equal(typeof functions.findWhatsAppForReminder, 'function')
  assert.equal(typeof functions.reminderGoesToOwner, 'function')
  return {...functions, queries}
}
const ownerRow = (id, whatsapp = PHONE_A) => ({telegram_id: id, whatsapp_id: whatsapp, phone: null})

let controlsPass=0, controlsFail=0, mandatoryPass=0, mandatoryFail=0
async function check(label, mandatory, action) {
  try {
    await action()
    if (mandatory) mandatoryPass++; else controlsPass++
    console.log('PASS ['+(mandatory?'MANDATORY':'CONTROL')+'] '+label)
  } catch (error) {
    if (mandatory) mandatoryFail++; else controlsFail++
    console.error('FAIL ['+(mandatory?'MANDATORY':'CONTROL')+'] '+label+': '+(error?.message||error))
  }
}

// Controls: safe, signed and explicit recipient paths must not regress.
await check('safe positive owner resolves fictional verified WhatsApp row',false,async()=>{
  const h=harness({rows:{'42':ownerRow('42')}})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:42}),PHONE_A)
  assert.equal(String(h.queries[0].owner),'42')
})
await check('valid negative WhatsApp owner remains supported',false,async()=>{
  const h=harness({rows:{'-42':ownerRow('-42')}})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:-42}),PHONE_A)
  assert.equal(String(h.queries[0].owner),'-42')
})
await check('explicit friend reminder destination does not depend on a user phone lookup',false,async()=>{
  const h=harness()
  assert.equal(await h.findWhatsAppForReminder({telegram_id:42,whatsapp_to:PHONE_B}),PHONE_B)
  assert.equal(h.queries.length,0)
})
await check('absent owner and destination fail closed',false,async()=>{
  const h=harness()
  assert.equal(await h.findWhatsAppForReminder({telegram_id:null}),null)
  assert.equal(h.queries.length,0)
})
await check('missing user phone does not manufacture a recipient',false,async()=>{
  const h=harness({rows:{'42':{telegram_id:'42',whatsapp_id:null,phone:null}}})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:'42'}),null)
})

// Mandatory privacy boundaries. Existing deployed source is expected RED until source remediation.
await check('already-rounded unsafe positive numeric owner must not read any private recipient',true,async()=>{
  const h=harness({rows:{[A]:ownerRow(A,PHONE_A)}})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:9007199254740992}),null)
  assert.equal(h.queries.length,0,'unsafe numeric owner reached service-role user lookup')
})
await check('already-rounded unsafe negative numeric owner must not read any private recipient',true,async()=>{
  const h=harness({rows:{['-'+A]:ownerRow('-'+A,PHONE_A)}})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:-9007199254740992}),null)
  assert.equal(h.queries.length,0,'unsafe negative numeric owner reached service-role lookup')
})
await check('canonical owner B must never accept a persisted row belonging to owner A',true,async()=>{
  const h=harness({forceRow:ownerRow(A,PHONE_A)})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:B}),null,
    'private recipient belonging to owner A was resolved for owner B')
})
await check('unsafe numeric result from users must fail closed even for safe requester',true,async()=>{
  const h=harness({forceRow:ownerRow(9007199254740992,PHONE_A)})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:42}),null)
})
await check('database error with returned row must not authorize private recipient',true,async()=>{
  const h=harness({forceRow:ownerRow('42',PHONE_A),dbError:{message:'fictional read error'}})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:42}),null)
})
await check('scientific notation actor cannot select a private user row',true,async()=>{
  const h=harness({forceRow:ownerRow('42',PHONE_A)})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:'4.2e1'}),null)
  assert.equal(h.queries.length,0,'malformed owner reached privileged query')
})
await check('negative zero is not a valid owner for private recipient resolution',true,async()=>{
  const h=harness({forceRow:ownerRow('0',PHONE_A)})
  assert.equal(await h.findWhatsAppForReminder({telegram_id:'-0'}),null)
  assert.equal(h.queries.length,0)
})
await check('same trailing ten digits in different countries are NOT an owner receipt',true,async()=>{
  const h=harness({rows:{'42':ownerRow('42',PHONE_A)}})
  assert.equal(await h.reminderGoesToOwner({telegram_id:42},PHONE_UK),false)
})
await check('returned other-owner row cannot establish owner quick-reply eligibility',true,async()=>{
  const h=harness({forceRow:ownerRow('99',PHONE_A)})
  assert.equal(await h.reminderGoesToOwner({telegram_id:42},PHONE_A),false)
})
await check('exact owner B string is retained in private query, never coerced to A',true,async()=>{
  const h=harness({rows:{[B]:ownerRow(B,PHONE_B)}})
  const resolved=await h.findWhatsAppForReminder({telegram_id:B})
  assert.equal(resolved,PHONE_B)
  assert.equal(h.queries.length,1)
  assert.equal(String(h.queries[0].owner),B)
  assert.notEqual(String(h.queries[0].owner),A)
})

// The positive exact-B contract above may already pass. Failure means mandatory hazards remain.
console.log('REMINDER RECIPIENT OWNER: '+controlsPass+' controls passed, '+controlsFail+
  ' controls failed; '+mandatoryPass+' mandatory passed, '+mandatoryFail+
  ' mandatory failed; NO REAL SENDS/DB/NETWORK')
if (controlsFail) process.exitCode=2
else if (mandatoryFail) process.exitCode=1
