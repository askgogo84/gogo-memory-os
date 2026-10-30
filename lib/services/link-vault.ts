import { supabaseAdmin } from '@/lib/supabase-admin'
import { mentionsExternalAccountCreation, parseExternalAccountRequest } from '@/lib/agent/external-account-intent'
import { indexMemory, unindexMemory } from '@/lib/services/memory-index'
import { embedText } from '@/lib/services/embeddings'
import { isSecretShapedMemory, redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { latestTypedContext, rememberTypedObjects, selectedTypedObject } from '@/lib/agent/typed-object-context'
import type { AgentActor } from '@/lib/agent/actor'
import { contextualizeSavedItemReply } from '@/lib/agent/contextual-association'
import { getLocalParts, zonedLocalTimeToUtc } from '@/lib/timezone'
import { clearFollowupState, getLatestFollowupState, isStrictlyFreshFollowupState, saveFollowupState } from '@/lib/bot/handlers/followup-state'

export type LinkPlatform='instagram'|'youtube'|'twitter'|'linkedin'|'tiktok'|'github'|'facebook'|'web'
export type LinkVaultRow={
  id:string; telegram_id:number; canonical_url:string; original_url:string; platform:LinkPlatform; item_type:string;
  title:string; description:string; source:string; user_note:string; note_history:any[]; saved_at:string; last_saved_at:string;
  topic:string|null; tags:string[]; shelf:string|null; preview_image:string|null; screenshot_url:string|null;
  enrichment_status:string; auth_required:boolean; source_evidence:any
}

function clean(value:unknown,max=1200){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
export function extractLinkUrl(text:string){
  const match=String(text||'').match(/https?:\/\/[^\s<>]+/i)
  return match?match[0].replace(/[),.;!?]+$/,''):null
}
export function canonicalizeLinkUrl(raw:string){
  try{
    const u=new URL(raw)
    if(!['http:','https:'].includes(u.protocol))return null
    u.hostname=u.hostname.toLowerCase().replace(/^www\./,'')
    u.hash=''
    const tracking=/^(utm_|fbclid$|gclid$|igshid$|si$|mc_|ref_src$|ref_url$)/i
    for(const key of Array.from(u.searchParams.keys()))if(tracking.test(key))u.searchParams.delete(key)
    u.searchParams.sort()
    if(u.pathname.length>1)u.pathname=u.pathname.replace(/\/+$/,'')
    return u.toString()
  }catch{return null}
}
export function detectLinkPlatform(url:string):LinkPlatform{
  let host='';try{host=new URL(url).hostname.replace(/^www\./,'').toLowerCase()}catch{}
  if(host.includes('instagram.com'))return'instagram'
  if(host.includes('youtube.com')||host==='youtu.be')return'youtube'
  if(host==='x.com'||host.includes('twitter.com'))return'twitter'
  if(host.includes('linkedin.com'))return'linkedin'
  if(host.includes('tiktok.com'))return'tiktok'
  if(host.includes('github.com'))return'github'
  if(host.includes('facebook.com')||host==='fb.watch')return'facebook'
  return'web'
}
function itemType(platform:LinkPlatform,url:string){
  if(platform==='github')return'repository'
  if(['instagram','youtube','twitter','linkedin','tiktok','facebook'].includes(platform))return'social'
  if(/\/products?\//i.test(url)||/amazon\.|flipkart\.|myntra\.|ajio\./i.test(url))return'product'
  return'article'
}
function fallbackShelf(platform:LinkPlatform,type:string){
  if(platform==='github')return'tool'
  if(type==='product')return'product'
  if(['instagram','youtube','tiktok'].includes(platform))return'inspiration'
  if(['twitter','linkedin','facebook'].includes(platform))return'social'
  return'reference'
}
function safeNote(raw:string){
  const note=clean(raw,1200)
  if(!note)return''
  if(isSecretShapedMemory(note))return'[sensitive note withheld from Link Vault]'
  return redactSecretShapedText(note)
}
function noteFromText(text:string,url:string){
  return safeNote(String(text||'').replace(url,' ')
    .replace(/^\s*(?:please\s+)?(?:save|remember|keep|store|bookmark|file)\s+(?:this\s+)?(?:link|url|page|post|reel|video|repo|repository)?\s*[-:—,]*\s*/i,'')
    .replace(/^again\s*[-:—,]*\s*/i,'')
    .replace(/\btag\s+(?:it\s+|this\s+)?[^:;]+[:;]?\s*$/i,'')
    // 22 Oct launch run (R14): removing the URL left the lead-in's colon behind ("…saving links:").
    .replace(/\s+/g,' ').trim().replace(/\s*[-:—–,;]+$/,'').trim())
}
function titleFromUrl(url:string,note:string){
  try{
    const u=new URL(url)
    const slug=decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||'').replace(/[-_]+/g,' ').trim()
    return clean(u.hostname==='github.com'?slug:note?note.split(/[.!?]/)[0]:slug||u.hostname,120)||u.hostname
  }catch{return clean(note||'Saved link',120)}
}
// 29 Oct live: a forwarded lnkd.in link was saved as "gjKPc2zn" with nothing about what it was, while another
// assistant explained the post and offered to dig in. LinkedIn's own pages are read for their preview (the same
// og:title WhatsApp shows); redirects are followed only while they stay on LinkedIn. An outside article is never
// fetched from our server: its title comes from its address.
const PREVIEW_HOSTS=/^(?:lnkd\.in|(?:[a-z]{2,3}\.)?linkedin\.com)$/i
export function isPreviewHost(url:string){try{return PREVIEW_HOSTS.test(new URL(url).hostname.replace(/^www\./i,''))}catch{return false}}
function decodeEntities(s:string){return s.replace(/&quot;/g,'"').replace(/&#x27;|&#39;|&apos;/g,"'").replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16)))}
function metaContent(html:string,name:string){
  const tag=html.match(new RegExp('<meta[^>]+(?:property|name)=["\']'+name.replace(/[.:]/g,'\\$&')+'["\'][^>]*>','i'))?.[0]
  // 30 Oct live: content="… and you don't …" was cut at the apostrophe. Match the quote that opened the value.
  const m=tag?.match(/content=(?:"([^"]*)"|'([^']*)')/i)
  return m?decodeEntities(m[1]??m[2]??'').trim():''
}
export function titleFromArticleUrl(url:string){
  try{
    const slug=decodeURIComponent(new URL(url).pathname.split('/').filter(Boolean).pop()||'').replace(/\.[a-z]{2,5}$/i,'').replace(/[-_]\d{5,}$/,'')
    const words=slug.split(/[-_]+/).filter(Boolean)
    if(words.length<4||words.some(w=>w.length>24))return null
    const t=words.join(' ')
    return t.charAt(0).toUpperCase()+t.slice(1)
  }catch{return null}
}
// A LinkedIn post's og:title is the start of the post itself ("Hone raises … outcomes Hone, a San Francisco AI company,
// has raised a $60 millio"). Keep a headline and move the rest to the description, ending on a whole word.
export function shortText(text:string,max:number){
  const t=clean(text,4000);if(t.length<=max)return t
  const cut=t.slice(0,max+1).replace(/\s+\S*$/,'').replace(/[\s,;:–—-]+$/,'')
  return cut+'…'
}
export function splitPostTitle(rawTitle:string,rawDescription=''){
  const full=clean(rawTitle,4000),desc=clean(rawDescription,4000)
  let title=full
  if(full.length>110){
    const sentence=full.slice(0,150).match(/^(.{30,}?[.!?])\s/)?.[1]
    const first=full.match(/^[A-Z][\w&'-]{2,}/)?.[0]
    const again=first?full.indexOf(' '+first,20):-1
    title=sentence||(again>20&&again<=150?full.slice(0,again):shortText(full,110))
  }
  title=title.replace(/[\s,;:–—-]+$/,'')
  const base=title.replace(/…$/,'')
  const source=desc&&desc.length>=full.length*0.6?desc:full
  let rest=source.toLowerCase().startsWith(base.toLowerCase())?source.slice(base.length):source===full?'':source
  rest=rest.replace(/^[\s.,;:–—-]+/,'')
  return{title:clean(title,160),description:shortText(rest,400)}
}
export async function linkPreview(url:string,fetchImpl:typeof fetch=fetch):Promise<{title:string;description:string;resolvedUrl:string;author?:string;postText?:string}|null>{
  let current=url
  for(let hop=0;hop<4;hop++){
    if(!isPreviewHost(current)){const t=titleFromArticleUrl(current);return t?{title:clean(t,160),description:'',resolvedUrl:current}:null}
    let res:Response|null=null
    try{res=await fetchImpl(current,{redirect:'manual',headers:{'user-agent':'WhatsApp/2.23.20.0',accept:'text/html'},signal:AbortSignal.timeout(5000)})}catch{return null}
    const loc=res.headers.get('location')
    if(res.status>=300&&res.status<400&&loc){try{current=new URL(loc,current).toString()}catch{return null};continue}
    if(!res.ok)return null
    const html=(await res.text()).slice(0,400_000)
    const title=(metaContent(html,'og:title')||decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'')).replace(/\s*\|\s*LinkedIn\s*$/i,'').replace(/\s+/g,' ').trim()
    // lnkd.in shows a "you're leaving LinkedIn" page for outside links; its button holds the real address.
    const external=html.match(/<a\b[^>]*external_url_click[^>]*>/i)?.[0]?.match(/href=["']([^"']+)["']/i)?.[1]
    if(external&&(!title||/^(?:LinkedIn|Redirecting|External link)/i.test(title))){current=decodeEntities(external);continue}
    if(!title||/^(?:LinkedIn|Sign\s*Up|Log\s*In|Redirecting)\b/i.test(title))return null
    const rawDescription=metaContent(html,'og:description')||metaContent(html,'description')
    const split=splitPostTitle(title,rawDescription)
    const author=clean(metaContent(html,'author')||html.match(/"author"\s*:\s*\{[^}]*?"name"\s*:\s*"([^"]{2,60})"/)?.[1]||'',60)
    return{title:split.title,description:split.description,resolvedUrl:current,author,postText:clean(rawDescription||title,1500)}
  }
  return null
}
const STOP=new Set(['this','that','link','saved','save','about','with','from','what','show','find','open','all','links','last','month','instagram','youtube','twitter','linkedin','github','repo','repository'])
function keywordTags(text:string,platform:LinkPlatform){
  const words=String(text||'').toLowerCase().match(/[a-z][a-z0-9-]{2,}/g)||[]
  return Array.from(new Set([platform,...words.filter(w=>!STOP.has(w))])).slice(0,8)
}
async function jevShelf(params:{platform:LinkPlatform;type:string;title:string;note:string}){
  const apiKey=String(process.env.TYPESAFE_API_KEY||'').trim()
  if(!apiKey)return null
  const stateText=clean(params.title+' '+params.note,800)
  if(isSecretShapedMemory(stateText))return null
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),650)
  try{
    const response=await fetch('https://api.typesafe.ai/v1/systemone',{
      method:'POST',headers:{Authorization:'Bearer '+apiKey,'Content-Type':'application/json'},cache:'no-store',signal:controller.signal,
      body:JSON.stringify({
        model:'jev-latest',
        state:{saved_link:{platform:params.platform,item_type:params.type,title:redactSecretShapedText(params.title),user_note:redactSecretShapedText(params.note)}},
        questions:{shelf:{type:'choice',instructions:'Choose a retrieval shelf only. This is classification, never permission.',criteria:{
          reference:'Article, documentation, research, or material mainly saved to look up later.',
          inspiration:'Creative, visual, marketing, design, or idea inspiration.',
          tool:'Software tool, code repository, developer resource, or workflow utility.',
          product:'Product, shopping item, or commercial product page.',
          social:'Social post primarily saved for discussion/community/content rather than visual inspiration.'
        }}}
      })
    })
    const body=await response.json().catch(()=>({}))
    const answer=body?.answers?.shelf
    if(response.ok&&answer?.type==='choice'&&['reference','inspiration','tool','product','social'].includes(answer.choice)&&Number(answer.confidence)>=0.55)return String(answer.choice)
    return null
  }catch{return null}finally{clearTimeout(timer)}
}
function sourceHost(url:string){try{return new URL(url).hostname.replace(/^www\./,'')}catch{return''}}

async function publicRepositoryMetadata(url:string){
  try{
    const u=new URL(url),parts=u.pathname.split('/').filter(Boolean)
    if(u.hostname!=='github.com'||parts.length<2||!parts.slice(0,2).every(part=>/^[a-z0-9_.-]+$/i.test(part)))return null
    const source=`https://api.github.com/repos/${parts.slice(0,2).map(encodeURIComponent).join('/')}`
    const response=await fetch(source,{signal:AbortSignal.timeout(1200),headers:{Accept:'application/vnd.github+json'},redirect:'error'})
    if(!response.ok)return null
    const body=await response.json()
    if(typeof body.name!=='string'||body.private===true)return null
    return{title:clean(body.name,160),description:safeNote(body.description||''),source}
  }catch{return null}
}
function restricted(platform:LinkPlatform){return['instagram','linkedin','facebook'].includes(platform)}
function mergeNotes(existing:any[],note:string){
  const values=(Array.isArray(existing)?existing:[]).map(x=>typeof x==='string'?x:String(x?.note||'')).filter(Boolean)
  if(note&&!values.some(x=>x.toLowerCase()===note.toLowerCase()))values.push(note)
  return values.slice(-12)
}
function indexContent(row:any){
  return clean('Saved link. '+row.title+'. '+row.description+'. Notes: '+row.user_note+'. Tags: '+(row.tags||[]).join(', ')+'. Platform: '+row.platform+'. Source: '+row.source+'. '+(row.topic?'Topic: '+row.topic+'.':''),1900)
}
export function isLinkVaultSaveRequest(text:string){
  const url=extractLinkUrl(text);if(!url)return false
  if(isLinkVaultQuery(text))return false
  // "Login to <link> and create the account" is an account request, not a link to save.
  if(parseExternalAccountRequest(text)||mentionsExternalAccountCreation(text))return false
  const stripped=String(text||'').replace(url,' ').trim()
  const request=String(text||'').trim().replace(/^(?:please\s+)?(?:(?:can|could|would|will)\s+you\s+(?:please\s+)?)?/i,'')
  // Explicit capture owns its note, even when the note mentions browser verbs.
  if(/^(?:save|remember|keep|store|bookmark|file)\b/i.test(request))return true
  if(/^(?:read|watch|view)\s+(?:(?:this|it)\s+)?later\b/i.test(request))return true
  const descriptiveCaption=/^(?:how\s+to|what\s+an?)\b/i.test(request)&&!/[?]\s*$/.test(request)
  // A URL in a read command is its target, not permission to store it. Keep
  // bare URL shares/captions below, and reject explicit negative capture intent.
  if(/^(?:open|use|research|check|find|tell|summari[sz]e|look|search|browse|read|go\s+to|show|visit|inspect)\b/i.test(request)
    ||(!descriptiveCaption&&/^(?:what|when|where|why|how)\b/i.test(request))
    ||/^(?:do\s+not|don't|never)\s+(?:save|remember|keep|store|bookmark|file)\b/i.test(request)
    ||/\b(?:i\s+want|i'd\s+like)\s+you\s+to\s+(?:open|use|research|check|find|tell|summari[sz]e|look|search|browse|read|go\s+to|show|visit|inspect)\b/i.test(request))return false
  if(/\b(save|remember|keep|store|bookmark|file)\b/i.test(stripped))return true
  if(/\b(book|reserve|buy|purchase|checkout|apply|submit|monitor|watch|compare|translate|summari[sz]e|check availability)\b/i.test(stripped))return false
  return stripped.length<180
}
export function isLinkVaultQuery(text:string){
  const t=String(text||'').trim().toLowerCase()
  if(/^(?:please\s+)?(?:save|remember|keep|store|bookmark|file)\b/i.test(t))return false
  return /\b(?:saved|my)\s+(?:links?|reels?|repos?|repositories|bookmarks?)\b/.test(t)
    ||/^(?:retrieve|find|show|open|read|get)\b[\s\S]*\b(?:saved|stored|bookmarked)\b[\s\S]*\b(?:link|url|repo|reel|page)\b/i.test(t)
    ||/^find\s+(?:that\s+)?(?:instagram\s+|youtube\s+|github\s+)?(?:link|reel|repo|repository|post).*(?:saved|about|on)/i.test(t)
    ||/^what\s+was\s+that\s+(?:github\s+)?(?:repo|repository|link)/i.test(t)
    ||/^show\s+all\s+links?\s+i\s+saved/i.test(t)
    ||/^open\s+(?:the\s+)?(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+.*(?:link|reel|repo|one)/i.test(t)
}
function platformFilter(text:string):LinkPlatform|null{
  const t=text.toLowerCase()
  if(/instagram/.test(t))return'instagram';if(/youtube/.test(t))return'youtube'
  if(/\b(?:x|twitter)\b/.test(t))return'twitter';if(/linkedin/.test(t))return'linkedin'
  if(/github|\brepo(?:sitory)?\b/.test(t))return'github';if(/tiktok/.test(t))return'tiktok'
  if(/facebook/.test(t))return'facebook';return null
}
function requestedTag(text:string){return clean(text.match(/\b(?:tagged|tag:)\s*#?([a-z0-9_-]+)/i)?.[1]||'',60).toLowerCase()||null}
function searchTerms(text:string){
  return clean(text,500).toLowerCase().replace(/https?:\/\/\S+/g,' ')
    .replace(/\b(?:find|retrieve|read|get|show|open|what|was|that|the|all|links?|saved|stored|save|about|my|i|last|month|today|yesterday|instagram|youtube|twitter|linkedin|github|repo|repository|reel|post|tagged)\b/g,' ')
    .replace(/[^a-z0-9]+/g,' ').replace(/\s+/g,' ').trim()
}
function ordinal(text:string){
  const m=text.match(/\b(first|second|third|fourth|fifth|(\d+)(?:st|nd|rd|th)?)\b/i);if(!m)return null
  const words=['first','second','third','fourth','fifth'],v=m[1].toLowerCase()
  return words.includes(v)?words.indexOf(v):Math.max(0,Number(m[2])-1)
}
function lastMonthWindow(now=new Date()){
  const y=now.getUTCFullYear(),m=now.getUTCMonth()
  return{start:new Date(Date.UTC(y,m-1,1)).toISOString(),end:new Date(Date.UTC(y,m,1)).toISOString()}
}

export function savedLinkDayWindow(text:string,now=new Date(),timezone='Asia/Kolkata'){
  if(!/\b(?:today|yesterday)\b/i.test(text))return null
  const parts=getLocalParts(now,timezone)
  const day=new Date(Date.UTC(parts.year,parts.month-1,parts.day-(/\byesterday\b/i.test(text)?1:0)))
  const midnight=(date:Date)=>zonedLocalTimeToUtc({year:date.getUTCFullYear(),month:date.getUTCMonth()+1,day:date.getUTCDate(),hour:0,minute:0,timezone}).toISOString()
  const start=midnight(day);day.setUTCDate(day.getUTCDate()+1)
  return{start,end:midnight(day)}
}

export async function saveLinkVaultItem(params:{telegramId:number;text:string;url?:string;visibleTitle?:string|null;previewImage?:string|null;sourceSurface?:string}){
  const original=params.url||extractLinkUrl(params.text)
  if(!original)throw new Error('link_vault_url_missing')
  const canonical=canonicalizeLinkUrl(original)
  if(!canonical)throw new Error('link_vault_url_invalid')
  const platform=detectLinkPlatform(canonical),type=itemType(platform,canonical),note=noteFromText(params.text,original)
  const metadata=await publicRepositoryMetadata(canonical)
  const preview=!clean(params.visibleTitle,160)&&!metadata&&isPreviewHost(canonical)?await linkPreview(original).catch(()=>null):null
  const title=clean(params.visibleTitle,160)||metadata?.title||preview?.title||titleFromUrl(canonical,note),source=sourceHost(canonical)
  const explicitTags=clean(params.text.replace(original,''),500).match(/\btag\s+(?:it\s+|this\s+)?([^:;]+)[:;]?\s*$/i)?.[1]?.toLowerCase().split(/[\s,]+/).filter(Boolean)||[]
  const baseTags=Array.from(new Set([...explicitTags,...keywordTags(title+' '+note,platform)])).slice(0,12),shelf=(await jevShelf({platform,type,title,note}))||fallbackShelf(platform,type)
  const topic=baseTags.find(t=>t!==platform)||platform,authRequired=restricted(platform),now=new Date().toISOString()
  const{data:existing,error:readError}=await supabaseAdmin.from('link_vault_items').select('*').eq('telegram_id',params.telegramId).eq('canonical_url',canonical).maybeSingle()
  if(readError)throw new Error('link_vault_read_failed:'+readError.message)
  const history=mergeNotes((existing as any)?.note_history,note),mergedNote=history.join(' · ').slice(0,1400)
  // 22 Oct launch run (R14): "tag it agent memory" on a re-save was dropped once the old item already had 12 tags, and
  // lists show the first four. Tags the person just named come first; older and keyword tags fill the rest.
  const mergedTags=Array.from(new Set([...explicitTags,...(Array.isArray((existing as any)?.tags)?(existing as any).tags:[]),...baseTags])).slice(0,12)
  const payload:any={
    telegram_id:params.telegramId,canonical_url:canonical,original_url:original,platform,item_type:type,title,
    description:metadata?.description||preview?.description||(existing as any)?.description||'',source,user_note:mergedNote,note_history:history,last_saved_at:now,
    topic:(existing as any)?.topic||topic,tags:mergedTags,shelf:(existing as any)?.shelf||shelf,
    preview_image:params.previewImage||(existing as any)?.preview_image||null,screenshot_url:(existing as any)?.screenshot_url||null,
    enrichment_status:(existing as any)?.enrichment_status||'metadata_only',auth_required:authRequired,
    source_evidence:{...((existing as any)?.source_evidence||{}),capture:params.sourceSurface||'chat',content_fetched:false,metadata_fetched:Boolean(metadata||preview),metadata_source:metadata?.source||(preview?'link_preview':null),resolved_url:preview?.resolvedUrl||null,preview_author:preview?.author||null,preview_text:preview?.postText||null,visible_title:Boolean(params.visibleTitle),last_captured_at:now},
    updated_at:now
  }
  let row:any
  if(existing?.id){
    const{data,error}=await supabaseAdmin.from('link_vault_items').update(payload).eq('id',existing.id).eq('telegram_id',params.telegramId).select('*').single()
    if(error||!data)throw new Error('link_vault_update_failed:'+(error?.message||'unknown'));row=data
  }else{
    const{data,error}=await supabaseAdmin.from('link_vault_items').insert({...payload,saved_at:now,created_at:now}).select('*').single()
    if(error||!data)throw new Error('link_vault_create_failed:'+(error?.message||'unknown'));row=data
  }
  await indexMemory({telegramId:params.telegramId,sourceId:'link_vault:'+row.id,sourceTable:'link_vault_items',content:indexContent(row),topic:row.topic})
  await rememberTypedObjects(params.telegramId,'links',[{id:String(row.id),title:String(row.title||row.canonical_url)}]).catch(()=>{})
  return{row:row as LinkVaultRow,created:!existing?.id,merged:Boolean(existing?.id),previewed:Boolean(preview),bare:!note,preview}
}

export async function queryLinkVault(telegramId:number,text:string,timezone='Asia/Kolkata'){
  let q=supabaseAdmin.from('link_vault_items').select('*').eq('telegram_id',telegramId).order('saved_at',{ascending:false}).limit(300)
  const platform=platformFilter(text);if(platform)q=q.eq('platform',platform)
  const tag=requestedTag(text);if(tag)q=q.contains('tags',[tag])
  if(/\blast\s+month\b/i.test(text)){const w=lastMonthWindow();q=q.gte('saved_at',w.start).lt('saved_at',w.end)}
  // 22 Oct launch run (R14): "links I saved today" missed a link first saved earlier and saved again today.
  const dayWindow=savedLinkDayWindow(text,new Date(),timezone);if(dayWindow)q=q.or(`and(saved_at.gte.${dayWindow.start},saved_at.lt.${dayWindow.end}),and(last_saved_at.gte.${dayWindow.start},last_saved_at.lt.${dayWindow.end})`)
  const{data,error}=await q;if(error)throw new Error('link_vault_query_failed:'+error.message)
  const rows=(data||[]) as LinkVaultRow[],terms=searchTerms(text),tokens=terms.split(' ').filter(Boolean)
  const scored=rows.map(row=>{
    const hay=(row.title+' '+row.description+' '+row.user_note+' '+(row.topic||'')+' '+(row.tags||[]).join(' ')+' '+row.source).toLowerCase()
    return{row,score:tokens.length?tokens.reduce((n,t)=>n+(hay.includes(t)?1:0),0):1}
  }).filter(x=>tokens.length===0||x.score>0).sort((a,b)=>b.score-a.score||Date.parse(b.row.saved_at)-Date.parse(a.row.saved_at))
  let matches=scored.map(x=>x.row)
  if(terms.length>=3&&matches.length<5){
    try{
      const vector=await embedText(terms.slice(0,500))
      const{data:semantic}=await supabaseAdmin.rpc('match_memories',{p_telegram_id:telegramId,p_query:vector,p_k:40})
      const ids=(semantic||[]).filter((r:any)=>String(r.source_id||'').startsWith('link_vault:')&&Number(r.score)>=0.36).map((r:any)=>String(r.source_id).replace(/^link_vault:/,''))
      const byId=new Map(rows.map(row=>[String(row.id),row]))
      for(const id of ids){const row=byId.get(id);if(row&&!matches.some(m=>m.id===row.id))matches.push(row)}
    }catch(err:any){console.error('LINK_VAULT_SEMANTIC_FAILED:',clean(err?.message||err,180))}
  }
  matches=matches.slice(0,20)
  await rememberTypedObjects(telegramId,'links',matches.slice(0,10).map(row=>({id:String(row.id),title:String(row.title||row.canonical_url)}))).catch(()=>{})
  return matches
}
export function formatLinkVaultResults(rows:LinkVaultRow[],text:string){
  if(!rows.length)return'🔗 I could not find a saved link matching that description or filter.'
  const ix=ordinal(text)
  if(ix!==null){
    const row=rows[ix];if(!row)return'That result number is not in the current saved-link results.'
    return'🔗 *'+(row.title||'Saved link')+'*\n'+row.canonical_url+'\n'+(row.user_note?'Note: '+row.user_note+'\n':'')+'Source: '+row.source+' · '+row.platform
  }
  const lines=rows.slice(0,10).map((row,i)=>String(i+1)+'. *'+(row.title||'Saved link')+'*\n   '+row.canonical_url+(row.user_note?'\n   Note: '+clean(row.user_note,140):'')+'\n   _'+row.platform+(row.tags?.length?' · '+row.tags.slice(0,4).join(', '):'')+'_')
  return'🔗 *Saved links* ('+rows.length+' matches)\n\n'+lines.join('\n\n')+'\n\n_You can say “open the second one”, “tag this AI”, or “delete that” after selecting an exact result._'
}
// Words quoted from someone else's post are wrapped so the outbound brand filter leaves them as written
// ("If you are a Claude freak like me" must not become "a Gogo freak"). The markers are invisible and stripped on send.
export const QUOTE_MARK='⁣'
export function quotedText(s:string){return `${QUOTE_MARK}${String(s||'').replace(/⁣/g,'')}${QUOTE_MARK}`}
type PostModel=(prompt:string)=>Promise<string>
const defaultPostModel:PostModel=async prompt=>{
  const { cheapComplete }=await import('@/lib/inference/cheap')
  const cheap=await cheapComplete({taskClass:'public_web_research',prompt,scanText:prompt,maxTokens:300}).catch(()=>null)
  if(cheap)return cheap
  const key=(globalThis as any).process?.env?.ANTHROPIC_API_KEY
  if(!key)throw new Error('no_model')
  const { default: Anthropic }=await import('@anthropic-ai/sdk')
  const res=await new Anthropic({apiKey:key}).messages.create({model:'claude-haiku-4-5',max_tokens:300,temperature:0.2,messages:[{role:'user',content:prompt}]},{timeout:12_000})
  return (res.content.find((b:any)=>b.type==='text') as any)?.text||''
}
/** Two or three plain sentences on a public post someone shared: who, what it says, their numbers marked as claims. */
export async function summarizeSharedPost(p:{title:string;text:string;author?:string},model:PostModel=defaultPostModel){
  const body=clean(p.text||p.title,1500)
  if(body.length<40)return null
  const prompt=`Someone shared this public post with you on WhatsApp. In 2 or 3 short sentences, plain text, no markdown, no emoji, under 380 characters: start with "That's a <kind of post> by <author>:" (leave out "by <author>" if unknown), say what it says or teaches, and mark any numbers, results or time claims as the author's own ("he claims", "their claim, not verified"). Use only the text below.\n\nAuthor: ${clean(p.author,60)||'unknown'}\nTitle: ${clean(p.title,200)}\nPost text: ${body}`
  const out=clean(await model(prompt),500).replace(/^["“]|["”]$/g,'')
  if(out.length<40||/^(?:i\s+(?:can(?:not|'t)|don't)|sorry)\b/i.test(out))return null
  return out
}
const LINK_DIG='link_dig'
export const LINK_DIG_YES=/^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|haan|dig\s+in(?:to\s+(?:it|this|them))?|go\s+ahead|tell\s+me\s+more|please\s+do|do\s+it)(?:\s+please)?\s*[.!]*\s*$/i
export function linkDigQuestion(p:{title:string;description?:string}){
  return `Research this and brief me: ${p.title}.${p.description?' Context: '+clean(p.description,300):''} Who they are, what they do, the facts behind the news (numbers, dates, people), and why it matters`
}
export async function handleLinkVaultFollowup(actor:AgentActor,text:string){
  if(LINK_DIG_YES.test(text)){
    const state=await getLatestFollowupState(actor.legacyTelegramId,LINK_DIG).catch(()=>null)
    if(state&&isStrictlyFreshFollowupState(state,30)&&state.payload?.title){
      await clearFollowupState(actor.legacyTelegramId,LINK_DIG).catch(()=>{})
      const dr:any=await import('@/lib/agent/deep-research').catch(()=>null)
      const out=dr?.runDeepResearch?await Promise.resolve().then(()=>dr.runDeepResearch(linkDigQuestion(state.payload))).catch((err:any)=>{console.error('LINK_DIG_FAILED:',clean(err?.message||err,160));return null}):null
      // A cited brief about someone else's post (often about AI products) is quoted, not rebranded.
      return{text:out?.text?quotedText(out.text):'I could not research that right now. Ask me again in a minute, or tell me what you want to know about it.',status:'completed',handledBy:'link-vault-dig',capability:'web',runId:''}
    }
  }
  // A remembered selection resolves a reference, not an unrelated new command.
  const target=String.raw`(?:(?:it|this|that)(?:\s+(?:one|link|reel|repo|repository))?|(?:the\s+)?selected(?:\s+(?:one|link|reel|repo|repository))?|(?:the\s+)?(?:first|second|third|fourth|fifth|\d+(?:st|nd|rd|th)?)\s+(?:one|link|reel|repo|repository))`
  const explicitReference=new RegExp(String.raw`^\s*(?:open|show(?:\s+me)?|read|select|delete|remove|forget)\s+${target}[.!?]*\s*$`,'i')
  const sendReference=new RegExp(String.raw`^\s*send\s+${target}(?:\s+to\s+.+)?[.!?]*\s*$`,'i')
  const tagReference=/^\s*tag\s+(?:this|that|it|the\s+selected(?:\s+link)?)\s+#?[a-z0-9_-]+[.!?]*\s*$/i
  if(!explicitReference.test(text)&&!sendReference.test(text)&&!tagReference.test(text))return null

  const context=await latestTypedContext(actor.legacyTelegramId)
  if(context?.domain!=='links')return null
  const selected=selectedTypedObject(context,text);if(!selected)return null
  const{data:row,error}=await supabaseAdmin.from('link_vault_items').select('*').eq('id',selected.id).eq('telegram_id',actor.legacyTelegramId).maybeSingle()
  if(error||!row)return null
  if(/^\s*(?:open|show|read|select)\b/i.test(text)){
    await rememberTypedObjects(actor.legacyTelegramId,'links',context.items,selected.id)
    return{text:'🔗 '+(row.title||'Saved link')+'\n'+row.canonical_url,status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  if(/^\s*(?:delete|remove|forget)\b/i.test(text)){
    const{error:deleteError}=await supabaseAdmin.from('link_vault_items').delete().eq('id',selected.id).eq('telegram_id',actor.legacyTelegramId)
    if(deleteError)throw new Error('link_vault_delete_failed:'+deleteError.message)
    await unindexMemory('link_vault:'+selected.id,'link_vault_items')
    return{text:'Deleted the selected saved link: '+(row.title||row.canonical_url)+'.',status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  const tag=text.match(/^\s*tag\s+(?:this|that|it|the\s+selected(?:\s+link)?)\s+#?([a-z0-9_-]+)/i)
  if(tag?.[1]){
    const value=String(tag[1]).toLowerCase(),tags=Array.from(new Set([...(Array.isArray(row.tags)?row.tags:[]),value])).slice(0,12)
    const{data:updated,error:updateError}=await supabaseAdmin.from('link_vault_items').update({tags,updated_at:new Date().toISOString()}).eq('id',row.id).eq('telegram_id',actor.legacyTelegramId).select('*').single()
    if(updateError||!updated)throw new Error('link_vault_tag_failed')
    await indexMemory({telegramId:actor.legacyTelegramId,sourceId:'link_vault:'+row.id,sourceTable:'link_vault_items',content:indexContent(updated),topic:updated.topic})
    return{text:'Tagged the selected link *'+value+'*: '+(row.title||row.canonical_url)+'.',status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  if(/^\s*send\b/i.test(text)){
    await rememberTypedObjects(actor.legacyTelegramId,'links',context.items,selected.id)
    return{text:'Selected exact link: '+(row.title||'Saved link')+' — '+row.canonical_url+'\n\nI have not sent it. External sends remain approval-gated.',status:'paused',handledBy:'link-vault',capability:'memory',runId:''}
  }
  return null
}
export async function handleLinkVaultText(params:{actor:AgentActor;text:string;sourceSurface?:string}){
  if(isLinkVaultSaveRequest(params.text)){
    const saved=await saveLinkVaultItem({telegramId:params.actor.legacyTelegramId,text:params.text,sourceSurface:params.sourceSurface})
    const r=saved.row,restrictedNote=r.auth_required?' I saved only the URL and visible/user-supplied metadata; I did not pretend to read restricted content.':''
    // A bare shared link that could be read: say what it is and offer to dig in, the way a person would.
    if(saved.previewed&&saved.bare){
      const about=r.description&&!r.description.toLowerCase().startsWith(r.title.toLowerCase().slice(0,40))?'\n'+shortText(r.description,260):''
      await clearFollowupState(params.actor.legacyTelegramId,LINK_DIG).catch(()=>{})
      await saveFollowupState(params.actor.legacyTelegramId,LINK_DIG,{title:r.title,url:r.canonical_url,description:clean(r.description,400)}).catch(()=>{})
      // 30 Oct, side by side with another assistant: say who posted it and what it says, mark their numbers as their
      // claims, then why it matters to this person. The post's own words are quoted, never rebranded.
      const summary=await summarizeSharedPost({title:r.title,text:(saved as any).preview?.postText||r.description,author:(saved as any).preview?.author||''}).catch(()=>null)
      const base=summary?`🔗 ${quotedText(summary)}`:'🔗 *'+quotedText(r.title)+'*'+(about?quotedText(about):'')
      const withContext=summary?await contextualizeSavedItemReply({userId:String(params.actor.userId),telegramId:params.actor.legacyTelegramId,whatsappId:params.actor.whatsappId,name:params.actor.name,baseReply:base,
        item:{kind:'link',platform:r.platform,title:r.title,summary:clean(summary,600),tags:r.tags||[]}}).catch(()=>base):base
      return{text:withContext+'\n\nSaved to your links. Want me to dig into this? Reply *yes*.',status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
    }
    const baseReply='🔗 '+(saved.merged?'Updated existing saved link':'Saved to Link Vault')+': *'+r.title+'*\n'+r.canonical_url+(r.user_note?'\nNote: '+r.user_note:'')+restrictedNote
    const reply=await contextualizeSavedItemReply({
      userId:String(params.actor.userId),
      telegramId:params.actor.legacyTelegramId,
      whatsappId:params.actor.whatsappId,
      name:params.actor.name,
      baseReply,
      item:{kind:'link',platform:r.platform,title:r.title,summary:[r.description,r.user_note,'Tags: '+(r.tags||[]).join(', ')].filter(Boolean).join(' · '),tags:r.tags||[]},
    })
    return{text:reply,status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  if(isLinkVaultQuery(params.text)){
    const rows=await queryLinkVault(params.actor.legacyTelegramId,params.text,params.actor.timezone||'Asia/Kolkata')
    return{text:formatLinkVaultResults(rows,params.text),status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  return handleLinkVaultFollowup(params.actor,params.text)
}


export async function exportLinkVaultJson(telegramId:number){
  const{data,error}=await supabaseAdmin.from('link_vault_items').select('canonical_url,original_url,platform,item_type,title,description,user_note,saved_at,topic,tags,shelf,preview_image,enrichment_status,auth_required').eq('telegram_id',telegramId).order('saved_at',{ascending:true})
  if(error)throw new Error('link_vault_export_failed:'+error.message)
  return{
    version:'askgogo-link-vault-v1',
    format:'brain-vault-compatible',
    exported_at:new Date().toISOString(),
    visibility:'private',
    items:(data||[]).map((row:any)=>({
      url:row.canonical_url,original_url:row.original_url,platform:row.platform,type:row.item_type,title:row.title,
      description:row.description,note:row.user_note,saved_at:row.saved_at,topic:row.topic,tags:row.tags||[],shelf:row.shelf,
      preview_image:row.preview_image,enrichment_status:row.enrichment_status,auth_required:Boolean(row.auth_required)
    }))
  }
}

export async function importLinkVaultJson(telegramId:number,input:any){
  const items=Array.isArray(input)?input:Array.isArray(input?.items)?input.items:[]
  if(!items.length)return{imported:0,skipped:0}
  let imported=0,skipped=0
  for(const raw of items.slice(0,100)){
    const url=String(raw?.url||raw?.canonical_url||raw?.original_url||'').trim()
    if(!canonicalizeLinkUrl(url)){skipped++;continue}
    const note=safeNote(String(raw?.note||raw?.user_note||''))
    try{
      const saved=await saveLinkVaultItem({telegramId,text:'save '+url+(note?' '+note:''),url,visibleTitle:clean(raw?.title,160)||null,previewImage:clean(raw?.preview_image,1000)||null,sourceSurface:'vault-json-import'})
      const tags=Array.from(new Set([...(saved.row.tags||[]),...(Array.isArray(raw?.tags)?raw.tags.map((x:any)=>clean(x,50).toLowerCase()).filter(Boolean):[])])).slice(0,12)
      const patch:any={tags,updated_at:new Date().toISOString()}
      if(raw?.topic)patch.topic=clean(raw.topic,120)
      if(raw?.shelf&&['reference','inspiration','tool','product','social'].includes(String(raw.shelf)))patch.shelf=String(raw.shelf)
      await supabaseAdmin.from('link_vault_items').update(patch).eq('id',saved.row.id).eq('telegram_id',telegramId)
      imported++
    }catch{skipped++}
  }
  return{imported,skipped}
}
