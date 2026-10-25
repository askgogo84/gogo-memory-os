// Actual summary handler + real Supabase query builder + disposable PostgreSQL.
// Only the PostgREST transport and Mercury boundary are replaced. No network or production data.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { createClient } from '@supabase/supabase-js'
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
process.env.SUPABASE_SERVICE_ROLE_KEY = 'fixture'
process.env.OPENAI_API_KEY = 'fixture'
process.env.ANTHROPIC_API_KEY = 'fixture'
process.env.INCEPTION_API_KEY = 'fixture'
globalThis.fetch = (async () => { throw Error('unexpected network') }) as any
const cs = await import('../lib/agent/conversation-summary.ts')
const ev = await import('../lib/agent/conversation-summary-evidence.ts')
const pg = new PGlite()
await pg.exec(`create table conversations(id uuid primary key,telegram_id bigint,role text,content text,created_at timestamptz);
create table memories(id uuid primary key default gen_random_uuid(),telegram_id bigint,content text,created_at timestamptz default now());`)
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n + 1).padStart(12, '0')}`
const base = Date.now() - 86400000
const at = (n: number) => new Date(base + n * 1000).toISOString()
const sources = (p: string) => JSON.parse(p.split('AVAILABLE_CHAT_SOURCES\n')[1].split('\nEND_CHAT_SOURCES')[0])
let prompts: any[][] = [], requests: any[] = [], hook: ((r:any)=>any) | undefined
const answer: any = async (p: string) => { const bank = sources(p); prompts.push(bank); return { text: JSON.stringify({ keep: bank.slice(-10).map((s:any)=>s.sourceId) }) } }
// Translate the bounded query-builder output into parameterized SQL; reject every unexpected shape.
function filters(params: URLSearchParams, values: any[]) {
  const ident = (s: string) => { assert.match(s,/^(id|telegram_id|role|content|created_at)$/); return s }
  const add = (v: any) => { values.push(v); return '$'+values.length }
  const atom = (s: string): string => {
    const m = s.match(/^([a-z_]+)\.(eq|gt|gte|lt|lte)\.(.+)$/); assert.ok(m, s)
    return `${ident(m[1])} ${{eq:'=',gt:'>',gte:'>=',lt:'<',lte:'<='}[m[2]]} ${add(m[3])}`
  }
  const split = (s: string) => { const found: string[]=[]; let level=0,start=0; for(let i=0;i<s.length;i++){ if(s[i]==='(')level++; if(s[i]===')')level--; if(s[i]===','&&level===0){found.push(s.slice(start,i));start=i+1} }found.push(s.slice(start));return found }
  const group = (s: string): string => { const m=s.match(/^(and|or)\((.*)\)$/); return m?'('+split(m[2]).map(group).join(m[1]==='and'?' AND ':' OR ')+')':atom(s) }
  const parts: string[]=[]
  for(const [key,value] of params){
    if(['select','order','limit','offset'].includes(key))continue
    if(key==='or'){assert.ok(value.startsWith('(')&&value.endsWith(')'));parts.push(group('or'+value));continue}
    ident(key)
    if(value.startsWith('like.')){parts.push(`${key} LIKE ${add(value.slice(5))}`);continue}
    if(value.startsWith('in.(')){const ids=value.slice(4,-1).split(',');parts.push(`${key} IN (${ids.map(add).join(',')})`);continue}
    parts.push(atom(key+'.'+value))
  }
  return parts.length?' WHERE '+parts.join(' AND '):''
}
const transport: typeof fetch = async (input, init) => {
  const url=new URL(String(input)); const table=url.pathname.split('/').at(-1)!; assert.ok(['conversations','memories'].includes(table));
  const method=init?.method||'GET', req={table,method,params:Object.fromEntries(url.searchParams), url:url.toString()}; requests.push(req)
  const fault=await hook?.(req); if(fault)return fault
  try {
    const values: any[]=[]; const where=filters(url.searchParams,values)
    if(method==='GET'){
      const selected=url.searchParams.get('select')!; assert.match(selected,/^[a-z_, ]+$/)
      const columns=selected.split(',').map(s=>s.trim()).map(s=>s==='created_at'?`to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at`:s).join(',')
      for(const s of selected.split(','))assert.ok(['id','telegram_id','role','content','created_at'].includes(s.trim()))
      let sql=`SELECT ${columns} FROM ${table}${where}`
      const order=url.searchParams.get('order'); if(order){assert.match(order,/^(created_at|role|id)\.(asc|desc)(,(created_at|role|id)\.(asc|desc))*$/);sql+=' ORDER BY '+order.replaceAll('.', ' ').replaceAll(',',', ')}
      const limit=url.searchParams.get('limit'); assert.ok(limit&&/^\d+$/.test(limit));sql+=' LIMIT '+Number(limit)
      const rows=(await pg.query(sql,values)).rows
      return Response.json(rows)
    }
    assert.equal(table,'memories')
    if(method==='POST'){const v=JSON.parse(String(init?.body));assert.equal(v.telegram_id,42);await pg.query('insert into memories(telegram_id,content) values($1,$2)',[v.telegram_id,v.content]);return new Response(null,{status:201})}
    assert.equal(method,'DELETE');assert.ok(where.includes('telegram_id')&&where.includes('id IN'));await pg.query('delete from memories'+where,values);return new Response(null,{status:204})
  }catch(e:any){return Response.json({message:e.message},{status:400})}
}
const db=createClient('https://fixture.invalid','inert-fixture-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:transport}})
async function reset(count=120) {await pg.exec('truncate conversations, memories');prompts=[];requests=[];hook=undefined;for(let n=0;n<count;n++)await pg.query('insert into conversations values($1,$2,$3,$4,$5)',[uuid(n),42,n%2?'assistant':'user',`statement ${n}`,at(n)])}
async function seed(cursor: number, id=uuid(cursor), timestamp=at(cursor), cursorRole=cursor%2?'assistant':'user') {
 const bank=ev.summarySources(42,[{id,role:'user',content:'existing correction',created_at:timestamp}]);const evidence=ev.selectSummaryEvidence(JSON.stringify({keep:bank.map(s=>s.sourceId)}),bank,42)!
 await pg.query('insert into memories(telegram_id,content) values($1,$2)',[42,JSON.stringify({type:'followup_state',kind:cs.SUMMARY_KIND,payload:{summary:ev.summaryEvidenceText(evidence),evidence,upTo:timestamp,upToId:id,upToRole:cursorRole,updatedAt:at(200)}})])
}
let passed=0, failed=0
async function check(name:string,fn:()=>any){try{await fn();passed++;console.log('PASS',name)}catch(e:any){failed++;console.error('FAIL',name,e.message)}}
await check('actual handler starts at oldest unprocessed history instead of skipping sixty turns',async()=>{
 await reset();assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated')
 assert.equal(prompts[0].find(s=>s.text==='statement 0')?.turnId,uuid(0));assert.ok(prompts[0].some(s=>s.text==='statement 39'));assert.ok(!prompts[0].some(s=>s.text==='statement 60'))
 const s:any=await cs.readConversationSummary(42,db);assert.equal(s.upToId,uuid(39))
})
await check('actual handler continues through tied timestamps after a durable source ID',async()=>{
 await reset(50);await pg.query('update conversations set created_at=$1 where id <= $2',[at(9),uuid(9)]);await seed(4,uuid(4),at(9))
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated')
 assert.ok(prompts[0].some(s=>s.text==='statement 5'),'same timestamp later ID must not disappear')
 assert.ok(!prompts[0].some(s=>s.text==='statement 4'),'covered ID is not repeated')
})

const saved = async () => await cs.readConversationSummary(42,db) as any
const count = async () => Number((await pg.query<{n:string}>('select count(*) n from memories where telegram_id=42')).rows[0].n)
const snapshot = async () => JSON.stringify((await pg.query('select telegram_id,content from memories order by id')).rows)
const failure = () => Response.json({message:'injected outage'}, {status:503})
await check('three restarted scans cover every old turn exactly once and retain latest twenty verbatim',async()=>{
 await reset();for(let n=0;n<3;n++)assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated')
 const ids=prompts.flat().map(s=>s.turnId).filter(id=>!prompts.slice(0,-1).some(p=>p.some(s=>s.turnId===id)))
 const unique=new Set(prompts.flat().map(s=>s.turnId));assert.equal(unique.size,100)
 for(let n=0;n<100;n++)assert.ok(unique.has(uuid(n)))
 for(let n=100;n<120;n++)assert.ok(!unique.has(uuid(n)))
 assert.equal((await saved()).upToId,uuid(99));assert.equal(await count(),1)
 const before=prompts.length;assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'not_needed');assert.equal(prompts.length,before);assert.ok(ids.length)
})
await check('checkpoint separates inspected coverage from model-selected quotations',async()=>{
 await reset();assert.equal(await cs.refreshConversationSummary(42,{db,ask:(async(p:string)=>{prompts.push(sources(p));return {text:JSON.stringify({keep:[]})}}) as any}),'updated')
 const s=await saved();assert.equal(s.upToId,uuid(39));assert.equal(s.evidence.claims.length,2);assert.ok(s.evidence.claims.every(c=>c.turnId!==uuid(0)))
})
await check('a large all-tied group spans batches without lost or repeated new IDs',async()=>{
 await reset();await pg.query('update conversations set created_at=$1',[at(10)])
 for(let i=0;i<3;i++)assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated')
 const unique=new Set(prompts.flat().map(s=>s.turnId));assert.equal(unique.size,100);for(let i=0;i<120;i++)assert.equal(unique.has(uuid(i)),i%2===0||i<80)
 assert.equal((await saved()).upToId,uuid(79));assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'not_needed')
})
await check('source timestamps keep PostgreSQL microseconds across a page boundary',async()=>{
 await reset(80);const prefix=at(1).slice(0,19)
 await pg.query(`update conversations set created_at=($1||'.123100Z')::timestamptz where id <= $2`,[prefix,uuid(39)])
 await pg.query(`update conversations set created_at=($1||'.123900Z')::timestamptz where id > $2 and id <= $3`,[prefix,uuid(39),uuid(59)])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.match((await saved()).upTo,/\.123100Z$/)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[1].some(s=>s.turnId===uuid(40)));assert.match((await saved()).upTo,/\.123900Z$/)
})
await check('timestamp-only legacy evidence replays its tied boundary then upgrades safely',async()=>{
 await reset(50);await pg.query('update conversations set created_at=$1 where id <= $2',[at(9),uuid(9)]);await seed(4,uuid(4),at(9))
 const rows=(await pg.query<{id:string,content:string}>('select id,content from memories')).rows;const v=JSON.parse(rows[0].content);delete v.payload.upToId;delete v.payload.upToRole
 await pg.query('update memories set content=$1 where id=$2',[JSON.stringify(v),rows[0].id])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[0].some(s=>s.text==='statement 0'));assert.ok(prompts[0].some(s=>s.text==='statement 9'));assert.equal((await saved()).upToId,uuid(29))
})
await check('a high unattributed legacy cursor upgrades without permanently pinning oldest-first rebuild',async()=>{
 await reset();await pg.query('insert into memories(telegram_id,content) values(42,$1)',[JSON.stringify({type:'followup_state',kind:cs.SUMMARY_KIND,payload:{summary:'unsupported old synopsis',upTo:at(90),updatedAt:at(200)}})])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal((await saved()).upToId,uuid(99));assert.ok(prompts[0].some(s=>s.text==='statement 60'));assert.ok(prompts[0].every(s=>s.text!=='unsupported old synopsis'));assert.equal(await count(),1)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'not_needed')
})
await check('model crash leaves no checkpoint and restart sees the same oldest batch',async()=>{
 await reset();let first:any[]=[]
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:(async(p:string)=>{first=sources(p);throw Error('worker crash before save')}) as any}),'failed');assert.equal(await count(),0)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.deepEqual(prompts[0],first)
})
await check('insert response lost after actual save does not replay the covered batch on restart',async()=>{
 await reset();let once=true;hook=async r=>{if(r.method==='POST'&&once){once=false;const bank=prompts[0];const evidence=ev.selectSummaryEvidence(JSON.stringify({keep:bank.slice(-10).map((s:any)=>s.sourceId)}),bank,42)!
 const s={summary:ev.summaryEvidenceText(evidence),evidence,upTo:bank.at(-1).observedAt,upToId:bank.at(-1).turnId,upToRole:bank.at(-1).role,updatedAt:at(200)}
 await pg.query('insert into memories(telegram_id,content) values(42,$1)',[JSON.stringify({type:'followup_state',kind:cs.SUMMARY_KIND,payload:s})]);throw Error('lost insert response')}}
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'failed');assert.equal(await count(),1);hook=undefined
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[1].some(s=>s.text==='statement 40'));assert.ok(!prompts[1].some(s=>s.text==='statement 0'))
})
await check('definite insert failure preserves old state and repeats the uncommitted batch',async()=>{
 await reset();await seed(0);const old=await snapshot();hook=r=>r.method==='POST'?failure():undefined
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'failed');assert.equal(await snapshot(),old);hook=undefined
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.deepEqual(prompts[1],prompts[0])
})
await check('cleanup failure retains coverage and restart never picks an older insertion',async()=>{
 await reset();await seed(0);hook=r=>r.method==='DELETE'?failure():undefined
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal(await count(),2);assert.equal((await saved()).upToId,uuid(40));hook=undefined
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[1].some(s=>s.text==='statement 41'));assert.equal(await count(),1)
})
await check('duplicate concurrent workers cannot advance beyond their common scanned batch',async()=>{
 await reset();let arrivals=0,release:()=>void;const wait=new Promise<void>(r=>release=r)
 const ask:any=async(p:string)=>{const bank=sources(p);prompts.push(bank);if(++arrivals===2)release();await wait;return{text:JSON.stringify({keep:bank.slice(-10).map((s:any)=>s.sourceId)})}}
 const results=await Promise.all([cs.refreshConversationSummary(42,{db,ask}),cs.refreshConversationSummary(42,{db,ask})]);assert.ok(results.every(s=>['updated','not_needed'].includes(s)));assert.equal((await saved()).upToId,uuid(39));assert.equal(await count(),1)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts.at(-1)!.some(s=>s.text==='statement 40'))
})
await check('slow earlier batch cannot replace a higher timestamp-and-ID correction',async()=>{
 await reset();let calls=0
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:(async(p:string)=>{calls++;await seed(69);return answer(p)}) as any}),'not_needed');assert.equal(calls,1);assert.equal((await saved()).upToId,uuid(69));assert.equal(await count(),1)
})
await check('higher ID at the same timestamp wins even when an older worker inserts last',async()=>{
 await reset();await pg.query('update conversations set created_at=$1',[at(10)])
 let once=true;hook=async r=>{if(r.method==='POST'&&once){once=false;await seed(109,uuid(109),at(10))}}
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal((await saved()).upToId,uuid(109));assert.equal(await count(),1)
})
await check('new messages during model work do not move the frozen batch boundary',async()=>{
 await reset(50);const original=uuid(29)
 const ask:any=async(p:string)=>{for(let n=50;n<80;n++)await pg.query('insert into conversations values($1,42,$2,$3,$4)',[uuid(n),'user',`statement ${n}`,at(n)]);return answer(p)}
 assert.equal(await cs.refreshConversationSummary(42,{db,ask}),'updated');assert.equal((await saved()).upToId,original)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[1].some(s=>s.text==='statement 30'));assert.ok(!prompts[1].some(s=>s.text==='statement 60'))
})
await check('secret-only page advances with empty evidence and zero model calls',async()=>{
 await reset();await pg.query('update conversations set content=$1 where id<=$2',['my password is do-not-store-fixture',uuid(39)])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');const s=await saved();assert.equal(s.upToId,uuid(39));assert.equal(s.summary,'');assert.equal(cs.summaryContextBlock(s),'');assert.deepEqual(s.evidence.claims,[]);assert.equal(prompts.length,0);assert.doesNotMatch(await snapshot(),/do-not-store/)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[0].some(s=>s.text==='statement 40'))
})
await check('expired-only page advances without renewing relative observation expiry',async()=>{
 await reset();await pg.query('update conversations set content=$1,created_at=created_at-interval \'3 days\' where id<=$2',['tomorrow at dinner',uuid(39)])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal(prompts.length,0);assert.deepEqual((await saved()).evidence.claims,[])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[0].some(s=>s.text==='statement 40'));assert.ok(prompts[0].every(s=>s.text!=='tomorrow at dinner'))
})
await check('unsupported-role page advances without treating instructions as user statements',async()=>{
 await reset();await pg.query('update conversations set role=$1 where id<=$2',['system',uuid(39)])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal(prompts.length,0);assert.equal((await saved()).upToId,uuid(39));assert.equal(cs.summaryContextBlock(await saved()),'')
})
await check('an excluded page preserves earlier source identity and original expiry',async()=>{
 await reset();await seed(0);const prior=(await saved()).evidence.claims[0]
 await pg.query('update conversations set content=$1 where id>$2 and id<=$3',['my password is do-not-store-fixture',uuid(0),uuid(40)])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal(prompts.length,0);assert.deepEqual((await saved()).evidence.claims[0],prior)
})
await check('small useful batch retains batching; fewer than twenty total messages is a no-op',async()=>{
 await reset(23);assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'not_needed');assert.equal(prompts.length,0);assert.equal(await count(),0)
 await reset(19);assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'not_needed');assert.equal(requests.filter(r=>r.table==='conversations').length,1)
})
await check('full page with sparse useful statements cannot be pinned behind excluded messages',async()=>{
 await reset();await pg.query('update conversations set role=$1 where id>$2 and id<=$3',['system',uuid(1),uuid(39)])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal(prompts.length,1);assert.equal((await saved()).upToId,uuid(39));assert.ok(prompts[0].every(s=>s.text==='statement 0'||s.text==='statement 1'))
})
for(const stage of ['baseline','recent','page','recheck'] as const)await check(`${stage} storage outage cannot commit or discard owner state`,async()=>{
 await reset();await seed(0);const old=await snapshot();let memoryReads=0
 hook=r=>{if(r.table==='memories'&&r.method==='GET')memoryReads++;if(stage==='baseline'&&r.table==='memories'&&memoryReads>=1||stage==='recent'&&r.table==='conversations'&&r.params.limit==='20'||stage==='page'&&r.table==='conversations'&&r.params.limit==='40'||stage==='recheck'&&r.table==='memories'&&memoryReads>=2)return failure()}
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'failed');hook=undefined;assert.equal(await snapshot(),old);if(stage!=='recheck')assert.equal(prompts.length,0)
})
await check('transient read failure is retried by the real Supabase client without duplicate model work',async()=>{
 await reset();let failed=false;hook=r=>{if(r.table==='conversations'&&!failed){failed=true;return failure()}}
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.equal(prompts.length,1);assert.equal(await count(),1);assert.ok(requests.filter(r=>r.table==='conversations'&&r.params.limit==='20').length>1)
})
await check('foreign owner history is neither offered to model nor deleted from memory',async()=>{
 await reset();await pg.query('insert into conversations values($1,7,$2,$3,$4)',[uuid(999),'user','foreign owner source',at(999)]);await pg.query('insert into memories(telegram_id,content) values(7,$1)',['foreign memory'])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts.flat().every(s=>!s.text.includes('foreign')));assert.equal(Number((await pg.query<{n:string}>('select count(*) n from memories where telegram_id=7')).rows[0].n),1)
 for(const r of requests.filter(r=>r.method!=='POST'))assert.equal(r.params.telegram_id,'eq.42')
})
for(const corruption of ['foreign','no-id','unsafe-id','bad-time','future','reverse','duplicate','over-limit','outside'] as const)await check(`malformed ${corruption} history is withheld before any model/write`,async()=>{
 await reset();hook=r=>{if(r.table==='conversations'&&r.params.limit==='40'){
 const rows=Array.from({length:40},(_,n)=>({id:uuid(n),telegram_id:42,role:'user',content:`row ${n}`,created_at:at(n)}))
 if(corruption==='foreign')rows[0].telegram_id=7
 if(corruption==='no-id')delete (rows[0] as any).id
 if(corruption==='unsafe-id')rows[0].id='x),telegram_id.eq.7'
 if(corruption==='bad-time')rows[0].created_at='yesterday'
 if(corruption==='future')rows[0].created_at=new Date(Date.now()+86400000).toISOString()
 if(corruption==='reverse')rows.reverse()
 if(corruption==='duplicate')rows[1]={...rows[0]}
 if(corruption==='over-limit')rows.push({...rows.at(-1)!,id:uuid(50),created_at:at(50)})
 if(corruption==='outside')rows[39].created_at=at(1000)
 return Response.json(rows)}}
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'failed');assert.equal(prompts.length,0);assert.equal(await count(),0)
})
await check('a foreign or malformed frozen verbatim boundary cannot authorize a history scan',async()=>{
 await reset();hook=r=>r.table==='conversations'&&r.params.limit==='20'?Response.json([{id:uuid(0),telegram_id:7,role:'user',content:'foreign',created_at:at(0)}]):undefined
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'failed');assert.equal(prompts.length,0);assert.equal(await count(),0)
})
await check('query builder retains both tuple bounds in one OR and never uses offsets',async()=>{
 await reset();await seed(0);assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated')
 const q=requests.find(r=>r.table==='conversations'&&r.params.limit==='40')!
 assert.equal(q.params.order,'created_at.asc,role.desc,id.asc');assert.match(q.params.or,/created_at.gt/);assert.match(q.params.or,/id.gt/);assert.match(q.params.or,/created_at.lt/);assert.match(q.params.or,/id.lt/);assert.ok(!('offset' in q.params));assert.equal(new URL(q.url).searchParams.getAll('or').length,1)
 assert.equal(requests.find(r=>r.table==='conversations'&&r.params.limit==='20')!.params.order,'created_at.desc,role.asc,id.desc')
})
await check('actual verbatim reader preserves user→assistant pairs and matches the frozen summary boundary',async()=>{
 await reset(50)
 // Paired inserts share source timestamps, as the real chat surfaces do.
 for(let n=0;n<50;n++)await pg.query('update conversations set created_at=$1 where id=$2',[at(Math.floor(n/2)),uuid(n)])
 const source=readFileSync(new URL('../lib/bot/process-message.ts',import.meta.url),'utf8')
 const file=ts.createSourceFile('process-message.ts',source,ts.ScriptTarget.Latest,true)
 const node=file.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='getConversationHistory');assert.ok(node)
 const compiled=ts.transpileModule(node.getText(file),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText
 const exports:any={};vm.runInNewContext(compiled,{exports,supabaseAdmin:db})
 const history=await exports.getConversationHistory(42)
 assert.equal(history.length,20);assert.deepEqual(JSON.parse(JSON.stringify(history)),Array.from({length:20},(_,i)=>({role:(i+30)%2?'assistant':'user',content:`statement ${i+30}`})))
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');const ids=new Set(prompts[0].map(s=>s.turnId));for(let i=0;i<30;i++)assert.ok(ids.has(uuid(i)))
 assert.equal(requests.find(r=>r.table==='conversations'&&r.params.select==='role,content')!.params.order,'created_at.desc,role.asc,id.desc')
})
await check('numeric ID comparison avoids lexicographic 9 greater than 10 ordering',async()=>{
 const h=await import('../lib/agent/conversation-summary-history.ts')
 assert.equal(h.compareSummaryCursors({upTo:at(1),upToId:'9'},{upTo:at(1),upToId:'10'}),-1)
 assert.equal(h.compareSummaryCursors({upTo:at(1),upToId:'9007199254740993'},{upTo:at(1),upToId:'9007199254740992'}),1)
 assert.equal(h.summaryCursorId(9007199254740992),null);assert.equal(h.summaryCursorId('01'),null);assert.equal(h.summaryCursorId('id),injected.eq.7'),null)
})
await check('malformed saved cursor is never interpolated into a PostgREST query',async()=>{
 await reset();await seed(0);const rows=(await pg.query<{id:string,content:string}>('select id,content from memories')).rows;const v=JSON.parse(rows[0].content);v.payload.upToId='a),telegram_id.eq.7';await pg.query('update memories set content=$1 where id=$2',[JSON.stringify(v),rows[0].id])
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(requests.every(r=>!r.url.includes('injected')&&!decodeURIComponent(r.url).includes('a),telegram_id')))
 assert.equal((await saved()).upToId,uuid(39))
})
await check('selector failure never records scanned coverage as if memory was saved',async()=>{
 await reset();assert.equal(await cs.refreshConversationSummary(42,{db,ask:(async()=>({text:'I booked and paid'})) as any}),'failed');assert.equal(await count(),0)
 assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[0].some(s=>s.text==='statement 0'))
})
await check('actual numeric-key SQL scan continues past 9 to 10 with both tuple bounds',async()=>{
 await pg.exec('truncate memories;drop table conversations;create table conversations(id bigint primary key,telegram_id bigint,role text,content text,created_at timestamptz)');prompts=[];requests=[];hook=undefined
 try {
  for(let i=0;i<120;i++)await pg.query('insert into conversations values($1,42,$2,$3,$4)',[i,'user',`numeric ${i}`,at(10)])
  await seed(9,'9',at(10),'user');assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'updated');assert.ok(prompts[0].some(s=>s.text==='numeric 10'));assert.ok(!prompts[0].some(s=>s.text==='numeric 9'));assert.equal((await saved()).upToId,'49')
 } finally {await pg.exec('drop table conversations;create table conversations(id uuid primary key,telegram_id bigint,role text,content text,created_at timestamptz)')}
})
await check('disabled summary performs no reads, model work or writes',async()=>{
 await reset();process.env.MERCURY_CHAT_SUMMARY='0';assert.equal(await cs.refreshConversationSummary(42,{db,ask:answer}),'disabled');delete process.env.MERCURY_CHAT_SUMMARY;assert.equal(requests.length,0);assert.equal(prompts.length,0)
})
console.log(`SUMMARY_BACKLOG ${passed}/${passed+failed}`)
await pg.close()
if(failed)process.exitCode=1
