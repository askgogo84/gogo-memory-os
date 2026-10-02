import {supabaseAdmin} from '@/lib/supabase-admin'
import {searchWebResults, type WebSearchResult} from '@/lib/web-search'
import {foodLocationReply,foodSearchSubject,isFoodComparisonRequest} from './food-comparison-intent'

import {commerceTaskLink, readCommerceTask} from '@/lib/commerce/task'

const TYPE='food_comparison'
const QUESTION='For this food comparison, what is your delivery PIN code in India?'
const PROVIDERS=[{name:'Swiggy',domain:'swiggy.com'},{name:'Zomato',domain:'zomato.com'},{name:'Magicpin',domain:'magicpin.in'}]
const TTL=4*60*60_000
type Result={runId:string;status:'paused';capability:'browser';risk:'low';text:string;handledBy:'food-comparison'|'grocery-comparison'}

export function foodProviderLink(result:WebSearchResult,domain:string){
  try{
    const url=new URL(result.url)
    return url.protocol==='https:'&&!url.username&&!url.password
      && (url.hostname===domain||url.hostname.endsWith('.'+domain))
      && url.pathname!=='/' ? url.href:null
  }catch{return null}
}

// Search snippets identify candidate pages; they are NOT a live menu/cart receipt.
// No LLM can turn these into invented prices, distances, discounts or cart writes.
export function renderFoodDiscovery(subject:string,pin:string,groups:Array<{name:string;links:Array<{title:string;url:string}>}>,checkedAt:string){
  const lines=groups.map(g=>`${g.name}:\n${g.links.length?g.links.map(x=>`• ${x.title}\n${x.url}`).join('\n'):'No matching provider page found for this PIN.'}`)
  return `I searched for ${subject} around PIN ${pin}, India.\n\n${lines.join('\n\n')}\n\nThese are provider-page leads, not verified delivery quotes. I could not yet verify current item prices, fees, distance or the cheapest delivered total for your saved address. Checked: ${checkedAt}.\n\nYou can open a provider link to inspect it. Nothing has been added to a cart or ordered. AskGogo’s saved-address/cart connection is not active yet; the comparison remains incomplete.`
}

export async function tryFoodComparison(params:{telegramId:number;text:string;surface?:string}):Promise<Result|null>{
  if (/^\s*(?:compare grocery prices for\s|(?:show|check)\s+(?:my|the)\s+grocery comparison(?: status)?[.!]?\s*$)/i.test(params.text)) {
    const {tryGroceryComparison} = await import('./grocery-comparison')
    return tryGroceryComparison(params)
  }
  const statusRequest=/^\s*(?:show|check)\s+(?:my|the)\s+food comparison(?: status)?[.!]?\s*$/i.test(params.text)
  const fresh=isFoodComparisonRequest(params.text)
  const location=foodLocationReply(params.text)
  // Do not query pending work or hijack unrelated requests.
  if(!statusRequest&&!fresh&&!location&&!/^\s*(?:cancel|stop)\s+(?:the\s+)?food comparison[.!]?\s*$/i.test(params.text))return null
  const owner=String(params.telegramId)
  const {data:previous,error:readError}=await supabaseAdmin.from('agent_runs')
    .select('id,status,updated_at,summary,metadata_json').eq('telegram_id',owner).eq('type',TYPE)
    .order('started_at',{ascending:false}).limit(1).maybeSingle()
  if(readError)throw new Error('food_comparison_read_failed')
  if(statusRequest){
    const task=previous?.status==='paused'&&previous.metadata_json?.state!=='closed'?previous:null
    if(!task)return {runId:previous?.id||'',status:'paused',capability:'browser',risk:'low',handledBy:'food-comparison',text:'There is no active food comparison.'}
    const current=task.metadata_json?.state==='browser_research'?await readCommerceTask(owner,task.id):task
    if(!current)throw new Error('food_comparison_read_failed')
    return {runId:task.id,status:'paused',capability:'browser',risk:'low',handledBy:'food-comparison',text:current.summary+'\n\nContinue this comparison: '+commerceTaskLink(task.id)}
  }
  const age=Date.now()-Date.parse(previous?.updated_at||'')
  const active=previous?.status==='paused'&&previous?.metadata_json?.state!=='closed'&&Number.isFinite(age)&&age>=0&&age<TTL
  if(!fresh){
    if(!active)return null
    if(/^\s*(?:cancel|stop)\b/i.test(params.text)){
      const {error}=await supabaseAdmin.from('agent_runs').update({status:'paused',metadata_json:{...previous.metadata_json,state:'closed',closure_reason:'user_cancelled'},summary:'Food comparison cancelled by you.',updated_at:new Date().toISOString()}).eq('id',previous.id).eq('telegram_id',owner)
      if(error)throw new Error('food_comparison_cancel_failed')
      return {runId:previous.id,status:'paused',capability:'browser',risk:'low',handledBy:'food-comparison',text:'Food comparison cancelled. No cart or order was changed.'}
    }
    if(previous.metadata_json?.state!=='waiting_location')return null
    // A bare six-digit reply only belongs here when our location question is
    // still the last assistant turn. An old paused task cannot steal PINs/OTPs.
    const {data:turns,error}=await supabaseAdmin.from('conversations').select('content')
      .eq('telegram_id',params.telegramId).eq('role','assistant').order('created_at',{ascending:false}).limit(1)
    if(error)throw new Error('food_comparison_context_failed')
    if(!String(turns?.[0]?.content||'').includes(QUESTION))return null
  }
  const now=new Date().toISOString()
  let runId=previous?.id as string|undefined
  let meta:any=fresh?{plan_type:TYPE,request_text:params.text.slice(0,1600),subject:foodSearchSubject(params.text)}:{...previous.metadata_json}
  if(fresh){
    // Reuse only a recent, user-supplied postal area from this feature, never
    // a guessed city or a location in external search/document content.
    if(active&&previous.metadata_json?.location?.source==='user')meta.location=previous.metadata_json.location
    const {data,error}=await supabaseAdmin.from('agent_runs').insert({telegram_id:owner,type:TYPE,capability:'browser',status:'paused',title:`Compare ${meta.subject} delivery`,summary:'Waiting for delivery location.',progress:0,source:params.surface||'whatsapp',started_at:now,updated_at:now,metadata_json:meta}).select('id').single()
    if(error||!data?.id)throw new Error('food_comparison_create_failed')
    runId=data.id
    if(active){
      const {error:closeError}=await supabaseAdmin.from('agent_runs').update({status:'paused',metadata_json:{...previous.metadata_json,state:'closed',closure_reason:'replaced'},summary:'Replaced by a new food comparison request.',updated_at:now}).eq('id',previous.id).eq('telegram_id',owner)
      if(closeError)throw new Error('food_comparison_replace_failed')
    }
  }
  if(location)meta.location={...location,source:'user'}
  const reply=(text:string):Result=>({runId:runId!,status:'paused',capability:'browser',risk:'low',text,handledBy:'food-comparison'})
  const save=async(summary:string)=>{
    const {data,error}=await supabaseAdmin.from('agent_runs').update({status:'paused',summary,metadata_json:meta,updated_at:new Date().toISOString()}).eq('id',runId).eq('telegram_id',owner).select('id').maybeSingle()
    if(error||!data?.id)throw new Error('food_comparison_save_failed')
  }
  if(!meta.location){
    meta.state='waiting_location'
    await save('Needs your delivery PIN; comparison has not started.')
    return reply(`${QUESTION} I’ll keep your ${meta.subject} request and use that area to find provider pages. A street address is not needed for this first lookup.`)
  }
  const pin=meta.location.pin
  const groups=await Promise.all(PROVIDERS.map(async provider=>{
    const results=await searchWebResults(`${meta.subject} delivery menu PIN ${pin} India site:${provider.domain}`,{includeDomains:[provider.domain]})
    const links=results.filter(r=>new RegExp(`\\b${pin}\\b`).test(`${r.title} ${r.snippet} ${r.url}`))
      .map(r=>({title:r.title.replace(/[\r\n]/g,' ').slice(0,180),url:foodProviderLink(r,provider.domain)}))
      .filter((r):r is {title:string;url:string}=>Boolean(r.url)).slice(0,2)
    return {name:provider.name,links}
  }))
  meta.state='provider_connection_required'
  meta.discovery={checked_at:now,groups,evidence_kind:'search_results_only',cart_verified:false}
  await save('Provider pages searched; live prices, delivery totals and cart connection remain unverified.')
  return reply(renderFoodDiscovery(meta.subject,pin,groups,now)+'\n\nContinue this comparison: '+commerceTaskLink(runId!))
}
