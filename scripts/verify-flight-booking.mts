import assert from 'node:assert/strict'
process.env.ANTHROPIC_API_KEY ||= 'test'
const b = await import('../lib/agent/flight-booking.ts')
const r = b.flightBookingRequest
assert.deepEqual(r('book the cheapest'), {kind: 'cheapest'})
assert.deepEqual(r('Yes go ahead and book the cheapest one'), {kind: 'cheapest'})
assert.deepEqual(r('book #2'), {kind: 'number', n: 2})
assert.deepEqual(r('book option 3'), {kind: 'number', n: 3})
assert.deepEqual(r('please book the second one'), {kind: 'number', n: 2})
assert.deepEqual(r('book the non-stop'), {kind: 'nonstop'})
assert.deepEqual(r('book it'), {kind: 'pick'})
for (const no of ['book a table at Toit', 'book a cab to airport', 'book a hotel in Singapore', 'book a doctor appointment', 'book https://x.com/a', 'what is the weather', 'I booked already']) assert.equal(r(no), null, no)
const p = b.parseTravellers('Asha Rao, 12 Mar 1985\nRavi Kumar S 03/11/1990', new Date('2026-10-17'))
assert.deepEqual(p.travellers, [{name: 'Asha Rao', dob: '12 Mar 1985'}, {name: 'Ravi Kumar S', dob: '3 Nov 1990'}])
assert.equal(p.problems.length, 0)
assert.equal(b.parseTravellers('Asha, 12 Mar 1985').problems.length, 1, 'single name refused')
assert.equal(b.parseTravellers('Asha Rao').problems.length, 1, 'missing dob refused')
assert.equal(b.parseTravellers('Asha Rao 31 Feb 1985').problems.length, 1, 'impossible date refused')
assert.equal(b.parseTravellers('Asha Rao 12 Mar 2030', new Date('2026-10-17')).problems.length, 1, 'future dob refused')
const context: any = {origin: {code: 'BLR'}, destination: {code: 'SIN'}, startDate: '2026-10-28', returnDate: '2026-11-02', cabin: 'economy', adults: 1}
const option: any = {airline: 'Air India', departure: '7:00 PM', stops: 1, fareInr: 28443}
const obj = b.flightBookingObjective({context, option, travellers: p.travellers.slice(0, 1)})
assert.ok(obj.length < 1700)
assert.match(obj, /never pay, never enter card, UPI or bank details, never press Pay/)
assert.match(obj, /more than 10% above/)
assert.match(obj, /Asha Rao/)
const { readFileSync } = await import('node:fs')
const src = readFileSync('lib/agent/flight-booking.ts', 'utf8')
assert.match(src, /approvalAction: 'booking' as const, flow: 'provider_booking'/, 'goes through the approved provider_booking path')
assert.match(src, /Reply \*APPROVE\*/)
assert.doesNotMatch(src, /console\.log/, 'no passenger data in logs')
// 18 Oct: one-way results can be booked too.
const oneWayObj = b.flightBookingObjective({context: {origin: {code: 'BLR'}, destination: {code: 'DEL'}, startDate: '2026-11-06', cabin: 'economy', adults: 1}, option: {airline: 'Air India Express', departure: '9:15 PM', stops: 1, fareInr: 14448} as any, travellers: p.travellers.slice(0, 1)})
assert.match(oneWayObj, /one-way BLR to DEL, depart 2026-11-06, 1 adult/); assert.doesNotMatch(oneWayObj, /return/)
assert.match(src, /oneWayDisplayOrder\(flights/, 'a one-way result is booked from the list the person saw')
console.log('flight booking ok')

// 26 Oct (owner): domestic flights need the name as on any government photo ID; passport + date of birth only abroad.
{
  const dom = { origin: { code: 'BLR' }, destination: { code: 'DEL' } }, intl = { origin: { code: 'BLR' }, destination: { code: 'SIN' } }
  assert.equal(b.isDomesticIndiaTrip(dom), true)
  assert.equal(b.isDomesticIndiaTrip(intl), false)
  assert.equal(b.isDomesticIndiaTrip({}), false, 'unknown route is treated as international (stricter)')
  const now = new Date('2026-10-26')
  const d1 = b.parseTravellers('Goverdhan Mandyam Dommane', now, { domestic: true })
  assert.deepEqual(d1, { travellers: [{ name: 'Goverdhan Mandyam Dommane' }], problems: [] }, 'domestic: name only, no date of birth')
  const d2 = b.parseTravellers('Asha Rao, 12 Mar 1985', now, { domestic: true })
  assert.equal(d2.travellers[0].dob, '12 Mar 1985', 'a date of birth given anyway is kept')
  const d3 = b.parseTravellers('Goverdhan 12 march 1984', now, { domestic: true })
  assert.equal(d3.travellers.length, 0)
  assert.match(d3.problems[0], /as on your government photo ID/)
  assert.doesNotMatch(d3.problems[0], /passport/, 'no passport wording for a domestic trip')
  assert.match(d3.problems[0], /single name Goverdhan/, 'tells a one-name person exactly what to send')
  assert.deepEqual(b.parseTravellers('single name Goverdhan', now, { domestic: true }).travellers, [{ name: 'Goverdhan' }])
  assert.equal(b.parseTravellers('single name Goverdhan', now).travellers.length, 0, 'abroad: passport name and date of birth still required')
  assert.match(b.parseTravellers('Goverdhan, 12 Mar 1984', now).problems[0], /as on the passport/)
  const objDom = b.flightBookingObjective({ context: { ...dom, startDate: '2026-11-20', cabin: 'economy', adults: 1 }, option: { airline: 'Air India', departure: '12:15 AM', stops: 0, fareInr: 10327 } as any, travellers: d1.travellers })
  assert.match(objDom, /traveller 1: full name Goverdhan Mandyam Dommane\./)
  assert.doesNotMatch(objDom, /date of birth undefined/)
}


// 23 Nov: the booking re-ask and pending-approval conversation reads must not
// round a signed BIGINT owner through JS Number before their service-role lookup.
// Execute the actual private functions with an inert in-memory Supabase substitute.
{
  const { createRequire } = await import('node:module')
  const { runInNewContext } = await import('node:vm')
  const ts = createRequire(import.meta.url)('typescript')
  const tree = ts.createSourceFile('flight-booking.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const names = new Set(['exactBookingConversationOwner', 'previousUserMessage', 'loadPending'])
  const functions = tree.statements
    .filter((node: any) => ts.isFunctionDeclaration(node) && names.has(node.name?.text))
    .map((node: any) => node.getText(tree))
  assert.equal(functions.length, names.size, 'test must execute all three real source functions')
  assert.doesNotMatch(functions.join('\n'), /Number\s*\(\s*actor\.legacyTelegramId\s*\)/)
  const compiled = ts.transpileModule(functions.join('\n\n') +
    '\nmodule.exports = {previousUserMessage,loadPending,exactBookingConversationOwner};',
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const A = '9223372036854775806', B = '9223372036854775807'
  const conversations = [
    ...[A, B, '-9223372036854775808', '123'].flatMap((owner, index) => [
      {telegram_id: owner, role: 'user', content: 'New details', created_at: '2026-11-23T00:01:00Z'},
      {telegram_id: owner, role: 'user', content: 'Prior details '+index, created_at: '2026-11-23T00:00:00Z'},
    ]),
  ]
  function harness(raw: unknown) {
    const reads: Array<{table:string;filters:[string,unknown][]}> = []
    const supabaseAdmin = { from(table: string) {
      assert.equal(table, 'conversations', 'no unrelated private reads')
      const filters: [string,unknown][] = []
      let limit = 100
      const q: any = {
        select: () => q,
        eq: (key: string, val: unknown) => {filters.push([key,val]);return q},
        order: () => q,
        limit: (n: number) => {limit=n;return q},
        then: (resolve: any, reject: any) => {
          reads.push({table, filters:filters.map(pair=>[...pair] as [string,unknown])})
          const data = conversations
            .filter(row=>filters.every(([key,val])=>String((row as any)[key])===String(val)))
            .slice(0,limit)
          return Promise.resolve({data,error:null}).then(resolve,reject)
        },
      }
      return q
    }}
    const sandbox: any = {module:{exports:{}}, supabaseAdmin, Number, String, BigInt, Date, Promise,
      norm:(text:unknown)=>String(text||'').trim().toLowerCase()}
    runInNewContext(compiled,sandbox,{timeout:1000})
    const actor = {legacyTelegramId:raw,userId:'inert',whatsappId:'',name:'Fixture'}
    return {functions:sandbox.module.exports,actor,reads}
  }
  for(const [owner,expected] of [[A,'Prior details 0'],[B,'Prior details 1'],['-9223372036854775808','Prior details 2'],[123,'Prior details 3']] as const){
    const h=harness(owner)
    assert.equal(await h.functions.previousUserMessage(h.actor,'New details'),expected, 'owner '+String(owner))
    assert.equal(h.reads.length,1)
    assert.deepEqual(JSON.parse(JSON.stringify(h.reads[0].filters)),[['telegram_id',String(owner)],['role','user']])
    const pending=harness(owner)
    assert.equal(await pending.functions.loadPending(pending.actor,'Yes'),null,'no prior assistant offer')
    assert.deepEqual(JSON.parse(JSON.stringify(pending.reads[0].filters)),[['telegram_id',String(owner)]])
  }
  for(const invalid of [Number(B),'00123','+123','123abc','9223372036854775808','-9223372036854775809',0,NaN,null,{}]){
    const h=harness(invalid)
    assert.equal(await h.functions.previousUserMessage(h.actor,'New details'),null)
    assert.equal(await h.functions.loadPending(h.actor,'Yes'),null)
    assert.equal(h.reads.length,0,'invalid or rounded owner must have ZERO private reads: '+String(invalid))
  }
  console.log('✓ flight booking conversation re-ask + pending: exact signed BIGINT owner; rounded/malformed owner denied before reads')
}
