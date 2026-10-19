// 20 Oct 02:05–02:40 IST live E2E failures on the dashboard (POST /api/dashboard/chat), prod with #680/#681/#682:
//  X1) "Jailer qr code" → handledBy same-brain → "I don't have access to your BookMyShow or PVR account… The show's
//      tonight at 9:45pm". #681's buildTicketRetrievalReply was wired only into the WhatsApp webhook.
//  X2) "My bookings" at 02:0x IST → same-brain → "*TONIGHT:* Jailer 2 at PVR Orion Mall, 9:45pm IST" (the show was
//      19 Oct 9:45 pm, already over) and "Boss, I already showed your bookings 4 messages back".
// Behavioural checks against the real modules with in-memory stores. No network, no real DB, no sends.
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'
process.env.NEXT_PUBLIC_SUPABASE_URL ||= 'https://fixture.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fixture-only'
process.env.OPENAI_API_KEY ||= 'fixture-only'
process.env.ANTHROPIC_API_KEY ||= 'fixture-only'

const transpile=(file:string)=>ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const failures:string[]=[]
async function check(label:string,fn:()=>unknown){try{await fn();console.log('PASS '+label)}catch(e:any){failures.push(label+': '+(e?.stack||e?.message))}}
const noop=new Proxy({}, {get:(_t,key)=>key==='__esModule'?false:()=>null})
function load(path:string,deps:Record<string,unknown>){
  const exports:any={}
  runInNewContext(transpile(path),{exports,require:(name:string)=>(deps as any)[name]||noop,Date,Intl,console,URL,Request,Response,Buffer,process,setTimeout,clearTimeout,Promise,JSON})
  return exports
}
type Row=Record<string,any>
function memDb(seed:Record<string,Row[]>){
  const reads:Array<{table:string;filters:Array<[string,unknown]>}>=[]
  const inserts:Array<{table:string;rows:any}>=[]
  return {reads,inserts,rpc:async()=>({data:[],error:null}),from:(table:string)=>{
    const filters:Array<[string,unknown]>=[]
    const exec=()=>{reads.push({table,filters});return (seed[table]||[]).filter(r=>filters.every(([k,v])=>String(r[k])===String(v)))}
    const q:any={select:()=>q,eq:(k:string,v:unknown)=>{filters.push([k,v]);return q},order:()=>q,limit:()=>q,not:()=>q,gte:()=>q,in:()=>q,
      insert:(rows:any)=>{inserts.push({table,rows});return Promise.resolve({data:null,error:null})},
      delete:()=>q,update:()=>q,
      maybeSingle:async()=>({data:exec()[0]??null,error:null}),single:async()=>({data:exec()[0]??null,error:null}),
      then:(res:any,rej:any)=>Promise.resolve({data:exec(),error:null}).then(res,rej)}
    return q
  }}
}
function loadAssets(db:any){
  return load('lib/services/asset-memory.ts',{
    '@anthropic-ai/sdk':{default:class{messages={create:async()=>{throw new Error('no model calls')}}}},
    '@/lib/supabase-admin':{supabaseAdmin:db},
    '@/lib/services/document-store':{getDocumentSignedUrl:async(path:string)=>`https://storage.example/${path}?sig=fixture`,storeDocument:async()=>null},
    '@/lib/services/document-links':{createDocumentShortLink:async()=>'tok123',shortLinkUrl:(t:string)=>`https://app.askgogo.in/d/${t}`},
    '@/lib/services/document-summary-privacy':{safeDocumentSummary:(x:string)=>x,redactDocumentMetadata:(x:any)=>x},
    '@/lib/services/embeddings':{embedText:async()=>[0]},
  })
}

const JAILER={id:'le-jailer',telegram_id:'123',event_type:'event',subtype:'movie',title:'Jailer 2',provider:'BookMyShow',location:'PVR Orion Mall',start_at:'2026-10-19T16:15:00.000Z',timezone:'Asia/Kolkata',lifecycle_state:'watching',updated_at:'2026-10-18T10:00:00Z',
  metadata_json:{credential:{documentId:'doc-ticket'}},source_refs:[]}
const TICKET_DOC={id:'doc-ticket',telegram_id:123,doc_type:'image',title:'Image',summary:'PVR Orion Mall M-Ticket, AUDI 04, seats K18–K20',extracted:{},storage_path:'123/ticket.jpg',mime:'image/jpeg',created_at:'2026-10-18T09:00:00Z'}
const SEED={life_events:[JAILER],documents:[TICKET_DOC],users:[{telegram_id:123,whatsapp_id:'wa-123',name:'Owner'},{telegram_id:999,whatsapp_id:'wa-999',name:'Other'}]}

// ───────────────────────── X1: dashboard route answers ticket asks with the saved ticket ─────────────────────────
function loadRoute(sessionTg:string,opts:{understood?:any}={}){
  const db=memDb(SEED)
  const assets=loadAssets(db)
  const calls:string[]=[]
  const route=load('app/api/dashboard/chat/route.ts',{
    'crypto':nodeCrypto,
    'next/server':{NextResponse:{json:(body:any,init?:any)=>({body,status:init?.status||200})}},
    '@/lib/dashboard/session':{getSession:async()=>({telegramId:sessionTg})},
    '@/lib/supabase-admin':{supabaseAdmin:db},
    '@/lib/agent/actor':{resolveAgentActor:async(p:any)=>({legacyTelegramId:Number(p.telegramId),userId:'u',whatsappId:'w',surface:p.surface})},
    '@/lib/agent/understand-first':{tryUnderstandFirst:async()=>{calls.push('understand-first');return opts.understood||null}},
    '@/lib/services/asset-memory':assets,
    '@/lib/bot/process-message':{processIncomingMessage:async()=>{calls.push('same-brain');return {text:"I don't have access to your BookMyShow or PVR account. The show's tonight at 9:45pm."}}},
    '@/lib/feature-intents':{routeFeatureIntent:async()=>{calls.push('feature-intent');return null}},
    '@/lib/agent/shadow-router-outcome':{recordShadowRouterOutcome:async()=>null},
    '@/lib/agent/decision-learning':{recordDecisionLearning:async()=>null},
  })
  const post=(text:string)=>route.POST({headers:{get:(k:string)=>k==='origin'?'https://app.askgogo.in':null},nextUrl:{host:'app.askgogo.in'},json:async()=>({text})})
  return {post,db,calls}
}

await check('X1: dashboard "Jailer qr code" returns the saved Jailer 2 ticket with the image, not same-brain prose',async()=>{
  const {post,db,calls}=loadRoute('123')
  const r=await post('Jailer qr code')
  assert.equal(r.status,200)
  assert.equal(r.body.handledBy,'ticket-retrieval')
  assert.match(r.body.text,/^🎟️ Jailer 2 — 19 Oct, 9:45pm, PVR Orion Mall\n📎 Image/)
  assert.match(r.body.text,/Open original: https:\/\/app\.askgogo\.in\/d\/tok123/)
  assert.equal(r.body.mediaUrl,'https://storage.example/123/ticket.jpg?sig=fixture')
  assert.equal(r.body.mediaType,'image/jpeg')
  assert.doesNotMatch(r.body.text,/don't have access|tonight/i)
  assert.ok(!calls.includes('same-brain'),'never reaches the model')
  assert.ok(db.reads.filter(x=>['life_events','documents'].includes(x.table)).every(x=>x.filters.some(([k,v])=>k==='telegram_id'&&String(v)==='123')),'every ticket read is owner-bound')
  assert.ok(db.inserts.some(x=>x.table==='conversations'),'turn saved to the conversation')
})

await check('X1: owner-bound — another account asking "Jailer qr code" never gets the owner\'s ticket',async()=>{
  const {post,calls}=loadRoute('999')
  const r=await post('Jailer qr code')
  assert.equal(r.body.text,"I don't have a saved ticket or QR for jailer.")
  assert.equal(r.body.mediaUrl??null,null)
  assert.ok(!calls.includes('same-brain'))
})

await check('X1: booking asks are not retrievals on the dashboard; understand-first keeps first refusal',async()=>{
  const {post,calls}=loadRoute('123')
  const r=await post('book tickets for Jailer 2')
  assert.notEqual(r.body.handledBy,'ticket-retrieval')
  const u=loadRoute('123',{understood:{text:'From understand-first',handledBy:'understand-first-retrieve',persisted:false}})
  const r2=await u.post('Jailer qr code')
  assert.equal(r2.body.handledBy,'understand-first-retrieve')
  assert.ok(calls.includes('understand-first'))
})

await check('X1 wiring: the ticket path sits right after understand-first, before every other dashboard handler',()=>{
  const route=readFileSync('app/api/dashboard/chat/route.ts','utf8')
  const u=route.indexOf('if (understoodReply?.text)')
  const t=route.indexOf('await buildTicketRetrievalReply(')
  assert.ok(u>0&&t>u,'after understand-first')
  assert.ok(t<route.indexOf('tryCreateGoldRateWatchFromCommand({actor'),'before the first feature handler')
  assert.ok(t<route.indexOf('await processIncomingMessage({\n      channel'),'before same-brain')
})

// ───────────────────────── X1b: understand-first retrieve_saved_document tries the booking ticket first ─────────────────────────
await check('X1b: understand-first retrieveDocument sends the booking\'s ticket (with image) for a ticket/QR ask',async()=>{
  const db=memDb(SEED)
  const assets=loadAssets(db)
  const uf=load('lib/agent/understand-first.ts',{'@/lib/services/asset-memory':assets,'next/server':{after:()=>{}},'@/lib/supabase-admin':{supabaseAdmin:db}})
  for(const surface of ['web','whatsapp'] as const){
    const h=uf.buildUnderstandFirstHandlers({actor:{legacyTelegramId:123,userId:'u',whatsappId:'w'},surface,externalUserId:'w',messageId:'m1',registryChecked:true})
    const r=await h.retrieveDocument({text:'Jailer qr code',referent:{kind:'ticket',id:'ticket:x',title:'Jailer 2 · PVR Orion Mall'}})
    assert.equal(r.handledBy,'understand-first-retrieve')
    assert.match(r.text,/^🎟️ Jailer 2 — 19 Oct, 9:45pm, PVR Orion Mall/)
    assert.equal(r.mediaUrl,'https://storage.example/123/ticket.jpg?sig=fixture')
    assert.equal(r.mediaType,'image/jpeg')
  }
  // Not a ticket ask: the existing document path is unchanged.
  const h=uf.buildUnderstandFirstHandlers({actor:{legacyTelegramId:123,userId:'u',whatsappId:'w'},surface:'web',externalUserId:'w',messageId:'m1',registryChecked:true})
  const none=await h.retrieveDocument({text:'show my lease agreement',referent:{kind:'document',id:'doc:missing',title:'Lease'}})
  assert.equal(none,null)
})

// ───────────────────────── X2: "my bookings" — deterministic, local times, past never upcoming ─────────────────────────
const mb=await import('../lib/agent/my-bookings')
await check('X2: matcher — whole-message bookings reads only',()=>{
  for(const q of ['My bookings','my bookings','show my bookings','Show me my upcoming bookings?','what are my bookings','list my reservations','what bookings do I have?','my bookings please'])assert.equal(mb.isMyBookingsQuery(q),true,q)
  for(const q of ['book tickets for Jailer 2','cancel my booking','show my bookings on BookMyShow','my booking for Toit is at 8, remind me at 7','Jailer qr code','what are you working on'])assert.equal(mb.isMyBookingsQuery(q),false,q)
})

await check('X2: 02:05 IST 20 Oct — the 19 Oct 9:45 pm Jailer show is under "Earlier" as over, never tonight/upcoming',()=>{
  const now=Date.parse('2026-10-19T20:35:00Z')
  const dinner={id:'le-d',event_type:'reservation',subtype:'restaurant',title:'Dinner at Toit',location:'Indiranagar',start_at:'2026-10-20T14:30:00Z',timezone:'Asia/Kolkata',lifecycle_state:'captured'}
  const old={id:'le-o',event_type:'event',title:'Old concert',start_at:'2026-10-17T14:30:00Z',lifecycle_state:'watching'}
  const undated={id:'le-u',event_type:'reservation',title:'Reserve Toit Indiranagar',start_at:null,lifecycle_state:'planned'}
  const bill={id:'le-b',event_type:'bill',title:'Electricity bill',start_at:'2026-10-21T04:30:00Z',lifecycle_state:'captured'}
  const cancelled={...dinner,id:'le-c',title:'Cancelled lunch',lifecycle_state:'cancelled'}
  const text=mb.renderMyBookingsReply([JAILER,dinner,old,undated,bill,cancelled],now)
  assert.equal(text,'*Your upcoming bookings*\n• Dinner at Toit — Tue, 20 Oct, 8:00 pm IST · Indiranagar · starts in 17 h 55 min (today)\n\n*Earlier*\n• Jailer 2 — Mon, 19 Oct, 9:45 pm IST · PVR Orion Mall · over, started 4 h 20 min ago')
  assert.doesNotMatch(text,/tonight|already showed|4:15/i)
  const onlyPast=mb.renderMyBookingsReply([JAILER],now)
  assert.equal(onlyPast,'You have no upcoming bookings saved.\n\n*Earlier*\n• Jailer 2 — Mon, 19 Oct, 9:45 pm IST · PVR Orion Mall · over, started 4 h 20 min ago')
  assert.equal(mb.renderMyBookingsReply([JAILER],Date.parse('2026-10-20T17:00:00Z')),'You have no upcoming bookings saved.','older than 24 h is left out')
  assert.match(mb.renderMyBookingsReply([JAILER],Date.parse('2026-10-19T15:00:00Z')),/Jailer 2 — Mon, 19 Oct, 9:45 pm IST · PVR Orion Mall · starts in 1 h 15 min \(today\)/,'before the show it is upcoming')
  assert.match(mb.renderMyBookingsReply([{...dinner,lifecycle_state:'waiting_approval'}],now),/waiting for your approval, not booked yet/)
})

await check('X2: owner-bound read of saved bookings',async()=>{
  const db=memDb({life_events:[JAILER,{...JAILER,id:'other',telegram_id:'999',title:'Someone else show',start_at:'2026-10-20T14:30:00Z'}]})
  const m=load('lib/agent/my-bookings.ts',{'@/lib/supabase-admin':{supabaseAdmin:db}})
  const text=await m.buildMyBookingsReply(123,Date.parse('2026-10-19T20:35:00Z'))
  assert.doesNotMatch(text,/Someone else/)
  assert.ok(db.reads.every(x=>x.filters.some(([k,v])=>k==='telegram_id'&&String(v)==='123')))
})

await check('X2 wiring: "my bookings" is answered in processIncomingMessage before the model; prompt forbids "already showed"',()=>{
  const pm=readFileSync('lib/bot/process-message.ts','utf8')
  const h=pm.indexOf('isMyBookingsQuery(incomingText)')
  assert.ok(h>0,'deterministic handler wired')
  assert.ok(h<pm.indexOf('const rawClaude = await askClaude(incomingText, history, memories'),'before the freeform model')
  assert.match(pm.slice(h,h+700),/handledBy: 'my-bookings'/)
  const claude=readFileSync('lib/services/claude.ts','utf8')
  assert.match(claude,/Never say "I already showed you"/)
  assert.match(claude,/Relative words in earlier messages/)
})

if(failures.length){console.error(failures.join('\n\n'));process.exit(1)}
console.log('Dashboard ticket retrieval + past-event bookings: all checks passed.')
