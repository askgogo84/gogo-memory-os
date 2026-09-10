import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

const MAX_EMAILS = 6
const MAX_CONTACTS = 8
const MAX_FILES = 8
const MAX_FILE_TEXT = 60_000
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
const MAX_ATTACHMENT_MESSAGES = 3

const STOP = new Set([
  'about','after','attached','attachment','attachments','before','brief','drive','email','emails','file','files','find','from','gmail','google','inbox','latest','message','messages','read','recent','search','show','the','this','with','workspace','unread','please','look','looking','need','meeting','document','documents','use','using',
])

function clean(value: unknown, max = 1200) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

export function workspaceSearchTerms(input: string, maxTerms = 6) {
  const quoted = Array.from(String(input || '').matchAll(/["“]([^"”]{2,80})["”]/g)).map((m) => m[1])
  const words = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9@._'-]+/g, ' ')
    .split(/\s+/)
    .map((x) => x.trim())
    .filter((x) => x.length > 2 && !STOP.has(x))
  const out:string[]=[]
  for (const term of [...quoted, ...words]) {
    const safe = clean(term, 80)
    if (safe && !out.some((x) => x.toLowerCase() === safe.toLowerCase())) out.push(safe)
    if (out.length >= maxTerms) break
  }
  return out
}

async function credentials(actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_access_token,gmail_refresh_token,gmail_email')
    .eq('telegram_id', actor.legacyTelegramId).maybeSingle()
  if (error) throw new Error(`workspace_credentials_failed:${error.message}`)
  if (!data?.gmail_connected) throw new Error('workspace_not_connected')
  if (!data.gmail_access_token && !data.gmail_refresh_token) throw new Error('workspace_reconnect_required')
  return data as any
}

async function refresh(actor: AgentActor, refreshToken: string) {
  const token = await refreshGmailAccessToken(refreshToken)
  if (!token) throw new Error('workspace_reconnect_required')
  const { error } = await supabaseAdmin.from('users').update({ gmail_access_token: token }).eq('telegram_id', actor.legacyTelegramId)
  if (error) console.error('WORKSPACE_ACCESS_TOKEN_PERSIST_FAILED:', error.message)
  return token
}

async function workspaceFetch(actor: AgentActor, url: string, init: RequestInit = {}) {
  const creds = await credentials(actor)
  let token = String(creds.gmail_access_token || '')
  if (!token && creds.gmail_refresh_token) token = await refresh(actor, String(creds.gmail_refresh_token))

  const run = (accessToken:string) => fetch(url, {
    ...init,
    headers: { ...(init.headers || {}), Authorization:`Bearer ${accessToken}` },
    cache:'no-store',
  })
  let response = await run(token)
  if (response.status === 401 && creds.gmail_refresh_token) {
    token = await refresh(actor, String(creds.gmail_refresh_token))
    response = await run(token)
  }
  if (response.status === 403) throw new Error('workspace_scope_required')
  return response
}

function header(headers:any[], name:string) {
  return String((headers || []).find((x:any) => String(x?.name || '').toLowerCase() === name.toLowerCase())?.value || '')
}

async function gmailMetadata(actor:AgentActor, id:string) {
  const url=`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Message-ID`
  const response=await workspaceFetch(actor,url)
  if(!response.ok)return null
  const data:any=await response.json()
  const headers=data?.payload?.headers||[]
  return {
    id:String(data?.id||id),
    threadId:String(data?.threadId||''),
    subject:clean(header(headers,'Subject')||'(No subject)',240),
    from:clean(header(headers,'From')||'Unknown sender',240),
    to:clean(header(headers,'To'),240),
    date:clean(header(headers,'Date'),120),
    snippet:clean(data?.snippet||'',700),
  }
}

export async function searchWorkspaceEmails(actor:AgentActor, input:string) {
  const terms=workspaceSearchTerms(input)
  const q=[...terms,'newer_than:2y'].join(' ').trim()
  const params=new URLSearchParams({maxResults:String(MAX_EMAILS)})
  if(q)params.set('q',q)
  const response=await workspaceFetch(actor,`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`)
  if(!response.ok)throw new Error(`workspace_email_search_failed:${response.status}`)
  const data:any=await response.json()
  const ids=(Array.isArray(data?.messages)?data.messages:[]).slice(0,MAX_EMAILS).map((x:any)=>String(x?.id||'')).filter(Boolean)
  const settled=await Promise.allSettled(ids.map((id:string)=>gmailMetadata(actor,id)))
  const messages=settled.filter((x):x is PromiseFulfilledResult<any>=>x.status==='fulfilled').map(x=>x.value).filter(Boolean)
  return {queryTerms:terms,messages}
}

function contactName(person:any) {
  const primary=(person?.names||[]).find((x:any)=>x?.metadata?.primary)||(person?.names||[])[0]
  return clean(primary?.displayName||'',180)
}

export async function searchWorkspaceContacts(actor:AgentActor, input:string) {
  const terms=workspaceSearchTerms(input,3)
  const query=terms.join(' ').trim()
  if(!query)return {query:'',status:'missing_query' as const,contacts:[]}
  const params=new URLSearchParams({query,readMask:'names,emailAddresses',pageSize:String(MAX_CONTACTS)})
  const response=await workspaceFetch(actor,`https://people.googleapis.com/v1/people:searchContacts?${params}`)
  if(!response.ok)throw new Error(`workspace_contact_search_failed:${response.status}`)
  const data:any=await response.json()
  const contacts=(Array.isArray(data?.results)?data.results:[]).map((row:any)=>row?.person).filter(Boolean).slice(0,MAX_CONTACTS).map((person:any)=>({
    resourceName:clean(person?.resourceName||'',160),
    name:contactName(person),
    emails:(person?.emailAddresses||[]).map((x:any)=>clean(x?.value||'',220)).filter(Boolean).slice(0,3),
  })).filter((x:any)=>x.name||x.emails.length)
  const exact=contacts.filter((x:any)=>x.name.toLowerCase()===query.toLowerCase())
  const usable=(exact.length?exact:contacts).filter((x:any)=>x.emails.length)
  const uniqueEmails=new Set(usable.flatMap((x:any)=>x.emails.map((e:string)=>e.toLowerCase())))
  const status=usable.length===1&&uniqueEmails.size===1?'resolved':usable.length===0?'not_found':'ambiguous'
  return {query,status,contacts:usable}
}

function driveQ(terms:string[]) {
  const safe=terms.slice(0,3).map((term)=>term.replace(/\\/g,'\\\\').replace(/'/g,"\\'"))
  if(!safe.length)return 'trashed = false'
  return `trashed = false and (${safe.map((term)=>`name contains '${term}' or fullText contains '${term}'`).join(' or ')})`
}

export async function searchWorkspaceDrive(actor:AgentActor, input:string) {
  const terms=workspaceSearchTerms(input)
  const params=new URLSearchParams({
    q:driveQ(terms),
    pageSize:String(MAX_FILES),
    orderBy:'modifiedTime desc',
    fields:'files(id,name,mimeType,modifiedTime,webViewLink,size)',
    spaces:'drive',
  })
  const response=await workspaceFetch(actor,`https://www.googleapis.com/drive/v3/files?${params}`)
  if(!response.ok)throw new Error(`workspace_drive_search_failed:${response.status}`)
  const data:any=await response.json()
  const files=(Array.isArray(data?.files)?data.files:[]).slice(0,MAX_FILES).map((file:any)=>({
    id:String(file?.id||''),name:clean(file?.name||'Untitled',240),mimeType:String(file?.mimeType||''),
    modifiedTime:String(file?.modifiedTime||''),webViewLink:String(file?.webViewLink||''),size:Number(file?.size||0)||null,
  })).filter((x:any)=>x.id)
  return {queryTerms:terms,files}
}

async function workspaceText(actor:AgentActor,url:string) {
  const response=await workspaceFetch(actor,url)
  if(!response.ok)throw new Error(`workspace_file_read_failed:${response.status}`)
  const declared=Number(response.headers.get('content-length')||0)
  if(declared>MAX_FILE_TEXT*4)throw new Error('workspace_file_too_large')
  const text=(await response.text()).slice(0,MAX_FILE_TEXT)
  return clean(text,MAX_FILE_TEXT)
}

export async function readWorkspaceDriveText(actor:AgentActor,file:{id:string;mimeType:string;name?:string}) {
  const id=encodeURIComponent(String(file.id||''))
  const mime=String(file.mimeType||'')
  if(!id)throw new Error('workspace_file_id_missing')
  let text=''
  if(mime==='application/vnd.google-apps.document') {
    text=await workspaceText(actor,`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/plain')}`)
  } else if(mime==='application/vnd.google-apps.spreadsheet') {
    text=await workspaceText(actor,`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/csv')}`)
  } else if(/^text\//.test(mime)||['application/json','application/xml'].includes(mime)) {
    text=await workspaceText(actor,`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
  } else {
    return {supported:false,name:clean(file.name||'file',240),mimeType:mime,text:''}
  }
  return {supported:true,name:clean(file.name||'file',240),mimeType:mime,text}
}

type GmailAttachmentCandidate = {
  messageId:string
  subject:string
  filename:string
  mimeType:string
  attachmentId?:string
  inlineData?:string
  declaredSize:number
  score:number
}

function decodeBase64Url(value:string) {
  return Buffer.from(String(value||'').replace(/-/g,'+').replace(/_/g,'/'),'base64')
}

function flattenMimeParts(part:any, out:any[] = []) {
  if(!part)return out
  out.push(part)
  for(const child of Array.isArray(part?.parts)?part.parts:[])flattenMimeParts(child,out)
  return out
}

function attachmentSupported(filename:string,mimeType:string) {
  const name=filename.toLowerCase()
  const mime=mimeType.toLowerCase()
  return /^text\//.test(mime) || ['application/json','application/xml','application/pdf'].includes(mime) ||
    /\.(txt|md|csv|json|xml|html?|pdf|docx|pptx|xlsx)$/i.test(name) ||
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.presentationml.presentation','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'].includes(mime)
}

function attachmentScore(filename:string,subject:string,input:string,messageRank:number) {
  const terms=workspaceSearchTerms(input,6).map(x=>x.toLowerCase())
  const hay=`${filename} ${subject}`.toLowerCase()
  let score=Math.max(0,6-messageRank)
  if(/brief|agenda|proposal|meeting|notes|deck|presentation|report/i.test(filename))score+=4
  for(const term of terms)if(hay.includes(term))score+=2
  return score
}

async function gmailFullMessage(actor:AgentActor,messageId:string) {
  const response=await workspaceFetch(actor,`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=full`)
  if(!response.ok)throw new Error(`workspace_email_full_failed:${response.status}`)
  return response.json() as Promise<any>
}

async function collectAttachmentCandidates(actor:AgentActor,messages:any[],input:string) {
  const candidates:GmailAttachmentCandidate[]=[]
  for(let rank=0;rank<Math.min(MAX_ATTACHMENT_MESSAGES,messages.length);rank++) {
    const meta=messages[rank]
    if(!meta?.id)continue
    const full=await gmailFullMessage(actor,String(meta.id))
    const subject=clean(meta.subject||header(full?.payload?.headers||[],'Subject')||'(No subject)',240)
    for(const part of flattenMimeParts(full?.payload)) {
      const filename=clean(part?.filename||'',240)
      const mimeType=String(part?.mimeType||'application/octet-stream')
      const attachmentId=String(part?.body?.attachmentId||'')
      const inlineData=String(part?.body?.data||'')
      const declaredSize=Number(part?.body?.size||0)||0
      if(!filename||(!attachmentId&&!inlineData)||!attachmentSupported(filename,mimeType))continue
      candidates.push({
        messageId:String(meta.id),subject,filename,mimeType,
        attachmentId:attachmentId||undefined,inlineData:inlineData||undefined,declaredSize,
        score:attachmentScore(filename,subject,input,rank),
      })
    }
  }
  return candidates
}

async function fetchAttachmentBytes(actor:AgentActor,candidate:GmailAttachmentCandidate) {
  if(candidate.declaredSize>MAX_ATTACHMENT_BYTES)throw new Error('workspace_attachment_too_large')
  if(candidate.inlineData) {
    const bytes=decodeBase64Url(candidate.inlineData)
    if(bytes.length>MAX_ATTACHMENT_BYTES)throw new Error('workspace_attachment_too_large')
    return bytes
  }
  if(!candidate.attachmentId)throw new Error('workspace_attachment_missing')
  const response=await workspaceFetch(actor,`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(candidate.messageId)}/attachments/${encodeURIComponent(candidate.attachmentId)}`)
  if(!response.ok)throw new Error(`workspace_attachment_fetch_failed:${response.status}`)
  const data:any=await response.json()
  const bytes=decodeBase64Url(String(data?.data||''))
  if(bytes.length>MAX_ATTACHMENT_BYTES)throw new Error('workspace_attachment_too_large')
  return bytes
}

function xmlText(xml:string) {
  return xml
    .replace(/<w:tab\/?\s*>/g,'\t').replace(/<w:br\/?\s*>/g,'\n')
    .replace(/<a:br\/?\s*>/g,'\n').replace(/<[^>]+>/g,' ')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'")
    .replace(/\s+/g,' ').trim()
}

async function extractOfficeText(bytes:Buffer,kind:'docx'|'pptx') {
  const JSZip=(await import('jszip')).default
  const zip=await JSZip.loadAsync(bytes)
  const names=Object.keys(zip.files).filter(name=>kind==='docx'?name==='word/document.xml':/^ppt\/slides\/slide\d+\.xml$/.test(name)).slice(0,80)
  const chunks:string[]=[]
  for(const name of names) {
    const xml=await zip.file(name)?.async('string')
    if(xml)chunks.push(xmlText(xml))
    if(chunks.join('\n').length>=MAX_FILE_TEXT)break
  }
  return chunks.join('\n').slice(0,MAX_FILE_TEXT)
}

async function extractAttachmentText(bytes:Buffer,filename:string,mimeType:string) {
  const name=filename.toLowerCase(),mime=mimeType.toLowerCase()
  if(/^text\//.test(mime)||['application/json','application/xml'].includes(mime)||/\.(txt|md|csv|json|xml|html?)$/i.test(name)) {
    return bytes.toString('utf8').slice(0,MAX_FILE_TEXT)
  }
  if(mime==='application/pdf'||name.endsWith('.pdf')) {
    const pdf:any=await import('pdf-parse')
    if(typeof pdf.PDFParse!=='function')throw new Error('workspace_pdf_parser_unavailable')
    const parser=new pdf.PDFParse({data:bytes})
    try {
      const result=await parser.getText()
      return String(result?.text||'').slice(0,MAX_FILE_TEXT)
    } finally {
      await parser.destroy?.()
    }
  }
  if(mime==='application/vnd.openxmlformats-officedocument.wordprocessingml.document'||name.endsWith('.docx'))return extractOfficeText(bytes,'docx')
  if(mime==='application/vnd.openxmlformats-officedocument.presentationml.presentation'||name.endsWith('.pptx'))return extractOfficeText(bytes,'pptx')
  if(mime==='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'||name.endsWith('.xlsx')) {
    const XLSX:any=await import('xlsx')
    const book=XLSX.read(bytes,{type:'buffer'})
    const chunks=book.SheetNames.slice(0,20).map((sheet:string)=>`[${sheet}]\n${XLSX.utils.sheet_to_csv(book.Sheets[sheet])}`)
    return chunks.join('\n\n').slice(0,MAX_FILE_TEXT)
  }
  throw new Error('workspace_attachment_unsupported')
}

export type WorkspaceEmailBriefResult =
  | {status:'found';filename:string;mimeType:string;subject:string;text:string}
  | {status:'none'}
  | {status:'ambiguous';attachments:Array<{filename:string;subject:string}>}
  | {status:'too_large';filename:string}
  | {status:'unreadable';filename:string}

export async function readWorkspaceEmailBrief(actor:AgentActor,messages:any[],input:string):Promise<WorkspaceEmailBriefResult> {
  const candidates=await collectAttachmentCandidates(actor,messages,input)
  if(!candidates.length)return {status:'none'}
  candidates.sort((a,b)=>b.score-a.score||a.filename.localeCompare(b.filename))
  const top=candidates[0]
  const tied=candidates.filter(x=>x.score===top.score)
  if(tied.length>1) {
    return {status:'ambiguous',attachments:tied.slice(0,6).map(x=>({filename:x.filename,subject:x.subject}))}
  }
  try {
    const bytes=await fetchAttachmentBytes(actor,top)
    const extracted=await extractAttachmentText(bytes,top.filename,top.mimeType)
    const text=clean(extracted,MAX_FILE_TEXT)
    if(!text)return {status:'unreadable',filename:top.filename}
    return {status:'found',filename:top.filename,mimeType:top.mimeType,subject:top.subject,text}
  } catch(err:any) {
    if(String(err?.message||'')==='workspace_attachment_too_large')return {status:'too_large',filename:top.filename}
    console.error('WORKSPACE_ATTACHMENT_READ_FAILED:',String(err?.message||'unknown').slice(0,120))
    return {status:'unreadable',filename:top.filename}
  }
}
