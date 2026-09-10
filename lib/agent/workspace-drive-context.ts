import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { buildGmailConnectUrl } from '@/lib/google-gmail'
import { readWorkspaceDriveText, searchWorkspaceDrive } from './google-workspace-read'
import type { AgentActor } from './actor'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
const MAX_MODEL_CONTEXT = 24_000
const MAX_ANSWER = 3_000

type DriveFile = {
  id:string
  name:string
  mimeType:string
  modifiedTime?:string
  webViewLink?:string
  size?:number|null
}

function safe(value:unknown,max=1200){
  return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))
}

export function isWorkspaceDriveContextRequest(text:string){
  const t=String(text||'')
  const drive=/\b(drive|google drive)\b/i.test(t)
  const document=/\b(doc|docs|document|documents|file|files|sheet|spreadsheet|proposal|deck|brief|notes|report)\b/i.test(t)
  const action=/\b(find|search|read|show|summari[sz]e|review|use|check|look at|tell me|extract)\b/i.test(t)
  return action && (drive || (/\bgoogle\b/i.test(t)&&document))
}

function quotedNames(text:string){
  return Array.from(String(text||'').matchAll(/["“]([^"”]{2,160})["”]/g)).map(m=>safe(m[1],160).toLowerCase()).filter(Boolean)
}

export function selectWorkspaceDriveFile(files:DriveFile[],text:string):{status:'selected';file:DriveFile}|{status:'not_found'|'ambiguous';files:DriveFile[]}{
  const usable=(files||[]).filter(x=>x?.id&&x?.name)
  if(!usable.length)return {status:'not_found',files:[]}
  if(usable.length===1)return {status:'selected',file:usable[0]}

  const quoted=quotedNames(text)
  if(quoted.length){
    const exact=usable.filter(file=>quoted.some(q=>file.name.toLowerCase()===q))
    if(exact.length===1)return {status:'selected',file:exact[0]}
    const contains=usable.filter(file=>quoted.some(q=>file.name.toLowerCase().includes(q)))
    if(contains.length===1)return {status:'selected',file:contains[0]}
  }

  if(/\b(latest|newest|most recent|recent)\b/i.test(text)){
    const dated=usable.filter(x=>x.modifiedTime).sort((a,b)=>String(b.modifiedTime).localeCompare(String(a.modifiedTime)))
    if(dated.length)return {status:'selected',file:dated[0]}
  }

  return {status:'ambiguous',files:usable.slice(0,6)}
}

async function createRun(actor:AgentActor,text:string){
  const now=new Date().toISOString()
  const {data,error}=await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(actor.legacyTelegramId),
    type:'workspace_drive_context',capability:'files',risk_level:'low',status:'running',
    title:'Read Google Drive context',
    summary:'Gogo is reading only the Drive context you asked for.',
    why:'User asked Gogo to find or use a document from their connected Google Drive.',
    source:'workspace',started_at:now,updated_at:now,
    metadata_json:{plan_type:'workspace_drive_context',input_text:String(text||'').slice(0,1800),mutationsAllowed:false},
  }).select('id').single()
  if(error||!data?.id)throw new Error(`workspace_drive_run_create_failed:${error?.message||'unknown'}`)
  return String(data.id)
}

async function finishRun(actor:AgentActor,runId:string,params:{status:'completed'|'paused'|'failed';summary:string;metadata?:Record<string,unknown>;error?:string}){
  const now=new Date().toISOString()
  const {error}=await supabaseAdmin.from('agent_runs').update({
    status:params.status,summary:safe(params.summary,900),updated_at:now,
    ...(params.status==='completed'||params.status==='failed'?{completed_at:now}:{}),
    ...(params.error?{error:safe(params.error,400)}:{}),
    ...(params.metadata?{metadata_json:params.metadata}:{}),
  }).eq('id',runId).eq('telegram_id',String(actor.legacyTelegramId))
  if(error)console.error('WORKSPACE_DRIVE_RUN_FINISH_FAILED:',error.message)
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(actor.legacyTelegramId),run_id:runId,
    event_type:`workspace_drive_${params.status}`,
    message:safe(params.summary,900),metadata_json:{mutated:false,...(params.metadata||{})},
  }).then(({error})=>{if(error)console.error('WORKSPACE_DRIVE_ACTIVITY_FAILED:',error.message)})
}

async function createArtifact(actor:AgentActor,runId:string,file:DriveFile,answer:string){
  const content={
    answer:safe(answer,MAX_ANSWER),
    source:{
      provider:'google-drive',id:String(file.id),name:safe(file.name,240),mimeType:String(file.mimeType||''),
      modifiedTime:String(file.modifiedTime||''),webViewLink:String(file.webViewLink||''),
    },
    safety:{readOnly:true,mutationsAllowed:false,credentialsStored:false},
  }
  const {data,error}=await supabaseAdmin.from('agent_artifacts').insert({
    telegram_id:String(actor.legacyTelegramId),type:'drive_context',
    title:`Drive context · ${safe(file.name,160)}`,subtitle:'Read-only Google Drive context',
    schema_version:1,content_json:content,
    source_refs:[{type:'google_drive_file',id:String(file.id),name:safe(file.name,180)}],
  }).select('id').single()
  if(error||!data?.id)throw new Error(`workspace_drive_artifact_failed:${error?.message||'unknown'}`)
  return String(data.id)
}

async function answerFromDocument(text:string,documentText:string,file:DriveFile){
  const excerpt=String(documentText||'').slice(0,MAX_MODEL_CONTEXT)
  if(!excerpt.trim())return 'I found the document, but it did not contain readable text.'
  try{
    const res=await anthropic.messages.create({
      model:'claude-haiku-4-5',max_tokens:900,temperature:0,
      messages:[{role:'user',content:`Answer the user's request using ONLY the supplied Google Drive document. Do not invent facts or use outside knowledge. If the requested fact is not in the document, say that clearly. Keep the answer concise and useful.\n\nUser request: ${JSON.stringify(String(text||'').slice(0,1800))}\n\nDocument name: ${JSON.stringify(file.name)}\n\nDocument text:\n${excerpt}`}],
    })
    const out=res.content[0]?.type==='text'?res.content[0].text:''
    return safe(out||'I read the document, but could not produce a reliable answer from it.',MAX_ANSWER)
  }catch(err:any){
    console.error('WORKSPACE_DRIVE_SUMMARY_FAILED:',err?.message||err)
    return safe(excerpt,1800)
  }
}

function connectWorkspace(actor:AgentActor){
  const url=buildGmailConnectUrl(actor.legacyTelegramId)
  return url?`Connect or refresh Google Workspace first:\n${url}`:'Google Workspace connection is temporarily unavailable.'
}

export async function tryRunWorkspaceDriveContext(params:{actor:AgentActor;surface:string;text:string}){
  if(!isWorkspaceDriveContextRequest(params.text))return null
  const {actor,text}=params
  const runId=await createRun(actor,text)
  try{
    let search:any
    try{
      search=await searchWorkspaceDrive(actor,text)
    }catch(err:any){
      const code=String(err?.message||'')
      if(['workspace_not_connected','workspace_reconnect_required','workspace_scope_required'].includes(code)){
        const summary='Google Workspace needs to be connected or refreshed before Gogo can read Drive context.'
        await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_drive_context',input_text:text,mutationsAllowed:false}})
        return {runId,status:'paused',capability:'files',risk:'low',text:`${summary}\n\n${connectWorkspace(actor)}`,handledBy:'workspace-drive-context'}
      }
      throw err
    }

    const choice=selectWorkspaceDriveFile(search?.files||[],text)
    if(choice.status==='not_found'){
      const summary='I could not find a matching file in your connected Google Drive. I did not substitute a web result or guess another document.'
      await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_drive_context',input_text:text,mutationsAllowed:false,queryTerms:search?.queryTerms||[]}})
      return {runId,status:'paused',capability:'files',risk:'low',text:summary,handledBy:'workspace-drive-context'}
    }
    if(choice.status==='ambiguous'){
      const options=choice.files.map((file,i)=>`${i+1}. ${safe(file.name,180)}${file.modifiedTime?` · ${safe(file.modifiedTime,60)}`:''}`).join('\n')
      const summary='I found several plausible Drive files, so I stopped rather than choosing the wrong document.'
      await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_drive_context',input_text:text,mutationsAllowed:false,candidateFileIds:choice.files.map(f=>f.id)}})
      return {runId,status:'paused',capability:'files',risk:'low',text:`${summary}\n\n${options}\n\nAsk for the file by name to continue.`,handledBy:'workspace-drive-context'}
    }

    const file=choice.file
    const read=await readWorkspaceDriveText(actor,file)
    if(!read.supported){
      const summary=`I found ${safe(file.name,180)}, but this Drive file type is not yet safe for text extraction in Gogo.`
      await finishRun(actor,runId,{status:'paused',summary,metadata:{plan_type:'workspace_drive_context',input_text:text,mutationsAllowed:false,fileId:file.id,mimeType:file.mimeType}})
      return {runId,status:'paused',capability:'files',risk:'low',text:`${summary} I did not pretend to read it.`,handledBy:'workspace-drive-context'}
    }

    const answer=await answerFromDocument(text,read.text,file)
    const artifactId=await createArtifact(actor,runId,file,answer)
    const summary=`Read ${safe(file.name,180)} from Google Drive and saved a private sourced context artifact. No Drive file was changed.`
    const metadata={
      plan_type:'workspace_drive_context',input_text:text,mutationsAllowed:false,
      fileId:file.id,fileName:safe(file.name,240),mimeType:file.mimeType,artifactId,
    }
    await finishRun(actor,runId,{status:'completed',summary,metadata})
    return {
      runId,status:'completed',capability:'files',risk:'low',handledBy:'workspace-drive-context',artifactId,
      text:`${answer}\n\nSource: ${safe(file.name,180)}${file.webViewLink?`\n${file.webViewLink}`:''}\n\nGogo used read-only Drive access. Nothing in Drive was changed.`,
    }
  }catch(err:any){
    const summary='Gogo could not safely finish the Drive document request. No Drive file was changed.'
    await finishRun(actor,runId,{status:'failed',summary,error:String(err?.message||'workspace_drive_context_failed'),metadata:{plan_type:'workspace_drive_context',input_text:text,mutationsAllowed:false}})
    console.error('WORKSPACE_DRIVE_CONTEXT_FAILED:',String(err?.message||err).slice(0,180))
    return {runId,status:'failed',capability:'files',risk:'low',text:summary,handledBy:'workspace-drive-context'}
  }
}
