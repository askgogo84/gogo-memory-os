import {calendarAffirmativeText} from '../lib/agent/calendar-read'
import * as emailRedaction from '../lib/security/email-redaction'
import './verify-universal-search-oct27.mts'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import {NextRequest,NextResponse} from 'next/server'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const helper = readFileSync(new URL('../lib/agent/workspace-drive-context.ts', import.meta.url), 'utf8')
const readLayer = readFileSync(new URL('../lib/agent/google-workspace-read.ts', import.meta.url), 'utf8')
const binary = readFileSync(new URL('../lib/agent/google-workspace-drive-binary.ts', import.meta.url), 'utf8')
const serverlessPdf = readFileSync(new URL('../lib/services/pdf-js-serverless.ts', import.meta.url), 'utf8')
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
assert.match(binary, /extractServerlessPdfText\(bytes,MAX_DRIVE_TEXT\)/, 'PDF extraction must use the bounded serverless parser')
assert.match(serverlessPdf, /ensurePdfJsServerlessGlobals\(\)\s*\n\s*const mod:any=await import\('pdf-parse'\)/,
 'PDF.js globals must be installed before the parser module is first imported')
assert.match(binary, /jszip/, 'Office document extraction must use bounded OOXML parsing')
assert.match(binary, /xlsx/, 'Workbook extraction must use bounded spreadsheet parsing')
assert.match(binary, /response\.arrayBuffer\(\)/, 'Drive binaries must be downloaded as bytes rather than coerced to text')
assert.match(binary, /content-length/, 'Drive binary reader must enforce the response size boundary before parsing')
assert.match(helper, /mutationsAllowed:false/, 'Drive context run metadata must declare that mutations are not allowed')
assert.match(helper, /safety:\{readOnly:true,mutationsAllowed:false,credentialsStored:false\}/, 'Drive artifact must preserve explicit read-only and credential safety metadata')
assert.match(helper, /source_refs:\[\{type:'google_drive_file'/, 'Drive artifact must carry file provenance')
assert.match(helper, /I did not pretend to read it/, 'Unsupported or unreadable file types must fail transparently instead of fabricating document content')
assert.match(helper, /Drive files that could match, so I haven't opened one/, 'Ambiguous Drive results must stop rather than guess')
assert.match(helper, /edited \$\{when\}/, 'Ambiguous Drive results show a readable edit date, not a raw timestamp')
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
const shadowOutcomes:any[]=[]
const routeDeps:any={
 '@/lib/agent/shadow-router-outcome':{recordShadowRouterOutcome:async(value:any)=>{shadowOutcomes.push(value)}},
 '@/lib/agent/jev-router':{isGroundedReminderCommand:()=>false,jevClarificationReply:()=>null},
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
assert.ok(shadowOutcomes.some(x=>x.actualHandler==='workspace-drive-context'&&x.actualCapability==='files'&&x.runId),'real Drive route records its observed outcome')
console.log('Actual Drive executor, schema, report presenter and web route passed')

const lookupTitle='AskGogo Connector Acceptance Fixture 2026-11-26'
const lookupText=`Search my connected Google Drive for the exact filename ${lookupTitle}. Read-only check. Tell me whether Google Drive answered and whether there was an exact match. Do not show other filenames or contents.`
const exactFile={...file,name:lookupTitle,matchesExactName:true}
const readFile=deps['./google-workspace-read'].readWorkspaceDriveText
deps['./google-workspace-read'].readWorkspaceDriveText=async()=>assert.fail('an existence check must not open a file')
for(const [files,hasMore,expected] of [
  [[file],false,/No file matched the exact filename/],
  [[exactFile],false,/One file matched the exact filename/],
  [[exactFile,{...exactFile,id:'duplicate'}],false,/Multiple files used the exact filename/],
  [[exactFile],true,/search was incomplete/],
] as const){
  deps['./google-workspace-read'].searchWorkspaceDrive=async(_actor:unknown,_text:string,opts:{exactName?:string})=>{
    assert.equal(opts.exactName,lookupTitle)
    return {files,hasMore}
  }
  for(const lookupPrompt of [
    lookupText,
    'Read-only check: '+lookupText,
    'Review whether Google Drive has an exact match for the exact filename "'+lookupTitle+'".',
    'Read my Google Drive document with the exact filename "'+lookupTitle+'". Do not open it yet.',
    'Check the exact filename "'+lookupTitle+'" in my Google Drive and do not summarize it.',
    'Read my Google Drive document with the exact filename "'+lookupTitle+'". Do not show me the contents.',
    'Review whether the exact filename exists in Google Drive. Check the exact filename "'+lookupTitle+'".',
    'Review my Google Drive for the exact filename "'+lookupTitle+'". Only tell me whether it exists. Do not show other filenames or contents.',
    'Review the Google Drive document with the exact filename "'+lookupTitle+'". Only tell me whether it exists.',
    'Read the exact filename "'+lookupTitle+'" from my Google Drive. Do not show other filenames or contents.',
    'Use my Google Drive document with the exact filename "'+lookupTitle+'" to check whether it exists. Metadata only.',
    'Review the Google Drive document with the exact filename "'+lookupTitle+'". Only tell me if it exists.',
    'Read the exact filename "'+lookupTitle+'" from my Google Drive. Do not open this or other documents.',
  ]){
    const lookup=await api.tryRunWorkspaceDriveContext({actor,surface:'web',text:lookupPrompt})
    assert.match(lookup.text,expected)
    assert.doesNotMatch(lookup.text,/Fixture brief|drive\.google\.com|Private report/)
  }
}

deps['./google-workspace-read'].searchWorkspaceDrive=async()=>assert.fail('multiple named exact lookups require clarification')
const competing=await api.tryRunWorkspaceDriveContext({actor,surface:'web',text:'Read the exact filename "Budget" or the exact filename "Plan" from Google Drive.'})
assert.equal(competing.status,'paused')
assert.match(competing.text,/Please put the exact filename/)

const driveApi:any={}
const exactProviderTitle=' Fixture  brief &amp; notes '
const normalizedTitle='Fixture brief & notes'
let providerTitle=exactProviderTitle
let query=''
const credentialQuery={
  select:()=>credentialQuery,
  eq:(key:string,value:number)=>{assert.equal(key,'telegram_id');assert.equal(value,42);return credentialQuery},
  maybeSingle:async()=>({data:{gmail_connected:true,gmail_access_token:'fixture-only'},error:null}),
}
const driveDeps:any={
  '@/lib/security/email-redaction':emailRedaction,
  '@/lib/bot/memory-redaction':{redactSecretShapedText:(value:string)=>value},
  '@/lib/security/google-token-crypto':{decryptGoogleToken:(value:string)=>value,hasGoogleTokenEncryptionKey:()=>false},
  '@/lib/supabase-admin':{supabaseAdmin:{from:(table:string)=>{assert.equal(table,'users');return credentialQuery}}},
}
runInNewContext(ts.transpileModule(readLayer,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:driveApi,require:(name:string)=>driveDeps[name]||{},URL,URLSearchParams,console,
  fetch:async(url:string)=>{
    const parsed=new URL(url)
    assert.equal(parsed.origin+parsed.pathname,'https://www.googleapis.com/drive/v3/files')
    query=parsed.searchParams.get('q')||''
    return {ok:true,json:async()=>({files:[{...file,name:providerTitle}]})}
  },
})
deps['./google-workspace-read'].searchWorkspaceDrive=driveApi.searchWorkspaceDrive
const checkExactTitle=(title:string)=>api.tryRunWorkspaceDriveContext({actor,surface:'web',text:'Check my Google Drive for the exact filename "'+title+'".'})
assert.match((await checkExactTitle(exactProviderTitle)).text,/One file matched the exact filename/)
assert.equal(query,"trashed = false and name = '"+exactProviderTitle+"'")
assert.match((await checkExactTitle(normalizedTitle)).text,/No file matched the exact filename/)
providerTitle=normalizedTitle
assert.match((await checkExactTitle(exactProviderTitle)).text,/No file matched the exact filename/)

deps['./google-workspace-read'].readWorkspaceDriveText=readFile
for(const contentPrompt of [
  'Read my Google Drive document with the exact filename "'+normalizedTitle+'".',
  'Find my Google Drive document with the exact filename "'+normalizedTitle+'" and summarize it.',
  'Find my Google Drive document with the exact filename '+normalizedTitle+' and read it.',
  'Show me the contents of my Google Drive document with the exact filename "'+normalizedTitle+'".',
  'Find my Google Drive document with the exact filename "'+normalizedTitle+'" and display the document text.',
  'Read my Google Drive document with the exact filename "'+normalizedTitle+'" and tell me whether a contingency fund exists.',
  'Read the document with the exact filename '+normalizedTitle+' from my Google Drive.',
  'Review my Google Drive document with the exact filename "'+normalizedTitle+'".',
  'Use my Google Drive document with the exact filename "'+normalizedTitle+'" to tell me the deadline.',
  'Check my Google Drive for the exact filename "'+normalizedTitle+'". If it exists, read it and summarize it.',
  'Read my Google Drive document with the exact filename "'+normalizedTitle+'". Do not open any other files.',
  'Read my Google Drive document with the exact filename "'+normalizedTitle+'". Do not open or read other files.',
]){
  const contentRead=await api.tryRunWorkspaceDriveContext({actor,surface:'web',text:contentPrompt})
  assert.equal(contentRead.status,'completed')
  assert.match(contentRead.text,/Private report/)
}
deps['./google-workspace-read'].searchWorkspaceDrive=async()=>({files:[file]})

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

for(const action of ['add its deadlines to my calendar','update my project list','save its deadline as a reminder','post its summary','forward it to Alice','archive the source','set a reminder','publish the summary','renew the subscription']){
 const request='Read my Google Drive brief and '+action
 assert.equal(api.isWorkspaceDriveContextRequest(request),false,'independent action must not disappear: '+action)
 const response=await routeApi.POST(new NextRequest('https://fixture.invalid/api/dashboard/chat',{method:'POST',headers:{origin:'https://fixture.invalid'},body:JSON.stringify({text:request})}))
 assert.equal((await response.json()).handledBy,'unexpected-generic','actual route preserves the compound planner: '+action)
}
