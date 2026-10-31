// TEST ONLY — real, unchanged mobile link parser + approval implementation.
// Synthetic pairing code, user identities and an in-memory database. No network or sessions.
// Mandatory integration negatives are EXPECTED RED until reviewed ingress wiring exists.
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, extname, relative } from 'node:path'
import { createHash } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const target = 'lib/mobile-auth/link.ts'
const raw = readFileSync(target, 'utf8')
const ast = ts.createSourceFile(target, raw, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
const wanted = ['sha256', 'normalizeMobileLinkCode', 'parseMobileLinkCommand', 'approveMobileLink']
const actual = wanted.map(name => ast.statements.find(s =>
  ts.isFunctionDeclaration(s) && s.name?.text === name))
for (let i = 0; i < wanted.length; i++) {
  assert.ok(actual[i]?.body, 'Original mobile link function missing: ' + wanted[i])
}
const code = ts.transpileModule(actual.map(fn => fn.getText(ast)).join('\n\n'), {
  fileName: target,
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText

const syntheticCode = 'ABCD-1234'
const normalizedCode = 'ABCD1234'
const hash = createHash('sha256').update(normalizedCode).digest('hex')
const fictionalOwner = 'own_fixture_uuid_only'
const fictionalWa = 'whatsapp:+19995550102'
const future = () => new Date(Date.now() + 300_000).toISOString()
const past = () => new Date(Date.now() - 300_000).toISOString()

function harness({status='pending',expiresAt=future()}={}) {
  const records = [{id:'synthetic_request_1',code_hash:hash,status,expires_at:expiresAt}]
  const queries = []
  const supabaseAdmin = { from(table) {
    assert.equal(table, 'mobile_link_requests')
    return { update(values) {
      const filters = []
      return {
        eq(field,value) { filters.push({op:'eq',field,value}); return this },
        gt(field,value) { filters.push({op:'gt',field,value}); return this },
        select() { return this },
        async maybeSingle() {
          queries.push({filters:[...filters],update:{...values}})
          const row = records.find(r => filters.every(f =>
            f.op === 'eq' ? String(r[f.field]) === String(f.value)
              : String(r[f.field]) > String(f.value)))
          if (!row) return {data:null,error:null}
          Object.assign(row,values)
          return {data:{id:row.id},error:null}
        },
      }
    }}
  }}
  const exports = {}
  vm.runInNewContext(code, {
    exports, supabaseAdmin, createHash, Date, Number, String, Boolean, Error,
    Promise, console,
  }, {timeout:2000,filename:target})
  assert.equal(typeof exports.parseMobileLinkCommand,'function')
  assert.equal(typeof exports.approveMobileLink,'function')
  return {parse:exports.parseMobileLinkCommand,approve:exports.approveMobileLink,records,queries}
}

const h = harness()
const accepted = await h.approve({
  code:syntheticCode,userId:fictionalOwner,whatsappId:fictionalWa,
})
const second = await h.approve({
  code:syntheticCode,userId:fictionalOwner,whatsappId:fictionalWa,
})
const expired = harness({expiresAt:past()})
const expiredResult = await expired.approve({
  code:syntheticCode,userId:fictionalOwner,whatsappId:fictionalWa,
})
const wrong = harness()
const wrongResult = await wrong.approve({
  code:'WXYZ-5678',userId:fictionalOwner,whatsappId:fictionalWa,
})

function sourceFiles(dir) {
  const files = []
  for (const entry of readdirSync(dir,{withFileTypes:true})) {
    if (entry.name === 'node_modules' || entry.name === '.next') continue
    const child = join(dir,entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(child))
    else if (entry.isFile() && ['.ts','.tsx','.js','.mjs'].includes(extname(child))) {
      files.push(child)
    }
  }
  return files
}
// No source file may be added or edited by this diagnostic PR. Find actual
// production callsites, not docs, test scripts, or the module's own declarations.
const appSources = [...sourceFiles('app'),...sourceFiles('lib')]
  .filter(name => relative('.',name).replaceAll('\\','/') !== target)
const callers = name => appSources.filter(file => {
  const content = readFileSync(file,'utf8')
  return new RegExp('\\b' + name + '\\s*\\(').test(content)
}).map(file => relative('.',file).replaceAll('\\','/'))
const parserCallers = callers('parseMobileLinkCommand')
const approvalCallers = callers('approveMobileLink')

let controlPass=0,controlFail=0,safetyPass=0,safetyFail=0
async function check(kind,label,fn) {
  try {
    await fn()
    if (kind === 'control') controlPass++; else safetyPass++
    console.log('PASS ' + kind + ': ' + label)
  } catch (e) {
    if (kind === 'control') controlFail++; else safetyFail++
    console.error('FAIL ' + kind + ': ' + label + ' (' +
      String(e?.message||e).slice(0,180) + ')')
  }
}
await check('control','unchanged LINK parser recognizes the displayed fictional code', () => {
  assert.equal(h.parse('LINK ' + syntheticCode),normalizedCode)
  assert.equal(h.parse('link gogo-' + syntheticCode),normalizedCode)
})
await check('control','unrelated commands and trailing text do not become LINK codes', () => {
  assert.equal(h.parse('connect calendar'),null)
  assert.equal(h.parse('LINK ' + syntheticCode + ' now'),null)
  assert.equal(h.parse(''),null)
})
await check('control','original approval writes owner and sender only on pending exact hash', () => {
  assert.equal(accepted,true)
  assert.equal(h.records[0].status,'approved')
  assert.equal(h.records[0].user_id,fictionalOwner)
  assert.equal(h.records[0].whatsapp_id,fictionalWa)
  assert.ok(h.queries[0].filters.some(f => f.field==='code_hash' && f.value===hash))
  assert.ok(h.queries[0].filters.some(f => f.field==='status' && f.value==='pending'))
  assert.ok(h.queries[0].filters.some(f => f.field==='expires_at' && f.op==='gt'))
  assert.ok(!h.queries[0].update.code_hash, 'raw linking code must never be persisted here')
})
await check('control','duplicate approval is rejected by pending-status state gate', () => {
  assert.equal(second,false)
  assert.equal(h.records[0].status,'approved')
})
await check('control','expired and wrong fictional code cannot be approved', () => {
  assert.equal(expiredResult,false)
  assert.equal(wrongResult,false)
  assert.equal(expired.records[0].status,'pending')
  assert.equal(wrong.records[0].status,'pending')
})
await check('control','source scan covers genuine app and bot files, not fixture scripts', () => {
  assert.ok(appSources.length>30)
  assert.ok(appSources.some(p=>p.startsWith('lib/bot/')))
  assert.ok(appSources.some(p=>p.startsWith('app/api/')))
})
await check('mandatory','production WhatsApp ingress must call the original LINK parser', () => {
  assert.ok(parserCallers.length>0,
    'no production caller of parseMobileLinkCommand exists outside link.ts')
})
await check('mandatory','production WhatsApp ingress must invoke owner-bound LINK approval', () => {
  assert.ok(approvalCallers.length>0,
    'no production caller of approveMobileLink exists outside link.ts')
})
await check('mandatory','LINK parsing and approval must be wired in a shared reachable ingress path', () => {
  const paths=parserCallers.filter(p=>approvalCallers.includes(p))
  assert.ok(paths.length>0,
    'no single production module uses both parser and state-gated approval; require trusted inbound actor binding and priority checks')
})
console.log('CALLSITES parser=' + JSON.stringify(parserCallers) +
  ' approval=' + JSON.stringify(approvalCallers))
console.log('RESULT controls_pass=' + controlPass + '/6 controls_fail=' + controlFail +
  ' mandatory_pass=' + safetyPass + '/3 mandatory_fail=' + safetyFail)
if (controlFail) process.exit(2)
if (safetyFail) process.exit(1)
