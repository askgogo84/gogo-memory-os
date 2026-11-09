// SECURITY REGRESSION / NO PROVIDER CALLS: execute current production daily briefing cron with fictional identities.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const path = 'app/api/cron/daily-briefings/route.ts'
const src = fs.readFileSync(path, 'utf8')
const ast = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
const original = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'runDelivery')
assert.ok(original, 'the real unchanged production runDelivery is required')
const compiled = ts.transpileModule(original.getText(ast), {
  compilerOptions: {module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022},
}).outputText

const A = '9007199254740992'
const B = '9007199254740993'
const PHONE = '+911234500000'
const EMAIL = 'fixture@example.invalid'
function user(id, mode = 'whatsapp', extra = {}) {
  return {
    telegram_id: id, name: 'Fictional Person', whatsapp_id: mode === 'whatsapp' ? PHONE : '',
    email: mode === 'email' ? EMAIL : '', briefing_enabled: mode === 'whatsapp',
    daily_brief_email_enabled: mode === 'email', briefing_time: '08:00', weekly_brief: false, ...extra,
  }
}
function fixture(opts = {}) {
  const rows = opts.rows ?? [user('42')]
  const freshRows = opts.freshRows ?? rows
  const fresh = new Map(freshRows.map(row => [String(row.telegram_id), row]))
  const queries = [], deliveryAttempts = [], privateBriefReads = [], transports = [], unsubscribeOwners = [], cursorSaves = []
  let scans = 0
  const db = {
    from(table) {
      assert.ok(['users', 'delivery_scan_cursors', 'daily_brief_email_log'].includes(table), 'unexpected table ' + table)
      const queryArgs = {}
      const q = {
        select(cols) { queryArgs.select = cols; return q },
        eq(column, value) { queryArgs[column] = value; return q },
        or() { return q },
        gt(column, value) { queryArgs['gt_' + column] = value; return q },
        order() { return q },
        limit() {
          assert.equal(table, 'users', 'unexpected list table ' + table)
          queries.push({table,kind:'scan',...queryArgs})
          const data = scans++ === 0 ? rows : []
          return Promise.resolve({data, error: opts.scanError ?? null})
        },
        maybeSingle() {
          queries.push({table,kind:'single',...queryArgs})
          if (table === 'delivery_scan_cursors')
            return Promise.resolve({data: {cursor_value: opts.savedCursor ?? Number.MIN_SAFE_INTEGER}, error: null})
          if (table === 'users')
            return Promise.resolve({data: opts.forceFreshRow ?? fresh.get(String(queryArgs.telegram_id)) ?? null, error: opts.freshError ?? null})
          return Promise.resolve({data: null, error: null})
        },
        insert(row) {
          queries.push({table,kind:'insert',row})
          return Promise.resolve({error:null})
        },
        upsert(row) {
          assert.equal(table, 'delivery_scan_cursors')
          cursorSaves.push(row)
          return Promise.resolve({error:null})
        },
      }
      return q
    },
  }
  const context = {
    // Synthetic inert key only to reach the mocked email-send branch; no real provider I/O.
    process:{env:{RESEND_API_KEY:'fictional-unusable-test-key'}},
    Date, Number, String, Math, console, supabaseAdmin:db,
    nowIstParts:() => ({date:'2026-11-01',hour:10,minute:0}),
    reconcileBriefingEmailReceipts:async()=>0,
    shouldRunForTime:()=>true,
    normalizePhone: v=>String(v??'').replace(/^whatsapp:/,'').trim(),
    alreadyWhatsappSentToday:async()=>false,
    alreadyEmailSentToday:async()=>false,
    markWhatsappSentToday:async()=>{},
    buildMorningBriefing:async owner=>{
      privateBriefReads.push(owner)
      return 'FICTIONAL_PRIVATE_BRIEF_FOR_' + owner
    },
    buildThrowbackLine:async()=>null,
    weekAheadSummary:async()=>null,
    firstName:v=>String(v||'there').split(/\s+/)[0],
    isSuppressed:async()=>false,
    buildDailyBriefUnsubscribeUrl:(owner,email)=>{
      unsubscribeOwners.push({owner,email})
      return 'https://fixture.invalid/unsubscribe/' + encodeURIComponent(String(owner))
    },
    renderDailyBriefEmail:({briefing})=>({
      subject:'FICTIONAL_BRIEF',html:'<p>'+briefing+'</p>',text:briefing,
    }),
    sendWhatsApp:async (phone,message,_unused,token)=>{
      transports.push({channel:'whatsapp',phone,message,token})
      return {sid:'fictional-whatsapp-accepted'}
    },
    sendAskGogoEmail:async input=>{
      transports.push({channel:'email',...input})
      return {ok:true,id:'fictional-email-accepted'}
    },
    deliverNotification:async args=>{
      deliveryAttempts.push({owner:args.owner,key:args.key,channel:args.channel})
      if (!await args.ready()) return 'suppressed'
      await args.prepare()
      const result = await args.send('fictional-token')
      if (args.accepted) await args.accepted(String(result))
      return 'provider_accepted'
    },
    NextResponse:{json:(payload,options)=>({payload,status:options?.status??200})},
  }
  const run = vm.runInNewContext(compiled + '\nrunDelivery', context, {timeout:1000})
  assert.equal(typeof run,'function')
  return {run:()=>run({url:'https://fixture.invalid/cron'}),queries,deliveryAttempts,privateBriefReads,
    transports,unsubscribeOwners,cursorSaves}
}
async function quietRun(h) {
  try {return {result:await h.run(),error:null}} catch(error){return {result:null,error}}
}
let cp=0,cf=0,mp=0,mf=0
async function check(title, mandatory, fn) {
  try {
    await fn()
    if (mandatory) mp++; else cp++
    console.log('PASS ['+(mandatory?'MANDATORY':'CONTROL')+'] '+title)
  } catch(error) {
    if (mandatory) mf++; else cf++
    console.error('FAIL ['+(mandatory?'MANDATORY':'CONTROL')+'] '+title+': '+(error?.message||error))
  }
}
await check('positive safe owner receives only fictional test transport and exact private summary',false,async()=>{
  const h=fixture(),r=await h.run()
  assert.equal(r.payload.checked,1)
  assert.equal(h.transports.length,1)
  assert.equal(h.privateBriefReads[0],42)
  assert.equal(h.deliveryAttempts[0].owner,42)
})
await check('valid negative WhatsApp owner retains signed safe identity',false,async()=>{
  const h=fixture({rows:[user('-42')]})
  await h.run()
  assert.equal(h.transports.length,1)
  assert.equal(h.privateBriefReads[0],-42)
  assert.equal(h.deliveryAttempts[0].owner,-42)
})
await check('valid negative safe email owner retains its unsubscribe identity',false,async()=>{
  const h=fixture({rows:[user('-42','email')]})
  await h.run()
  assert.equal(h.transports.length,1)
  assert.equal(h.transports[0].channel,'email')
  assert.equal(h.unsubscribeOwners[0].owner,-42)
})
await check('no eligible users means zero attempted or fabricated transport',false,async()=>{
  const h=fixture({rows:[]}),r=await h.run()
  assert.equal(r.payload.checked,0)
  assert.equal(h.deliveryAttempts.length,0)
  assert.equal(h.transports.length,0)
})
await check('both briefing channels disabled cause no send',false,async()=>{
  const h=fixture({rows:[user('42','whatsapp',{briefing_enabled:false,daily_brief_email_enabled:false})]})
  await h.run()
  assert.equal(h.transports.length,0)
  assert.equal(h.privateBriefReads.length,0)
})
await check('changed recipient fails destination recheck, never calling fake transport',false,async()=>{
  const h=fixture({rows:[user('42')],freshRows:[user('42','whatsapp',{whatsapp_id:'+911234500001'})]})
  await h.run()
  assert.equal(h.transports.length,0)
  assert.equal(h.privateBriefReads.length,0)
})
await check('synthetic user scan outage fails closed without delivery',false,async()=>{
  const h=fixture({scanError:{message:'fixture-database-down'}}),r=await h.run()
  assert.equal(r.status,503)
  assert.equal(h.transports.length,0)
})

// MANDATORY OWNER-BOUNDARY REGRESSIONS. Must pass against this proposed fix.
// All delivery, emails and private data below are strictly fictional intercepted JS stubs.
await check('adjacent signed int64 B cannot enter owner-A briefing delivery ledger',true,async()=>{
  const h=fixture({rows:[user(B)],freshRows:[user(A)]})
  await quietRun(h)
  assert.ok(!h.deliveryAttempts.some(x=>String(x.owner)===A),'owner B became owner A in delivery ledger')
})
await check('owner B must never read owner-A personalized private briefing',true,async()=>{
  const h=fixture({rows:[user(B)],freshRows:[user(A)]})
  await quietRun(h)
  assert.ok(!h.privateBriefReads.some(x=>String(x)===A),'B request read A private personalized briefing')
})
await check('owner B cannot claim owner-A idempotency key',true,async()=>{
  const h=fixture({rows:[user(B)],freshRows:[user(A)]})
  await quietRun(h)
  assert.ok(!h.deliveryAttempts.some(x=>x.key.includes('/'+A+'/')),'owner-B queue used owner-A key')
})
await check('owner B scan cursor must preserve exact distinct owner identity',true,async()=>{
  const h=fixture({rows:[user(B)]})
  await quietRun(h)
  const nextScan=h.queries.filter(x=>x.table==='users'&&x.kind==='scan').at(-1)
  assert.ok(nextScan,'expected a second scan after the fictional owner')
  assert.notEqual(String(nextScan.gt_telegram_id),A,'owner B advanced queue cursor as owner A')
})
await check('owner B recheck query must never fetch owner A',true,async()=>{
  const h=fixture({rows:[user(B)]})
  await quietRun(h)
  assert.ok(!h.queries.some(x=>x.table==='users'&&x.kind==='single'&&String(x.telegram_id)===A),
    'recipient consent recheck used aliased owner')
})
await check('fictional owner B must not receive a private briefing assembled from A',true,async()=>{
  const h=fixture({rows:[user(B)],freshRows:[user(A)]})
  await quietRun(h)
  assert.ok(!h.transports.some(x=>String(x.message||'').includes('PRIVATE_BRIEF_FOR_'+A)),
    'outbound stub contained A private briefing')
})
await check('owner B email unsubscribe token cannot encode owner A',true,async()=>{
  const h=fixture({rows:[user(B,'email')],freshRows:[user(A,'email')]})
  await quietRun(h)
  assert.ok(!h.unsubscribeOwners.some(x=>String(x.owner)===A),'B recipient got owner-A unsubscribe token')
})
await check('scientific-notation stored owner must be rejected before any privileged attempt',true,async()=>{
  const h=fixture({rows:[user('4.2e1')],freshRows:[user('42')]})
  await quietRun(h)
  assert.equal(h.deliveryAttempts.length,0,'malformed identity entered delivery ledger')
  assert.equal(h.privateBriefReads.length,0)
})
await check('already-rounded unsafe numeric owner must never reach queue/provider stubs',true,async()=>{
  const h=fixture({rows:[user(9007199254740992)],freshRows:[user(A)]})
  await quietRun(h)
  assert.equal(h.deliveryAttempts.length,0,'unsafe numeric actor was accepted')
  assert.equal(h.transports.length,0)
})
await check('adjacent int64 owners must not collide in idempotency keys',true,async()=>{
  const h=fixture({rows:[user(A),user(B)],freshRows:[user(A)]})
  await quietRun(h)
  const keys=h.deliveryAttempts.map(x=>x.key)
  assert.equal(new Set(keys).size,keys.length,'distinct owners shared a delivery idempotency key')
})
await check('returned mismatched persisted recipient row must not authorize a send',true,async()=>{
  const h=fixture({rows:[user('42')],forceFreshRow:user('99')})
  // The fake database intentionally returns a wrong-owner row for any requested key.
  // The real `users` lookup omits telegram_id from its selection, so test this explicit mismatch
  // using a separate mock that preserves the row but lies about the key.
  await quietRun(h)
  assert.equal(h.transports.length,0,'mismatched owner row authorized send')
})


await check('negative out-of-JS-safe signed int64 is skipped without mixing owners',true,async()=>{
  const h=fixture({rows:[user('-9007199254740993')]})
  await quietRun(h)
  assert.equal(h.deliveryAttempts.length,0)
  assert.equal(h.privateBriefReads.length,0)
  assert.equal(h.transports.length,0)
  const next=h.queries.filter(x=>x.table==='users'&&x.kind==='scan').at(-1)
  assert.equal(String(next?.gt_telegram_id),'-9007199254740993')
})
await check('already-rounded numeric scan cursor is rejected before private reads',true,async()=>{
  const h=fixture({savedCursor:9007199254740992})
  const r=await h.run()
  assert.equal(r.status,503)
  assert.equal(h.privateBriefReads.length,0)
  assert.equal(h.transports.length,0)
})
await check('noncanonical stored scan cursor is rejected before private reads',true,async()=>{
  const h=fixture({savedCursor:'4.2e1'})
  const r=await h.run()
  assert.equal(r.status,503)
  assert.equal(h.privateBriefReads.length,0)
  assert.equal(h.transports.length,0)
})

console.log('BRIEFING CRON EXACT OWNER: '+cp+' controls passed, '+cf+' controls failed; '+mp+
  ' mandatory passed, '+mf+' mandatory failed; NO REAL SENDS')
if(cf)process.exitCode=2
else if(mf)process.exitCode=1
