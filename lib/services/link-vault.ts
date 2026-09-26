import { supabaseAdmin } from '@/lib/supabase-admin'
import { indexMemory, unindexMemory } from '@/lib/services/memory-index'
import { embedText } from '@/lib/services/embeddings'
import { isSecretShapedMemory, redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { latestTypedContext, rememberTypedObjects, selectedTypedObject } from '@/lib/agent/typed-object-context'
import type { AgentActor } from '@/lib/agent/actor'

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
    .replace(/\s+/g,' ').trim())
}
function titleFromUrl(url:string,note:string){
  try{
    const u=new URL(url)
    const slug=decodeURIComponent(u.pathname.split('/').filter(Boolean).pop()||'').replace(/[-_]+/g,' ').trim()
    return clean(note?note.split(/[.!?]/)[0]:slug||u.hostname,120)||u.hostname
  }catch{return clean(note||'Saved link',120)}
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
  const stripped=String(text||'').replace(url,' ').trim()
  if(/\b(save|remember|keep|store|bookmark|file)\b/i.test(stripped))return true
  if(/\b(book|reserve|buy|purchase|checkout|apply|submit|monitor|watch|compare|translate|summari[sz]e|check availability)\b/i.test(stripped))return false
  return stripped.length<180
}
export function isLinkVaultQuery(text:string){
  const t=String(text||'').trim().toLowerCase()
  return /\b(?:saved|my)\s+(?:links?|reels?|repos?|repositories|bookmarks?)\b/.test(t)
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
    .replace(/\b(?:find|show|open|what|was|that|the|all|links?|saved|save|about|my|i|last|month|instagram|youtube|twitter|linkedin|github|repo|repository|reel|post|tagged)\b/g,' ')
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

export async function saveLinkVaultItem(params:{telegramId:number;text:string;url?:string;visibleTitle?:string|null;previewImage?:string|null;sourceSurface?:string}){
  const original=params.url||extractLinkUrl(params.text)
  if(!original)throw new Error('link_vault_url_missing')
  const canonical=canonicalizeLinkUrl(original)
  if(!canonical)throw new Error('link_vault_url_invalid')
  const platform=detectLinkPlatform(canonical),type=itemType(platform,canonical),note=noteFromText(params.text,original)
  const title=clean(params.visibleTitle,160)||titleFromUrl(canonical,note),source=sourceHost(canonical)
  const baseTags=keywordTags(title+' '+note,platform),shelf=(await jevShelf({platform,type,title,note}))||fallbackShelf(platform,type)
  const topic=baseTags.find(t=>t!==platform)||platform,authRequired=restricted(platform),now=new Date().toISOString()
  const{data:existing,error:readError}=await supabaseAdmin.from('link_vault_items').select('*').eq('telegram_id',params.telegramId).eq('canonical_url',canonical).maybeSingle()
  if(readError)throw new Error('link_vault_read_failed:'+readError.message)
  const history=mergeNotes((existing as any)?.note_history,note),mergedNote=history.join(' · ').slice(0,1400)
  const mergedTags=Array.from(new Set([...(Array.isArray((existing as any)?.tags)?(existing as any).tags:[]),...baseTags])).slice(0,12)
  const payload:any={
    telegram_id:params.telegramId,canonical_url:canonical,original_url:original,platform,item_type:type,title,
    description:(existing as any)?.description||'',source,user_note:mergedNote,note_history:history,last_saved_at:now,
    topic:(existing as any)?.topic||topic,tags:mergedTags,shelf:(existing as any)?.shelf||shelf,
    preview_image:params.previewImage||(existing as any)?.preview_image||null,screenshot_url:(existing as any)?.screenshot_url||null,
    enrichment_status:(existing as any)?.enrichment_status||'metadata_only',auth_required:authRequired,
    source_evidence:{...((existing as any)?.source_evidence||{}),capture:params.sourceSurface||'chat',content_fetched:false,visible_title:Boolean(params.visibleTitle),last_captured_at:now},
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
  return{row:row as LinkVaultRow,created:!existing?.id,merged:Boolean(existing?.id)}
}

export async function queryLinkVault(telegramId:number,text:string){
  let q=supabaseAdmin.from('link_vault_items').select('*').eq('telegram_id',telegramId).order('saved_at',{ascending:false}).limit(300)
  const platform=platformFilter(text);if(platform)q=q.eq('platform',platform)
  const tag=requestedTag(text);if(tag)q=q.contains('tags',[tag])
  if(/\blast\s+month\b/i.test(text)){const w=lastMonthWindow();q=q.gte('saved_at',w.start).lt('saved_at',w.end)}
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
export async function handleLinkVaultFollowup(actor:AgentActor,text:string){
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
    return{text:'🔗 '+(saved.merged?'Updated existing saved link':'Saved to Link Vault')+': *'+r.title+'*\n'+r.canonical_url+(r.user_note?'\nNote: '+r.user_note:'')+restrictedNote,status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  if(isLinkVaultQuery(params.text)){
    const rows=await queryLinkVault(params.actor.legacyTelegramId,params.text)
    return{text:formatLinkVaultResults(rows,params.text),status:'completed',handledBy:'link-vault',capability:'memory',runId:''}
  }
  return handleLinkVaultFollowup(params.actor,params.text)
}
