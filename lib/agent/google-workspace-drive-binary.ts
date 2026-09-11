import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

const MAX_DRIVE_BINARY_BYTES = 8 * 1024 * 1024
const MAX_DRIVE_TEXT = 60_000

type DriveBinaryFile = {
  id:string
  name?:string
  mimeType?:string
  size?:number|null
}

type DriveBinaryKind = 'pdf'|'docx'|'pptx'|'xlsx'

type DriveBinaryRead =
  | {supported:true;name:string;mimeType:string;text:string;extraction:DriveBinaryKind}
  | {supported:false;name:string;mimeType:string;text:'';reason:'unsupported'|'too_large'|'unreadable'}

function clean(value:unknown,max=1200){
  return redactSecretShapedText(String(value??'').replace(/\s+/g,' ').trim().slice(0,max))
}

export function driveBinaryKind(file:DriveBinaryFile):DriveBinaryKind|null {
  const name=String(file.name||'').toLowerCase()
  const mime=String(file.mimeType||'').toLowerCase()
  if(mime==='application/pdf'||name.endsWith('.pdf'))return 'pdf'
  if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||name.endsWith('.docx'))return 'docx'
  if(mime==='application/vnd.openxmlformats-officedocument.presentationml.presentation'||name.endsWith('.pptx'))return 'pptx'
  if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||name.endsWith('.xlsx'))return 'xlsx'
  return null
}

async function credentials(actor:AgentActor){
  const {data,error}=await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_access_token,gmail_refresh_token')
    .eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  if(error)throw new Error(`workspace_credentials_failed:${error.message}`)
  if(!data?.gmail_connected)throw new Error('workspace_not_connected')
  if(!data.gmail_access_token&&!data.gmail_refresh_token)throw new Error('workspace_reconnect_required')
  return data as any
}

async function refresh(actor:AgentActor,refreshToken:string){
  const token=await refreshGmailAccessToken(refreshToken)
  if(!token)throw new Error('workspace_reconnect_required')
  const {error}=await supabaseAdmin.from('users').update({gmail_access_token:token}).eq('telegram_id',actor.legacyTelegramId)
  if(error)console.error('WORKSPACE_DRIVE_BINARY_TOKEN_PERSIST_FAILED:',error.message)
  return token
}

async function workspaceFetch(actor:AgentActor,url:string){
  const creds=await credentials(actor)
  let token=String(creds.gmail_access_token||'')
  if(!token&&creds.gmail_refresh_token)token=await refresh(actor,String(creds.gmail_refresh_token))
  const run=(accessToken:string)=>fetch(url,{headers:{Authorization:`Bearer ${accessToken}`},cache:'no-store'})
  let response=await run(token)
  if(response.status===401&&creds.gmail_refresh_token){
    token=await refresh(actor,String(creds.gmail_refresh_token))
    response=await run(token)
  }
  if(response.status===403)throw new Error('workspace_scope_required')
  return response
}

async function fetchDriveBytes(actor:AgentActor,file:DriveBinaryFile){
  if(Number(file.size||0)>MAX_DRIVE_BINARY_BYTES)throw new Error('workspace_drive_binary_too_large')
  const id=encodeURIComponent(String(file.id||''))
  if(!id)throw new Error('workspace_file_id_missing')
  const response=await workspaceFetch(actor,`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
  if(!response.ok)throw new Error(`workspace_drive_binary_fetch_failed:${response.status}`)
  const declared=Number(response.headers.get('content-length')||0)
  if(declared>MAX_DRIVE_BINARY_BYTES)throw new Error('workspace_drive_binary_too_large')
  const bytes=Buffer.from(await response.arrayBuffer())
  if(bytes.length>MAX_DRIVE_BINARY_BYTES)throw new Error('workspace_drive_binary_too_large')
  return bytes
}

function xmlText(xml:string){
  return xml
    .replace(/<w:tab\/?\s*>/g,'\t').replace(/<w:br\/?\s*>/g,'\n')
    .replace(/<a:br\/?\s*>/g,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s+/g,' ').trim()
}

async function extractOfficeText(bytes:Buffer,kind:'docx'|'pptx'){
  const JSZip=(await import('jszip')).default
  const zip=await JSZip.loadAsync(bytes)
  const names=Object.keys(zip.files)
    .filter(name=>kind==='docx'?name==='word/document.xml':/^ppt\/slides\/slide\d+\.xml$/.test(name))
    .slice(0,80)
  const chunks:string[]=[]
  let length=0
  for(const name of names){
    const xml=await zip.file(name)?.async('string')
    if(!xml)continue
    const text=xmlText(xml)
    if(text){chunks.push(text);length+=text.length+1}
    if(length>=MAX_DRIVE_TEXT)break
  }
  return chunks.join('\n').slice(0,MAX_DRIVE_TEXT)
}

async function extractDriveBinaryText(bytes:Buffer,kind:DriveBinaryKind){
  if(kind==='pdf'){
    const pdf:any=await import('pdf-parse')
    if(typeof pdf.PDFParse!=='function')throw new Error('workspace_pdf_parser_unavailable')
    const parser=new pdf.PDFParse({data:bytes})
    try{
      const result=await parser.getText()
      return String(result?.text||'').slice(0,MAX_DRIVE_TEXT)
    }finally{
      await parser.destroy?.()
    }
  }
  if(kind==='docx'||kind==='pptx')return extractOfficeText(bytes,kind)
  const XLSX:any=await import('xlsx')
  const book=XLSX.read(bytes,{type:'buffer'})
  const chunks=book.SheetNames.slice(0,20).map((sheet:string)=>`[${sheet}]\n${XLSX.utils.sheet_to_csv(book.Sheets[sheet])}`)
  return chunks.join('\n\n').slice(0,MAX_DRIVE_TEXT)
}

export async function readWorkspaceDriveBinaryText(actor:AgentActor,file:DriveBinaryFile):Promise<DriveBinaryRead>{
  const name=clean(file.name||'file',240)
  const mimeType=String(file.mimeType||'')
  const extraction=driveBinaryKind(file)
  if(!extraction)return {supported:false,name,mimeType,text:'',reason:'unsupported'}
  if(Number(file.size||0)>MAX_DRIVE_BINARY_BYTES)return {supported:false,name,mimeType,text:'',reason:'too_large'}
  try{
    const bytes=await fetchDriveBytes(actor,file)
    const extracted=await extractDriveBinaryText(bytes,extraction)
    const text=clean(extracted,MAX_DRIVE_TEXT)
    if(!text)return {supported:false,name,mimeType,text:'',reason:'unreadable'}
    return {supported:true,name,mimeType,text,extraction}
  }catch(err:any){
    const code=String(err?.message||'')
    if(code==='workspace_drive_binary_too_large')return {supported:false,name,mimeType,text:'',reason:'too_large'}
    if(['workspace_not_connected','workspace_reconnect_required','workspace_scope_required'].includes(code))throw err
    console.error('WORKSPACE_DRIVE_BINARY_READ_FAILED:',code.slice(0,120))
    return {supported:false,name,mimeType,text:'',reason:'unreadable'}
  }
}

export const DRIVE_BINARY_LIMIT_BYTES = MAX_DRIVE_BINARY_BYTES
