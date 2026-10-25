import {decodeHtmlEntities,formatEmailSnippet} from '@/lib/security/email-redaction'
export {decodeHtmlEntities,formatEmailSnippet,redactEmailAuthSecrets} from '@/lib/security/email-redaction'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { refreshGmailAccessToken } from '@/lib/google-gmail'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { decryptGoogleToken, encryptGoogleToken, hasGoogleTokenEncryptionKey, isEncryptedGoogleToken } from '@/lib/security/google-token-crypto'
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
  return redactSecretShapedText(decodeHtmlEntities(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, max))
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

// "show my latest email from Google" names a sender. That is a Gmail from: constraint, not a keyword:
// a keyword search for "google" would match any mail that mentions Google, and dropping it returns the
// five newest messages of anyone. Returns the sender and the sentence without the "from X" clause.
export function extractEmailSender(input: string): { sender: string | null; rest: string } {
  const raw = String(input || '').replace(/\s+/g, ' ').trim()
  const m = raw.match(/\b(?:e-?mails?|mails?|messages?|notifications?|alerts?)\s+(?:sent\s+)?(?:from|by)\s+([A-Za-z0-9][A-Za-z0-9 .&'@_-]{0,40}?)(?=\s*(?:[?.!,;]|$|\b(?:about|regarding|with|containing|that|which|and|then|please|today|yesterday|last|this)\b))/i)
  if (!m) return { sender: null, rest: raw }
  const sender = m[1].replace(/\s+/g, ' ').trim().replace(/[()"\\]/g, '')
  if (!sender) return { sender: null, rest: raw }
  // "unread emails from today" (23 Oct live): a time, not a sender.
  if (/^(?:today|yesterday|tonight|this (?:morning|week|month)|last (?:week|night|month|\d+ days?)|the (?:last|past) \w+(?: days?)?|now)$/i.test(sender)) return { sender: null, rest: raw }
  return { sender, rest: raw.replace(m[0], ' ').replace(/\s+/g, ' ').trim() }
}

async function credentials(actor: AgentActor) {
  const { data, error } = await supabaseAdmin.from('users')
    .select('gmail_connected,gmail_access_token,gmail_refresh_token,gmail_email')
    .eq('telegram_id', actor.legacyTelegramId).maybeSingle()
  if (error) throw new Error(`workspace_credentials_failed:${error.message}`)
  if (!data?.gmail_connected) throw new Error('workspace_not_connected')
  if (!data.gmail_access_token && !data.gmail_refresh_token) throw new Error('workspace_reconnect_required')

  const accessStored=String(data.gmail_access_token||'')
  const refreshStored=String(data.gmail_refresh_token||'')
  const access=decryptGoogleToken(accessStored)
  const refresh=decryptGoogleToken(refreshStored)

  // Backward-compatible one-time migration for the two pre-encryption connections:
  // once the Vercel encryption key exists, the first Workspace read rewrites any
  // legacy plaintext token into authenticated ciphertext.
  if (hasGoogleTokenEncryptionKey() &&
      ((accessStored && !isEncryptedGoogleToken(accessStored)) ||
       (refreshStored && !isEncryptedGoogleToken(refreshStored)))) {
    const patch:any={}
    if(accessStored&&!isEncryptedGoogleToken(accessStored))patch.gmail_access_token=encryptGoogleToken(accessStored)
    if(refreshStored&&!isEncryptedGoogleToken(refreshStored))patch.gmail_refresh_token=encryptGoogleToken(refreshStored)
    const {error:migrateError}=await supabaseAdmin.from('users').update(patch).eq('telegram_id',actor.legacyTelegramId)
    if(migrateError)throw new Error(`workspace_token_migration_failed:${migrateError.message}`)
  }

  return {...data,gmail_access_token:access,gmail_refresh_token:refresh} as any
}

async function refresh(actor: AgentActor, refreshToken: string) {
  const token = await refreshGmailAccessToken(refreshToken)
  if (!token) throw new Error('workspace_reconnect_required')
  const { error } = await supabaseAdmin.from('users').update({ gmail_access_token: encryptGoogleToken(token) }).eq('telegram_id', actor.legacyTelegramId)
  if (error) console.error('WORKSPACE_ACCESS_TOKEN_PERSIST_FAILED:', error.message)
  return token
}

async function composioDriveFor(actor: AgentActor): Promise<((url:string)=>Promise<Response>)|null> {
  try{
    const c:any=await import('@/lib/connectors/composio-gmail')
    if(typeof c?.composioConfigured!=='function'||!c.composioConfigured())return null
    const o:any=await import('@/lib/dashboard/owner-ids')
    const ids=[String(actor.legacyTelegramId),...(typeof o?.idsForWhatsapp==='function'?await o.idsForWhatsapp(actor.whatsappId):[])]
    const account=await c.activeDriveAccount(ids)
    if(!account)console.log('COMPOSIO_DRIVE_NONE:',JSON.stringify({ids:ids.map(v=>`${v.slice(0,1)}…${v.slice(-4)}`)}))
    return account?(url:string)=>c.composioDriveFetch(account,url):null
  }catch(err:any){console.error('COMPOSIO_DRIVE_LOOKUP_FAILED:',String(err?.message||err).slice(0,160));return null}
}

async function workspaceFetch(actor: AgentActor, url: string, init: RequestInit = {}) {
  // OAuth reach and the user's read preference are separate. Check before even
  // loading credentials; Drive/Contacts retain their independent Workspace access.
  if(url.startsWith('https://gmail.googleapis.com/')){
    const {data:consent,error}=await supabaseAdmin.from('user_consent_settings')
      .select('gmail_enabled').eq('telegram_id',actor.legacyTelegramId).maybeSingle()
    if(error)throw new Error('workspace_email_consent_unavailable')
    if(consent?.gmail_enabled===false)throw new Error('workspace_email_reading_disabled')
  }
  // Google Drive while AskGogo's own Google verification is pending (24 Oct): use the person's Composio Drive
  // connection when there is one; their own Workspace token is still preferred when it works.
  // 24 Oct live: the native token existed (from a Gmail Send upgrade) but had no Drive scope, so Drive got 403 and
  // the Composio connection was never tried. Composio is now used when native is missing OR answers 401/403.
  let viaComposio:((url:string)=>Promise<Response>)|null=null
  if(url.startsWith('https://www.googleapis.com/drive/v3/')){
    viaComposio=await composioDriveFor(actor)
    if(viaComposio){
      let native:any=null
      try{native=await credentials(actor)}catch{}
      if(!native)return viaComposio(url)
    }
  }
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
  if ((response.status === 403 || response.status === 401) && viaComposio) return viaComposio(url)
  if (response.status === 403) throw new Error('workspace_scope_required')
  return response
}

function header(headers:any[], name:string) {
  return String((headers || []).find((x:any) => String(x?.name || '').toLowerCase() === name.toLowerCase())?.value || '')
}

async function gmailMetadata(actor:AgentActor, id:string, auditBody=false) {
  const url=`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=${auditBody?'full':'metadata'}&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Date&metadataHeaders=Message-ID`
  const response=await workspaceFetch(actor,url)
  if(!response.ok)throw new Error(`workspace_email_message_failed:${response.status}`)
  const data:any=await response.json()
  const headers=data?.payload?.headers||[]
  // Read inline text only: no attachment downloads, remote images or HTML execution.
  const parts=auditBody?flattenMimeParts(data?.payload).filter(p=>!p.filename&&p.body?.data):[]
  const plain=parts.filter(p=>p.mimeType==='text/plain')
  const selected=plain.length?plain:parts.filter(p=>p.mimeType==='text/html')
  const body=selected.slice(0,8).map(p=>decodeBase64Url(String(p.body.data).slice(0,90_000)).toString('utf8').slice(0,60_000)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi,' ').replace(/<[^>]+>/g,' ')).join(' ')
  return {
    id:String(data?.id||id),
    threadId:String(data?.threadId||''),
    subject:formatEmailSnippet(header(headers,'Subject')||'(No subject)',240),
    from:formatEmailSnippet(header(headers,'From')||'Unknown sender',240),
    to:formatEmailSnippet(header(headers,'To'),240),
    date:clean(header(headers,'Date'),120),
    snippet:formatEmailSnippet(data?.snippet||''),
    ...(auditBody?{evidence:formatEmailSnippet(body||data?.snippet||'',5000)}:{}),
  }
}

/** Messages for an exact Gmail query (newest first), metadata only. */
export async function searchWorkspaceEmailsByQuery(actor:AgentActor, q:string, maxResults=5) {
  const params=new URLSearchParams({maxResults:String(Math.max(1,Math.min(10,Math.floor(maxResults||5)))),q})
  const response=await workspaceFetch(actor,`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`)
  if(!response.ok)throw new Error(`workspace_email_search_failed:${response.status}`)
  const data:any=await response.json()
  const ids=(Array.isArray(data?.messages)?data.messages:[]).map((x:any)=>String(x?.id||'')).filter(Boolean)
  const messages=await Promise.all(ids.map((id:string)=>gmailMetadata(actor,id)))
  return messages.filter(Boolean).sort((a:any,b:any)=>(Date.parse(b.date||'')||0)-(Date.parse(a.date||'')||0))
}

export async function listRecentWorkspaceInbox(actor:AgentActor, maxResults = 12) {
  const params=new URLSearchParams({
    maxResults:String(Math.max(1,Math.min(20,Math.floor(maxResults||12)))),
    q:'in:inbox newer_than:2d',
  })
  const response=await workspaceFetch(actor,`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`)
  if(!response.ok)throw new Error(`workspace_email_recent_failed:${response.status}`)
  const data:any=await response.json()
  const ids=(Array.isArray(data?.messages)?data.messages:[]).slice(0,20).map((x:any)=>String(x?.id||'')).filter(Boolean)
  const settled=await Promise.allSettled(ids.map((id:string)=>gmailMetadata(actor,id)))
  const messages=settled
    .filter((x):x is PromiseFulfilledResult<any>=>x.status==='fulfilled')
    .map(x=>x.value)
    .filter(Boolean)
  return {messages}
}

export function workspaceEmailAuditScope(input:string) {
  const text=String(input||'')
  const categoryAudit=/\baudit\b/i.test(text)||(/\bsubscription receipts\b/i.test(text)&&/\brenewal notices\b/i.test(text))
  if(!/\b(gmail|emails?|inbox|mail)\b/i.test(text)||!categoryAudit||!/\b(subscription|subscriptions|renewal|renewals)\b/i.test(text))return null
  const days=Number(text.match(/\b(?:last|past)\s+(\d+)\s+days?\b/i)?.[1]||14)
  const limit=Number(text.match(/\b(?:at most|up to|return|maximum|max)\s+(\d+)\s+messages?\b/i)?.[1]||15)
  if(days<1||days>366||limit<1||limit>20)throw new Error('workspace_email_audit_scope_out_of_range')
  // An audit asks for category alternatives; AND-ing the prose removes real receipts.
  return {days,limit,query:`{subject:receipt subject:invoice subject:renewal subject:renews subject:renewed subject:expiration subject:subscription subject:payment subject:billed subject:charged} newer_than:${days}d -in:spam -in:trash`}
}

// Search is candidate discovery, not proof that every keyword match is a bill.
// Keep explicit receipts, dues and dated renewal notices; do not infer a bill
// from developer threads, newsletters or generic subscription/payment marketing.
function emailBillingAmounts(evidence:string) {
  // Preserve explicit currency codes instead of inferring USD from "$" or a
  // currency from the account locale. Uppercase ISO codes avoid prose like "all 15".
  const codes=Intl.supportedValuesOf('currency').join('|')
  const pattern=new RegExp(`(?:\\b(?:${codes}|[Rr][Ss]\\.?)\\s*|[₹$£€¥]\\s*)\\d[\\d,]*(?:\\.\\d{1,2})?`,'g')
  return [...new Set(evidence.match(pattern)||[])]
}

export function hasEmailBillingEvidence(message:{subject?:string;evidence?:string;snippet?:string}) {
  const subject=String(message.subject||'')
  const evidence=String(message.evidence||message.snippet||'')
  if(/\(PR #\d+\)|\bpull request\b|\bissue #\d+\b/i.test(subject))return false
  if(/\b(?:read|return|delivery|message) receipts?\b/i.test(subject))return false
  const billingSubject=/\b(receipt|invoice|payment|billed|charged|renewal|renews?|renewed|expiration|expires?)\b/i.test(subject)
  const receiptAmount=/\b(receipt|invoice)\b/i.test(subject)&&emailBillingAmounts(evidence).length>0
  const transaction=/\b(amount (?:paid|due)|paid (?:on|\d|[A-Za-z]+ \d)|payment (?:was|is|of|to|due)|confirm (?:your|the) monthly payment|confirm (?:your|the|monthly) (?:[A-Z]{2,3})?\s*[$₹£€\d]|invoice balance|outstanding (?:balance|dues)|(?:has been|was|is) (?:debited|charged)|bill payment (?:was|is) due)\b/i.test(evidence)
  const renewal=/\b(?:renewal(?: date)?|renews?|expiration(?: date)?|expires?)\s*(?:on|at|:|is)?\s*(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{4})/i.test(evidence)
  return receiptAmount||(billingSubject&&transaction)||(/\b(subscription|membership|renewal|renews?|expiration|expires?)\b/i.test(subject)&&renewal)
}

export function formatWorkspaceEmailAudit(result:{messages:any[];audit?:{days:number;limit:number;hasMore:boolean;inspected?:number;excluded?:number}|null}) {
  if(!result.audit)return ''
  const {days,limit,hasMore}=result.audit
  const lines=result.messages.map((m:any,index:number)=>{
    const evidence=String(m.evidence||m.snippet||'')
    // Preserve all amounts as quoted evidence; never decide which amount is a recurring bill.
    const amounts=emailBillingAmounts(evidence)
    const date='(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}\\s+[A-Za-z]{3,9}\\s+\\d{4}|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4})'
    const renewal=evidence.match(new RegExp('\\b(?:renewal(?: date)?|renews?|expiration(?: date)?|expires?)\\s*(?:on|at|:|is)?\\s*('+date+')','i'))?.[1]
    return `${index+1}. ${m.subject}\nSender/service evidence: ${m.from}${m.date?`\nEmail date: ${m.date}`:''}\nAmounts/currencies shown: ${amounts.join('; ')||'Not shown in the readable text'}\nRenewal/expiration date: ${renewal||'Not explicitly shown in the readable text'}\nEmail evidence: ${formatEmailSnippet(evidence,700)}`
  })
  const scope=result.audit.inspected!==undefined?`\n${result.audit.inspected} candidate messages checked; ${result.audit.excluded||0} excluded because their readable text did not establish a billing or renewal notice.`:''
  return `Gmail subscription audit · last ${days} days · up to ${limit} messages\nBilling/renewal email evidence (subject search; not a verified active-subscription inventory).${scope}\n\n${lines.length?lines.join('\n\n'):'No billing or renewal evidence found among the checked candidates.'}\n\n${hasMore?'More matching messages exist; this is a bounded audit, not a complete inbox inventory.':'Only matching messages returned by this bounded search were checked.'} Sender names and email text are evidence; subscription status, usage and future charges are not inferred. No email, cancellation, reminder or calendar change was made.`
}

/** Gmail search operators for plain-language filters, and the words they replace. */
export function gmailFiltersFor(input:string):{operators:string[];consumed:Set<string>}{
  const t=String(input||'').toLowerCase()
  const operators:string[]=[],consumed=new Set<string>()
  const use=(re:RegExp,op:string,words:string[])=>{if(re.test(t)){operators.push(op);words.forEach(w=>consumed.add(w))}}
  use(/\bunread\b/,'is:unread',['unread'])
  use(/\b(?:important|priority)\b/,'is:important',['important','priority'])
  use(/\bstarred\b/,'is:starred',['starred'])
  if(/\btoday\b|\bthis morning\b/.test(t)){operators.push('newer_than:1d');['today','morning'].forEach(w=>consumed.add(w))}
  else if(/\byesterday\b/.test(t)){operators.push('newer_than:2d');consumed.add('yesterday')}
  else if(/\bthis week\b|\blast 7 days\b|\bpast week\b/.test(t)){operators.push('newer_than:7d');['week','last','past','days'].forEach(w=>consumed.add(w))}
  if(operators.length){
    ;['summarise','summarize','summary','emails','email','mails','mail','inbox','gmail','my','from','all','new','recent','latest','show','read','check','list','what','are','any'].forEach(w=>consumed.add(w))
    if(!operators.some(o=>o.startsWith('in:')))operators.push('in:inbox')
    // A summary of what came in skips promotions and social mail unless asked (23 Oct live: the "unread today"
    // summary led with a Chrome-extension promo and a cricket ad).
    if(/\b(?:summar|digest|what came in|need(?:s)? (?:my )?(?:attention|reply)|catch me up)/.test(t)&&!/\b(?:promo|promotion|offer|deal|sale|newsletter|social)/.test(t))operators.push('-category:promotions','-category:social')
  }
  return {operators,consumed}
}

export async function searchWorkspaceEmails(actor:AgentActor, input:string, options:{missionText?:string;topic?:'meeting'}={}) {
  const stepAudit=workspaceEmailAuditScope(input)
  const audit=stepAudit?(workspaceEmailAuditScope(options.missionText||'')||stepAudit):null
  const exactSubject=String(input||'').match(/subject\s+["“]([^"”]{2,240})["”]/i)?.[1]?.trim()
  // An explicit room identifier is the user's matching constraint, not a word
  // to discard after six generic terms such as "connected", "contain" or "link".
  const rooms=[...new Set([...String(input||'').matchAll(/(?:^|[\s(<])(?:https:\/\/)?meet\.google\.com\/([a-z]{3}-[a-z]{4}-[a-z]{3})(?=$|[\s.,;!?)}\]])/gi)].map(match=>match[1].toLowerCase()))]
  if(rooms.length>1)throw new Error('workspace_email_meeting_link_ambiguous')
  const meetingLink=rooms.length?`meet.google.com/${rooms[0]}`:null
  const senderPart=extractEmailSender(input)
  const terms=meetingLink?[meetingLink]:workspaceSearchTerms(senderPart.rest)
  if(options.topic==='meeting'&&!terms.includes('meeting'))terms.unshift('meeting')
  const subjectQuery=exactSubject?`subject:"${exactSubject.replace(/"/g,'')}"`:''
  // "Summarise my unread emails from today" (23 Oct live): the words "unread"/"today" were searched as text and
  // nothing matched. They are Gmail filters, not keywords.
  const filters=gmailFiltersFor(input)
  if(filters.operators.length){
    for(let i=terms.length-1;i>=0;i--)if(filters.consumed.has(terms[i].toLowerCase()))terms.splice(i,1)
  }
  const q=audit?audit.query:filters.operators.length&&!meetingLink&&!exactSubject
    ? [senderPart.sender?`from:(${senderPart.sender})`:'',...terms,...filters.operators,'-in:spam','-in:trash'].filter(Boolean).join(' ').trim()
    :meetingLink
    ? [subjectQuery,`"${meetingLink}"`,'-in:spam','-in:trash'].filter(Boolean).join(' ')
    : exactSubject?`${subjectQuery} -in:spam -in:trash`:[senderPart.sender?`from:(${senderPart.sender})`:'',...terms,'newer_than:2y'].filter(Boolean).join(' ').trim()
  const maxEmails=audit?.limit||MAX_EMAILS
  const params=new URLSearchParams({maxResults:String(maxEmails)})
  if(q)params.set('q',q)
  const response=await workspaceFetch(actor,`https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`)
  if(!response.ok)throw new Error(`workspace_email_search_failed:${response.status}`)
  const data:any=await response.json()
  const ids=(Array.isArray(data?.messages)?data.messages:[]).slice(0,maxEmails).map((x:any)=>String(x?.id||'')).filter(Boolean)
  const settled=await Promise.allSettled(ids.map((id:string)=>gmailMetadata(actor,id,Boolean(audit))))
  const failed=settled.find(x=>x.status==='rejected')
  if(failed?.status==='rejected')throw failed.reason
  const candidates=settled.filter((x):x is PromiseFulfilledResult<any>=>x.status==='fulfilled').map(x=>x.value).filter(Boolean)
  const messages=audit?candidates.filter(hasEmailBillingEvidence):candidates
  return {queryTerms:terms,messages,audit:audit?{days:audit.days,limit:audit.limit,hasMore:Boolean(data?.nextPageToken),inspected:candidates.length,excluded:candidates.length-messages.length}:null}
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

/** Exact-title lookup for a content read: `name = '<title>'`, not the broad name/fullText OR search, so an active
 *  Drive does not return "more matches" for a unique title (release review, 22 Oct). */
export function driveExactNameQ(title:string){
  return `trashed = false and name = '${String(title).replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`
}

export async function searchWorkspaceDrive(actor:AgentActor, input:string, opts:{exactName?:string}={}) {
  const terms=workspaceSearchTerms(input)
  const params=new URLSearchParams({
    q:opts.exactName?driveExactNameQ(opts.exactName):driveQ(terms),
    pageSize:String(MAX_FILES),
    orderBy:'modifiedTime desc',
    fields:'nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,webViewLink,size)',
    spaces:'drive',
  })
  const response=await workspaceFetch(actor,`https://www.googleapis.com/drive/v3/files?${params}`)
  if(!response.ok)throw new Error(`workspace_drive_search_failed:${response.status}`)
  const data:any=await response.json()
  // Drive may omit `files` for an empty result under a fields mask; that is zero files, not an invalid response.
  if (!data || (data.files !== undefined && !Array.isArray(data.files)) || (data.files?.length || 0) > MAX_FILES) throw new Error('workspace_drive_response_invalid')
  const files=(Array.isArray(data?.files)?data.files:[]).slice(0,MAX_FILES).map((file:any)=>({
    id:String(file?.id||''),name:clean(file?.name||'Untitled',240),mimeType:String(file?.mimeType||''),
    modifiedTime:String(file?.modifiedTime||''),webViewLink:String(file?.webViewLink||''),size:Number(file?.size||0)||null,
  })).filter((x:any)=>x.id)
  return {queryTerms:terms,files,hasMore:Boolean(data.nextPageToken || data.incompleteSearch)}
}

async function workspaceText(actor:AgentActor,url:string) {
  const response=await workspaceFetch(actor,url)
  if(!response.ok)throw new Error(`workspace_file_read_failed:${response.status}`)
  const declared=Number(response.headers.get('content-length')||0)
  if(declared>MAX_FILE_TEXT*4)throw new Error('workspace_file_too_large')
  const raw=await response.text()
  return {text:clean(raw.slice(0,MAX_FILE_TEXT),MAX_FILE_TEXT),truncated:raw.length>MAX_FILE_TEXT}
}

export async function readWorkspaceDriveText(actor:AgentActor,file:{id:string;mimeType:string;name?:string}) {
  const id=encodeURIComponent(String(file.id||''))
  const mime=String(file.mimeType||'')
  if(!id)throw new Error('workspace_file_id_missing')
  let content:{text:string;truncated:boolean}
  if(mime==='application/vnd.google-apps.document') {
    content=await workspaceText(actor,`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/plain')}`)
  } else if(mime==='application/vnd.google-apps.spreadsheet') {
    content=await workspaceText(actor,`https://www.googleapis.com/drive/v3/files/${id}/export?mimeType=${encodeURIComponent('text/csv')}`)
  } else if(/^text\//.test(mime)||['application/json','application/xml'].includes(mime)) {
    content=await workspaceText(actor,`https://www.googleapis.com/drive/v3/files/${id}?alt=media`)
  } else {
    return {supported:false,name:clean(file.name||'file',240),mimeType:mime,text:'',truncated:false}
  }
  return {supported:true,name:clean(file.name||'file',240),mimeType:mime,...content}
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
