import {calendarAffirmativeText} from '../lib/agent/calendar-read'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {NextRequest,NextResponse} from 'next/server'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const helper = readFileSync(new URL('../lib/agent/workspace-drive-context.ts', import.meta.url), 'utf8')
const readLayer = readFileSync(new URL('../lib/agent/google-workspace-read.ts', import.meta.url), 'utf8')
const binary = readFileSync(new URL('../lib/agent/google-workspace-drive-binary.ts', import.meta.url), 'utf8')
const runRoute = readFileSync(new URL('../app/api/agent/run/route.ts', import.meta.url), 'utf8')
const google = readFileSync(new URL('../lib/services/google-gmail.ts', import.meta.url), 'utf8')

assert.match(google, /https:\/\/www\.googleapis\.com\/auth\/drive\.readonly/, 'Workspace consent must include Drive read-only scope')
assert.match(readLayer, /export async function searchWorkspaceDrive/, 'Workspace read layer must expose Drive search')
assert.match(readLayer, /export async function readWorkspaceDriveText/, 'Workspace read layer must expose bounded Drive text reads')
assert.match(helper, /readWorkspaceDriveBinaryText/, 'Drive context must fall back to bounded binary extraction for supported uploaded files')
assert.match(binary, /MAX_DRIVE_BINARY_BYTES = 8 \* 1024 \* 1024/, 'Binary Drive reads must remain bounded to 8 MB')
assert.match(binary, /application\/pdf/, 'Drive binary reader must support PDF')
assert.match(binary, /wordprocessingml\.document/, 'Drive binary reader must support DOCX')
assert.match(binary, /presentationml\.presentation/, 'Drive binary reader must support PPTX')
assert.match(binary, /spreadsheetml\.sheet/, 'Drive binary reader must support XLSX')
assert.match(binary, /pdf-parse/, 'PDF extraction must use the existing bounded parser')
assert.match(binary, /jszip/, 'Office document extraction must use bounded OOXML parsing')
assert.match(binary, /xlsx/, 'Workbook extraction must use bounded spreadsheet parsing')
assert.match(binary, /response\.arrayBuffer\(\)/, 'Drive binaries must be downloaded as bytes rather than coerced to text')
assert.match(binary, /content-length/, 'Drive binary reader must enforce the response size boundary before parsing')
assert.match(helper, /mutationsAllowed:false/, 'Drive context run metadata must declare that mutations are not allowed')
assert.match(helper, /safety:\{readOnly:true,mutationsAllowed:false,credentialsStored:false\}/, 'Drive artifact must preserve explicit read-only and credential safety metadata')
assert.match(helper, /source_refs:\[\{type:'google_drive_file'/, 'Drive artifact must carry file provenance')
assert.match(helper, /I did not pretend to read it/, 'Unsupported or unreadable file types must fail transparently instead of fabricating document content')
assert.match(helper, /I found several plausible Drive files, so I stopped rather than choosing the wrong document/, 'Ambiguous Drive results must stop rather than guess')
assert.match(helper, /Answer the user's request using ONLY the supplied Google Drive document/, 'Document answers must remain grounded in the selected Drive file')
assert.match(helper, /No Drive file was changed/, 'User-facing result must state the read-only boundary')
assert.doesNotMatch(helper, /drive\/v3\/files[^`'"\n]*\{[^}]*method:\s*['"](?:POST|PATCH|PUT|DELETE)/i, 'Drive context mission must not introduce Drive write calls')
assert.doesNotMatch(binary, /method:\s*['"](?:POST|PATCH|PUT|DELETE)/i, 'Drive binary extraction must stay read-only')
assert.match(runRoute, /tryRunWorkspaceDriveContext/, 'Agent run router must include the deterministic Drive context path')
assert.ok(runRoute.indexOf('tryRunWorkspaceDriveContext') < runRoute.indexOf('tryRunGeneralPlan({'), 'Drive context must route before open-ended general planning')

console.log('workspace Drive context regression: ok')

// Actual executor with schema-aware isolated persistence and a bounded source fixture.
const schema=readFileSync('supabase/agent-os-v1.sql','utf8');
const columns=new Set([...schema.split('create table if not exists agent_runs (')[1].split(');')[0].matchAll(/^\s+(\w+)\s/gm)].map(x=>x[1]));
const types=[...schema.split('create table if not exists agent_artifacts (')[1].split(');')[0].match(/type in \(([^)]+)\)/)[1].matchAll(/'([^']+)'/g)].map(x=>x[1]);
const source=helper;
const writes:any[]=[];
const db={from(table:string){assert.ok(['agent_runs','agent_artifacts','agent_activity'].includes(table));const q={insert(row:any){if(table==='agent_runs')for(const key of Object.keys(row))assert.ok(columns.has(key),`agent_runs has no ${key} column`);if(table==='agent_artifacts')assert.ok(types.includes(row.type),`agent_artifacts rejects type ${row.type}`);assert.equal(row.telegram_id,'42');writes.push({table,row});return q},update(row:any){writes.push({table,row});return q},eq(){return q},select(){return q},single:async()=>({data:{id:'fixture-'+table},error:null}),then:(fn:any)=>Promise.resolve({error:null}).then(fn)};return q}};
class Model {messages={create:async()=>({content:[{type:'text',text:'The fixture deadline is Friday.'}]})}}
const file={id:'fixture-file',name:'Fixture brief',mimeType:'text/plain',webViewLink:'https://drive.google.com/file/d/fixture-file/view'};
const deps:any={
 './calendar-read':{calendarAffirmativeText},
 '@anthropic-ai/sdk':Model,
 '@/lib/supabase-admin':{supabaseAdmin:db},
 '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
 './typed-object-context':{rememberTypedObjects:async()=>{}},'@/lib/google-gmail':{},
 './google-workspace-read':{searchWorkspaceDrive:async()=>({files:[file]}),readWorkspaceDriveText:async()=>({supported:true,text:'The fixture deadline is Friday.'})},
 './google-workspace-drive-binary':{}
};
const api:any={};
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText,{exports:api,require:(n:string)=>deps[n],process:{env:{ANTHROPIC_API_KEY:'fixture-key'}},console,Date});
const result=await api.tryRunWorkspaceDriveContext({actor:{legacyTelegramId:42},surface:'web',text:'Read my Google Drive document named "Fixture brief"'});
assert.equal(result.status,'completed','real Drive executor must persist a successful private result');
assert.ok(writes.some(w=>w.table==='agent_artifacts'&&w.row.content_json.answer.includes('Friday')));

const presenter:any={}
runInNewContext(ts.transpileModule(readFileSync('lib/agent/artifact-presentation.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:presenter,require:()=>({formatEmailSnippet:(s:string)=>s,redactSecretShapedText:(s:string)=>s})})
const saved=writes.find(w=>w.table==='agent_artifacts').row
assert.ok(presenter.artifactSections(saved.content_json).some((s:any)=>s.text.includes('deadline is Friday')),'real report renderer must display the saved document answer')
assert.ok(presenter.artifactSections(saved.content_json).some((s:any)=>s.text.includes(file.webViewLink)),'report preserves source provenance')
assert.match(result.text,/Private report: https:\/\/app.askgogo.in\/dashboard\/reports\//)
const actor={legacyTelegramId:42}
const routeSource=readFileSync('app/api/dashboard/chat/route.ts','utf8')
const nullModule=new Proxy({}, {get:(_target,name)=>/^(?:is|detect|names)/.test(String(name))?()=>false:async()=>null})
const routeDb={from(table:string){if(table==='users'){const q:any={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{telegram_id:42,whatsapp_id:'+15555550100',name:'Fixture'},error:null})};return q}if(table==='conversations')return {insert:async()=>({error:null})};return db.from(table)}}
const routeDeps:any={
 'next/server':{NextRequest,NextResponse},crypto:{randomUUID:()=> 'fixture-drive-turn'},
 '@/lib/dashboard/session':{getSession:async()=>({telegramId:'42'})},
 '@/lib/supabase-admin':{supabaseAdmin:routeDb},
 '@/lib/agent/actor':{resolveAgentActor:async()=>actor},
 '@/lib/agent/workspace-drive-context':api,
 '@/lib/bot/memory-redaction':{redactSecretShapedText:(s:string)=>s},
 '@/lib/agent/general-planner':{tryRunGeneralPlan:async()=>({text:'Wrong generic planner',handledBy:'unexpected-generic',status:'completed'})},
}
const routeApi:any={}
runInNewContext(ts.transpileModule(routeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:routeApi,require:(name:string)=>routeDeps[name]||nullModule,console,URL,Date,process:{env:{}}})
const webResult=await routeApi.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:'Read my Google Drive document named "Fixture brief". Do not modify any files or send anything.'})}))
assert.equal(webResult.status,200)
assert.equal((await webResult.json()).handledBy,'workspace-drive-context','real web route must reach the same Drive executor before generic planning')
console.log('Actual Drive executor, schema, report presenter and web route passed')

for(const negative of ['Do not read my Google Drive document','Find a place to drive this weekend','Read my Google Drive brief and send it to Alice','Read my Google Drive brief and show my calendar tomorrow','Read my Google Drive brief and create a reminder'])
 assert.equal(api.isWorkspaceDriveContextRequest(negative),false,negative+' retains its existing routing')
assert.equal(api.isWorkspaceDriveContextRequest('Read my Google Drive document "Create a calendar". Do not send email or create reminders.'),true,'quoted titles and prohibitions are not independent actions')

const bridgeSource=readFileSync('lib/agent/whatsapp-bridge.ts','utf8')
const bridgeApi:any={}
runInNewContext(ts.transpileModule(bridgeSource,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:bridgeApi,require:(name:string)=>name==='./workspace-drive-context'?api:nullModule,console,URL,Date,process:{env:{}}})
const phoneFixture=await bridgeApi.tryRunWhatsAppAgent({user:{id:'fixture-user',telegramId:42,whatsappId:'+15555550100',name:'Fixture'},text:'Read my Google Drive document named "Fixture brief". Do not change anything.'})
assert.equal(phoneFixture.handledBy,'workspace-drive-context','actual WhatsApp bridge uses the same verified reader')
assert.match(phoneFixture.text,/deadline is Friday/)

for(const files of [[],[file,{...file,id:'second',name:'Another brief'}]]){
 writes.length=0
 deps['./google-workspace-read'].searchWorkspaceDrive=async()=>({files})
 const paused=await api.tryRunWorkspaceDriveContext({actor,surface:'web',text:'Read my Google Drive brief'})
 assert.equal(paused.status,'paused')
 assert.equal(writes.some(w=>w.table==='agent_artifacts'),false,'missing or ambiguous files do not produce a fabricated report')
}
deps['./google-workspace-read'].searchWorkspaceDrive=async()=>({files:[file]})
deps['./google-workspace-read'].readWorkspaceDriveText=async()=>({supported:false})
deps['./google-workspace-drive-binary'].readWorkspaceDriveBinaryText=async()=>({supported:false,reason:'unsupported'})
writes.length=0
const unsupported=await api.tryRunWorkspaceDriveContext({actor,surface:'web',text:'Read my Google Drive brief'})
assert.equal(unsupported.status,'paused');assert.match(unsupported.text,/did not pretend to read/)
assert.equal(writes.some(w=>w.table==='agent_artifacts'),false)
console.log('Actual WhatsApp Drive bridge, ambiguity and unsupported-document boundaries passed')
