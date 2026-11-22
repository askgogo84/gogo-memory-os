// 22 Nov: owner-confirmed phone in a second message only prepares a new plan.
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const v=await import('../lib/agent/voice-call')
const now=Date.now(),owner='-1234567890123'
const request='call Naturals Salon Rajajinagar and book a haircut for Nithin tomorrow at 6pm'
const prompt="To call Naturals Salon Rajajinagar, please reply with the correct Indian business phone number. I won't search the web for a number or place a call."
const st={type:'followup_state',kind:v.CALL_NUMBER_STATE,created_at:new Date(now-10_000).toISOString(),
  payload:{owner,original:request,prompt}}
const next=v.generalCallFromNumberReply(st,'080 2345 6789',prompt,owner,now)
assert.equal(next,'call Naturals Salon Rajajinagar on +918023456789 and book a haircut for Nithin tomorrow at 6pm')
assert.equal(v.splitCallAsk(next)?.phone,'+918023456789')
assert.equal(v.isTableAsk(v.splitCallAsk(next)?.ask||''),false)
assert.equal(v.parseCallCommand(next)?.kind,'book')
assert.equal(v.callNumberReply('080 2345 6789'),'+918023456789')
const named={...st,payload:{...st.payload,original:'call Naturals Salon Rajajinagar and book a haircut tomorrow at 6pm under the name Nithin'}}
const namedNext=v.generalCallFromNumberReply(named,'080 2345 6789',prompt,owner,now)
assert.equal(v.callBookingName(namedNext),'Nithin','the explicit recipient is preserved across the phone-number step')

for(const bad of [
 '080 2345 6789 or 080 2345 6780','123456','080 2345 6789 and pay me',
 '1800 100 1000','+44 2071231234',''+String(123456789012345),
]){
 assert.equal(v.callNumberReply(bad),null,bad)
}
for(const [why,state,reply,last,own,at] of [
 ['old',{...st,created_at:new Date(now-11*60_000).toISOString()},'080 2345 6789',prompt,owner,now],
 ['different owner',st,'080 2345 6789',prompt,'-999',now],
 ['not latest',st,'080 2345 6789','How can I help?',owner,now],
 ['malformed',st,'080 23',prompt,owner,now],
 ['forged prompt',{...st,payload:{...st.payload,prompt:'other'}},'080 2345 6789',prompt,owner,now],
 ['table',{...st,payload:{...st.payload,original:'call Toit and book a table for 2 Friday 8pm'}},'080 2345 6789',prompt,owner,now],
 ['family',{...st,payload:{...st.payload,original:'call mom and ask about lunch'}},'080 2345 6789',prompt,owner,now],
 ['garbled source',{...st,payload:{...st.payload,original:'Some random text'}},'080 2345 6789',prompt,owner,now],
] as const)assert.equal(v.generalCallFromNumberReply(state,reply,last,own,at),null,why)
const queries:any[]=[]
function fakeDb(rows:any[],last:any){
 return {from(table:string){
   let key:any
   const q:any={select(){return q},eq(k:string,value:any){if(k==='telegram_id')key=value;return q},
     order(){return q},limit(){return Promise.resolve({data:table==='memories'?rows:last,error:null})}}
   queries.push({table,getOwner:()=>key})
   return q
 }}
}
const stateRow={content:JSON.stringify(st)}
const observed=await v.confirmedGeneralCallNumberRequest(owner,'080 2345 6789',fakeDb([stateRow],[{role:'assistant',content:prompt}]) as any)
assert.equal(observed,next)
assert.ok(queries.length===2 && queries.every(q=>q.getOwner()===owner),'owner is queried as an exact string, including a negative ID')
assert.equal(await v.confirmedGeneralCallNumberRequest(owner,'080 2345 6789',fakeDb([stateRow],[{role:'user',content:'different topic'}]) as any),null)
assert.equal(await v.confirmedGeneralCallNumberRequest(owner,'080 2345 6789',fakeDb([stateRow],[{role:'assistant',content:'new question'}]) as any),null)
const source=readFileSync('lib/agent/voice-call.ts','utf8')
assert.match(source,/if\(numberFollowup\) await fs\.clearFollowupState\(tg,CALL_NUMBER_STATE\)/)
assert.match(source,/callBookingName\(numberFollowup \|\| params\.text\)/,'guest name is read from the original approved request, not just phone-number reply')
assert.match(source,/saveFollowupState\(tg,CALL_NUMBER_STATE/)
assert.match(source,/CALL PLAN · NEEDS YOUR YES/)
const dash=readFileSync('app/api/dashboard/chat/route.ts','utf8'),wa=readFileSync('app/api/webhooks/whatsapp/route.ts','utf8')
for(const route of [dash,wa]){
 const idx=route.indexOf('isGeneralCallNumberReply(')
 assert.ok(idx>0&&idx<route.indexOf("import('@/lib/agent/brain')"),'phone reply handled before the model')
 assert.match(route.slice(idx,idx+700),/tryVoiceCall/)
}
assert.match(wa.slice(wa.indexOf('An owner-confirmed phone reply'),wa.indexOf('// 21 Nov: "run a self-diagnostic"')),/!forwardedMessage&&!preserveFriendFlow&&!approvalIntent\(text\)/)
console.log('PASS: owner-verified two-message phone -> plan; cross-owner, stale, unrelated, forwarded and invalid numbers refused; no calls')
