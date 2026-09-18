import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSecureBrowser } from './secure-computer'
import { continueBrowserHandoffResearch, readBrowserHandoffState } from './browser-handoff'
import { startProviderBrowserHandoff } from './provider-browser-handoff'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })

const STATIONS: Record<string,{label:string;code:string;aliases:string[]}> = {
  bengaluru:{label:'Bengaluru',code:'SBC',aliases:['bengaluru','bangalore','sbc','ksr bengaluru']},
  bangalore:{label:'Bengaluru',code:'SBC',aliases:['bengaluru','bangalore','sbc','ksr bengaluru']},
  sbc:{label:'Bengaluru',code:'SBC',aliases:['bengaluru','bangalore','sbc','ksr bengaluru']},
  mysuru:{label:'Mysuru',code:'MYS',aliases:['mysuru','mysore','mys']},
  mysore:{label:'Mysuru',code:'MYS',aliases:['mysuru','mysore','mys']},
  mys:{label:'Mysuru',code:'MYS',aliases:['mysuru','mysore','mys']},
  chennai:{label:'Chennai',code:'MAS',aliases:['chennai','madras','mas']},
  mas:{label:'Chennai',code:'MAS',aliases:['chennai','madras','mas']},
  hyderabad:{label:'Hyderabad',code:'SC',aliases:['hyderabad','secunderabad','sc']},
  secunderabad:{label:'Hyderabad',code:'SC',aliases:['hyderabad','secunderabad','sc']},
  delhi:{label:'Delhi',code:'NDLS',aliases:['delhi','new delhi','ndls']},
  'new delhi':{label:'Delhi',code:'NDLS',aliases:['delhi','new delhi','ndls']},
  mumbai:{label:'Mumbai',code:'CSMT',aliases:['mumbai','bombay','csmt']},
  pune:{label:'Pune',code:'PUNE',aliases:['pune']},
}

const MONTHS: Record<string,number>={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11}

function safe(v:unknown,max=1600){return String(v??'').replace(/\s+/g,' ').trim().slice(0,max)}
function isoDay(d:Date){return d.toISOString().slice(0,10)}
function station(raw:string|undefined){const k=String(raw||'').trim().replace(/[,.!?]+$/g,'').toLowerCase();if(!k)return null;if(STATIONS[k])return STATIONS[k];if(/^[A-Z]{2,5}$/i.test(k))return{label:k.toUpperCase(),code:k.toUpperCase(),aliases:[k]};return{label:k.replace(/\b\w/g,c=>c.toUpperCase()),code:'',aliases:[k]}}
function seg(text:string,marker:'from'|'to'){const stop=marker==='from'?'(?=\\s+(?:to|on|tomorrow|today|next|this|for|after|before|morning|evening|night)\\b|$)':'(?=\\s+(?:from|on|tomorrow|today|next|this|for|after|before|morning|evening|night)\\b|$)';return text.match(new RegExp(`\\b${marker}\\s+([a-zA-Z][a-zA-Z .'-]{1,42}?)${stop}`,'i'))?.[1]?.trim()}

function parseDate(text:string,now=new Date()){
  const t=text.toLowerCase()
  if(/\btomorrow\b/.test(t)){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));return isoDay(d)}
  if(/\btoday\b/.test(t))return isoDay(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())))
  let m=text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?/i)
  if(m){const mo=MONTHS[m[2].toLowerCase()];const y=Number(m[3]||now.getUTCFullYear());const d=new Date(Date.UTC(y,mo,Number(m[1])));if(d.getUTCMonth()===mo)return isoDay(d)}
  m=text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);if(m)return isoDay(new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))))
  m=text.match(/\b(?:on\s+)?(\d{1,2})(?:st|nd|rd|th)\b/i)
  if(m){
    const day=Number(m[1]);if(day<1||day>31)return null
    let y=now.getUTCFullYear(),mo=now.getUTCMonth()
    if(day<now.getUTCDate()){mo+=1;if(mo>11){mo=0;y+=1}}
    const d=new Date(Date.UTC(y,mo,day));if(d.getUTCFullYear()===y&&d.getUTCMonth()===mo&&d.getUTCDate()===day)return isoDay(d)
  }
  return null
}

export function isTrainResearchRequest(text:string){const t=String(text||'').toLowerCase();return /\b(irctc|train|trains|railway|railways)\b/.test(t)&&/\b(find|search|show|available|availability|check|options|seat|seats|ticket|tickets|book|booking)\b/.test(t)}
export function isTrainResumeRequest(text:string){return /^(continue|resume|done|finished|i'?m done|return control|continue gogo)$/i.test(String(text||'').trim())}
function trainPreference(text:string):boolean|null{const t=String(text||'').trim().toLowerCase();if(/\b(direct|direct only|non[- ]?stop|no change|without change)\b/.test(t))return true;if(/\b(connections? (?:are )?okay|connections? ok|change(?:s)? (?:are )?okay|any train|doesn'?t matter|either is fine|both are fine)\b/.test(t))return false;return null}

function context(text:string){const from=station(seg(text,'from'));const to=station(seg(text,'to'));const date=parseDate(text);return{from,to,date,routeLabel:from&&to?`${from.code||from.label} → ${to.code||to.label}`:'Train search'}}
function parseJsonArray(text:string){const c=String(text||'').replace(/```json|```/g,'').trim();try{const v=JSON.parse(c);return Array.isArray(v)?v:[]}catch{}const m=c.match(/\[[\s\S]*\]/);if(!m)return[];try{const v=JSON.parse(m[0]);return Array.isArray(v)?v:[]}catch{return[]}}
function fareNumber(v:unknown){const m=String(v||'').replace(/,/g,'').match(/(?:₹|INR|Rs\.?\s*)?\s*(\d{2,6})/i);return m?Number(m[1]):Number.POSITIVE_INFINITY}
function durationMinutes(v:unknown){const s=String(v||'');const h=Number(s.match(/(\d+)\s*h/i)?.[1]||0),m=Number(s.match(/(\d+)\s*m/i)?.[1]||0);return h*60+m||99999}
function availabilityScore(v:unknown){const s=String(v||'').toLowerCase();if(/available|avail|current/.test(s)&&!/not available|unavailable/.test(s))return 0;if(/rac/.test(s))return 1;if(/wl|wait/.test(s))return 2;return 3}
function rankTrains(values:any[]){return [...values].sort((a,b)=>availabilityScore(a.availability)-availabilityScore(b.availability)||fareNumber(a.fare)-fareNumber(b.fare)||durationMinutes(a.duration)-durationMinutes(b.duration))}

async function extract(pageText:string,routeLabel:string,date:string){
  const prompt=`Extract only actual train options visibly present in this IRCTC/browser page text for ${routeLabel} on ${date}. Return JSON array only. Each item: {"trainNumber":"","trainName":"","departure":"","arrival":"","duration":"","classes":[""],"availability":"","fare":"","evidence":""}. Do not invent availability or fares. If no real train rows are visible, return []. Page text: ${JSON.stringify(pageText.slice(0,14000))}`
  const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:2200,temperature:0,messages:[{role:'user',content:prompt}]})
  const raw=res.content[0]?.type==='text'?res.content[0].text:''
  const trains=parseJsonArray(raw).slice(0,10).map((x:any)=>({trainNumber:safe(x.trainNumber,20),trainName:safe(x.trainName,100),departure:safe(x.departure,40),arrival:safe(x.arrival,40),duration:safe(x.duration,40),classes:Array.isArray(x.classes)?x.classes.map((v:any)=>safe(v,20)).filter(Boolean).slice(0,8):[],availability:safe(x.availability,120),fare:safe(x.fare,80),evidence:safe(x.evidence,320)})).filter((x:any)=>x.trainNumber&&x.trainName&&x.departure&&x.arrival)
  return rankTrains(trains)
}

function formatTrainResult(c:any,trains:any[]){return `Train task completed · ${c.routeLabel} · ${c.date}\n\n${trains.slice(0,8).map((tr:any,i:number)=>`${i+1}. ${tr.trainNumber} ${tr.trainName} · ${tr.departure} → ${tr.arrival}${tr.duration?` · ${tr.duration}`:''}${tr.fare?` · ${tr.fare}`:''}${tr.classes.length?` · ${tr.classes.join(', ')}`:''}${tr.availability?`\nAvailability: ${tr.availability}`:''}`).join('\n\n')}\n\nSource: browser-verified rail provider page. No booking was made.`}

async function activity(tg:number,runId:string,event:string,message:string,metadata:Record<string,unknown>={}){await supabaseAdmin.from('agent_activity').insert({telegram_id:String(tg),run_id:runId,event_type:event,message:safe(message,900),metadata_json:metadata}).then(({error})=>{if(error)console.error('TRAIN_ACTIVITY_FAILED:',error.message)})}

export async function tryResumeTrainHandoff(params:{actor:AgentActor;text:string}){
  if(!isTrainResumeRequest(params.text))return null
  const tg=params.actor.legacyTelegramId
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('id,metadata_json,status').eq('telegram_id',String(tg)).eq('type','train_research').eq('status','paused').order('updated_at',{ascending:false}).limit(1).maybeSingle()
  if(error)throw new Error(`train_resume_lookup_failed:${error.message}`)
  const meta:any=run?.metadata_json||{};const handoff=meta?.handoff;const c=meta?.context
  if(!run?.id||!handoff?.stateUrl||!handoff?.agentActionUrl||!c?.date)return null
  const runId=String(run.id)
  const objective=String(meta.input_text||`Find trains for ${c.routeLabel} on ${c.date}`)
  await activity(tg,runId,'handoff_returned','User returned control of the persistent browser to Gogo.',{})
  // Fail CLOSED, same rule as executeTrainRun. readBrowserHandoffState is an HTTP
  // call to the takeover server inside the sandbox; if the user never opened the
  // link, or the sandbox timed out, it throws. That throw used to be swallowed by
  // withWhatsAppBrowserBudget, leaving the result falsy, and CONTINUE fell through
  // to the general planner - which answered from the model with unverified trains.
  let state
  try{
    state=await readBrowserHandoffState(String(handoff.stateUrl))
  }catch(err:any){
    await activity(tg,runId,'handoff_state_unreachable',safe(err?.message||'handoff_state_unreachable',300),{})
    return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`I could not read that browser session - it looks like it was never opened, or it has since expired.\n\nOpen the secure browser, complete the human-only step, tap *Return control to Gogo*, then reply *CONTINUE*.\n${handoff.takeoverUrl}\n\nI have no verified train rows and did not invent any.`,handledBy:'train-handoff-resume' as const}
  }
  let trains=await extract(state.text,c.routeLabel,c.date)
  if(!trains.length){const continued=await continueBrowserHandoffResearch({stateUrl:String(handoff.stateUrl),agentActionUrl:String(handoff.agentActionUrl),objective,waves:3});state=continued.state;trains=await extract(state.text,c.routeLabel,c.date)}
  const at=new Date().toISOString()
  if(!trains.length){await supabaseAdmin.from('agent_runs').update({summary:'Gogo resumed the same rail browser, but verified train rows are not visible yet.',progress:70,updated_at:at,metadata_json:{...meta,state:'waiting_for_user',handoff:{...handoff,lastUrl:state.url}}}).eq('id',runId);return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`I resumed the same rail browser session, but the train results are not visible yet.\n\nOpen the live browser again, finish the human-only step/search, tap *Return control to Gogo*, then reply *CONTINUE*.\n${handoff.takeoverUrl}`,handledBy:'train-handoff-resume' as const}}
  const text=formatTrainResult(c,trains)
  await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:{context:c,trains,inventoryType:'browser-verified',handoff,resumed:true,browserState:{url:state.url,title:state.title}},error:null,completed_at:at}).eq('run_id',runId).eq('telegram_id',String(tg))
  await supabaseAdmin.from('agent_runs').update({status:'completed',summary:safe(text,1800),progress:100,error:null,completed_at:at,updated_at:at,metadata_json:{...meta,state:'completed',handoff:{...handoff,lastUrl:state.url}}}).eq('id',runId)
  await activity(tg,runId,'run_completed',`Task completed after human handoff with ${trains.length} browser-verified train options.`,{result_count:trains.length,handoff:true})
  return{runId,status:'completed' as const,capability:'travel' as const,risk:'low' as const,text,handledBy:'train-handoff-resume' as const}
}

async function latestPreferenceRun(tg:number){
  const {data,error}=await supabaseAdmin.from('agent_runs').select('id,metadata_json,status,source').eq('telegram_id',String(tg)).eq('type','train_research').eq('status','paused').order('updated_at',{ascending:false}).limit(6)
  if(error)throw new Error(`train_preference_lookup_failed:${error.message}`)
  return (data||[]).find((r:any)=>r?.metadata_json?.state==='awaiting_train_preference')||null
}

export async function executeTrainRun(params:{actor:AgentActor;surface:AgentSurface;runId:string;c:any;inputText:string;directOnly:boolean;fromWorker?:boolean}){
  const tg=params.actor.legacyTelegramId,runId=params.runId,now=new Date().toISOString()
  // The WhatsApp webhook has a 42s budget and Vercel kills the function after it replies,
  // so a browser session started here dies mid-flight. For WhatsApp we only ENQUEUE:
  // the run row is marked 'queued' and /api/cron/autonomous-runs executes it in the
  // background with a 300s budget, then pushes the result back over WhatsApp.
  if(params.surface==='whatsapp'&&!params.fromWorker){
    const queuedMeta:any={plan_type:'train_research',input_text:safe(params.inputText,1800),context:params.c,task_based:true,state:'queued',directOnly:params.directOnly,queued_at:now}
    await supabaseAdmin.from('agent_runs').update({status:'queued',summary:'Queued: Gogo will open the rail provider in the background.',progress:5,metadata_json:queuedMeta,updated_at:now}).eq('id',runId)
    await activity(tg,runId,'run_queued',`Train search for ${params.c.routeLabel} queued for background execution.`,{date:params.c.date,directOnly:params.directOnly})
    return{runId,status:'queued' as const,capability:'travel' as const,risk:'low' as const,text:`On it. Checking the rail provider for ${params.c.routeLabel} on ${params.c.date} in the background. I'll message you here as soon as I have verified rows, usually within a couple of minutes.`,handledBy:'train-research' as const}
  }
  const baseMeta:any={plan_type:'train_research',input_text:safe(params.inputText,1800),context:params.c,task_based:true,state:'executing',directOnly:params.directOnly}
  await supabaseAdmin.from('agent_runs').update({status:'running',summary:'Gogo is working through the rail provider in the secure browser.',progress:20,metadata_json:baseMeta,updated_at:now}).eq('id',runId)
  const {count:priorSteps}=await supabaseAdmin.from('agent_steps').select('id',{count:'exact',head:true}).eq('run_id',runId)
  const {data:step,error:stepError}=await supabaseAdmin.from('agent_steps').insert({telegram_id:String(tg),run_id:runId,ordinal:(priorSteps||0)+1,tool_name:'secure_browser',title:'Work through live train search',status:'running',input_json:{context:params.c,directOnly:params.directOnly},output_json:{},started_at:now}).select('id').single();if(stepError||!step?.id)throw new Error(`train_step_create_failed:${stepError?.message||'unknown'}`)
  await activity(tg,runId,'browser_research_started',`Gogo opened the rail provider for ${params.c.routeLabel}.`,{date:params.c.date,directOnly:params.directOnly})
  try{
    const browser=await runSecureBrowser({userId:params.actor.userId,url:'https://www.irctc.co.in/nget/train-search',objective:`Find ${params.directOnly?'direct ':''}trains from ${params.c.from.label} (${params.c.from.code}) to ${params.c.to.label} (${params.c.to.code}) on ${params.c.date}. Use safe search controls and obtain actual train rows, visible fare, classes and seat availability. Rank the useful options by availability, fare and duration. Do not sign in, book, submit passenger details or pay.`,mode:'read'})
    if(browser.status==='blocked'){
      const providerUrl=browser.url||'https://www.irctc.co.in/nget/train-search'
      // TWO KINDS OF WALL, TWO KINDS OF HANDOFF.
      //
      // provider_access_limited = the provider blocks our IP (IRCTC serves an Akamai
      // "Access Denied" page to datacenter addresses). The cloud takeover browser runs
      // in that same sandbox, so a human driving it is still the blocked IP - verified
      // live: the takeover page loaded and showed Access Denied. Only the user's OWN
      // browser on their OWN connection can reach it, so we send a DEVICE handoff and
      // never start a sandbox takeover server.
      //
      // human_auth_required = CAPTCHA / login / OTP. The IP is fine; the obstacle is
      // proving a person is present. That is what the cloud takeover is for.
      if(browser.blockReason==='provider_access_limited'){
        const at=new Date().toISOString();const metadata={...baseMeta,state:'waiting_for_user',handoff:{mode:'device',providerUrl,blockedAt:at}}
        await supabaseAdmin.from('agent_steps').update({status:'queued',output_json:{browser,context:params.c,deviceHandoff:true},error:null,completed_at:null}).eq('id',String(step.id))
        await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'The rail provider blocks automated access; the user must open it on their own device.',progress:50,error:null,updated_at:at,metadata_json:metadata}).eq('id',runId)
        await activity(tg,runId,'device_handoff_required','The provider blocks server traffic by IP; sent the user a direct link for their own browser.',{reason:browser.blockReason,url:providerUrl})
        return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`${params.c.routeLabel} · ${params.c.date}\n\nIRCTC blocks automated access from servers, so I cannot read the times myself - this is their policy, not a fault at my end.\n\nOpen it on your phone, where it works normally:\n${providerUrl}\n\nSearch ${params.c.from.label} to ${params.c.to.label} for ${params.c.date}, then tell me which train you want and I will take it from there.\n\nNo booking or payment action has been made.`,blockedReason:browser.blockReason,handledBy:'train-research' as const}
      }
      const handoff=await startProviderBrowserHandoff({userId:params.actor.userId,url:providerUrl})
      const at=new Date().toISOString();const metadata={...baseMeta,state:'waiting_for_user',handoff}
      await supabaseAdmin.from('agent_steps').update({status:'queued',output_json:{browser,context:params.c,handoff},error:null,completed_at:null}).eq('id',String(step.id))
      await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'The rail provider needs human control before Gogo can continue.',progress:50,error:null,updated_at:at,metadata_json:metadata}).eq('id',runId)
      await activity(tg,runId,'browser_handoff_ready','The rail provider requires human control; the same persistent browser is ready for takeover.',{reason:browser.blockReason||null})
      return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`Train task needs you · ${params.c.routeLabel} · ${params.c.date}\n\nThe rail provider is limiting automated access. I kept a persistent browser ready for you.\n\nOpen this secure browser:\n${handoff.takeoverUrl}\n\nComplete only the human-required step (login/CAPTCHA/search if needed), tap *Return control to Gogo*, then come back to WhatsApp and reply *CONTINUE*.\n\nNo booking or payment action has been made.`,blockedReason:browser.blockReason,handledBy:'train-research' as const}
    }
    const trains=await extract(browser.pageText,params.c.routeLabel,params.c.date);const at=new Date().toISOString()
    if(!trains.length){await supabaseAdmin.from('agent_steps').update({status:'failed',output_json:{browser,context:params.c,trains:[]},error:'no_verified_train_rows',completed_at:at}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'The rail provider opened, but Gogo could not verify actual train rows yet.',progress:65,error:'no_verified_train_rows',updated_at:at}).eq('id',runId);return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`The train task reached the provider for ${params.c.routeLabel} on ${params.c.date}, but I could not verify actual train rows yet. I did not invent availability or fares.`,handledBy:'train-research' as const}}
    const text=formatTrainResult(params.c,trains)
    await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:{browser,context:params.c,trains,inventoryType:'browser-verified'},completed_at:at}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:'completed',summary:safe(text,1800),progress:100,completed_at:at,updated_at:at,metadata_json:{...baseMeta,state:'completed'}}).eq('id',runId);await activity(tg,runId,'run_completed',`Task completed with ${trains.length} browser-verified train options.`,{result_count:trains.length});return{runId,status:'completed' as const,capability:'travel' as const,risk:'low' as const,text,handledBy:'train-research' as const}
  }catch(err:any){
    const at=new Date().toISOString();const msg=safe(err?.message||'train_research_failed',500)
    const stepCleanup=await supabaseAdmin.from('agent_steps').update({status:'failed',error:msg,completed_at:at}).eq('id',String(step.id))
    if(stepCleanup.error)console.error('TRAIN_STEP_CLEANUP_FAILED:',stepCleanup.error.message)
    const runCleanup=await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete the train task.',error:msg,completed_at:at,updated_at:at}).eq('id',runId)
    if(runCleanup.error)console.error('TRAIN_RUN_CLEANUP_FAILED:',runCleanup.error.message)
    // Fail CLOSED. Throwing here let the caller fall through to the general planner,
    // which answered from the model — the user received invented train numbers and
    // timings after the browser never opened. A failed provider read must report the
    // failure, never hand the question to a path that can fabricate inventory.
    return{runId,status:'failed' as const,capability:'travel' as const,risk:'low' as const,text:`I could not reach the rail provider for ${params.c.routeLabel} on ${params.c.date}, so I have no verified train options for you. I did not invent timings or availability. Try again shortly, or check IRCTC directly.`,handledBy:'train-research' as const}
  }
}

export async function tryRunTrainResearch(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  const resumed=await tryResumeTrainHandoff({actor:params.actor,text:params.text})
  if(resumed)return resumed

  const pref=trainPreference(params.text)
  if(pref!==null){
    const pending=await latestPreferenceRun(params.actor.legacyTelegramId)
    if(pending?.id&&pending?.metadata_json?.context){
      const meta:any=pending.metadata_json
      return await executeTrainRun({actor:params.actor,surface:params.surface,runId:String(pending.id),c:meta.context,inputText:String(meta.input_text||''),directOnly:pref})
    }
  }

  if(!isTrainResearchRequest(params.text))return null
  const c=context(params.text)
  if(!c.from||!c.to||!c.date)return{runId:'',status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:'I can run the train task, but I still need the missing origin, destination or travel date.',handledBy:'train-research' as const}
  const tg=params.actor.legacyTelegramId,now=new Date().toISOString()
  const explicitPreference=trainPreference(params.text)
  const baseMeta:any={plan_type:'train_research',input_text:safe(params.text,1800),context:c,task_based:true,state:explicitPreference===null?'awaiting_train_preference':'executing',directOnly:explicitPreference}
  const {data:run,error}=await supabaseAdmin.from('agent_runs').insert({telegram_id:String(tg),type:'train_research',capability:'travel',status:explicitPreference===null?'paused':'running',title:`Train task · ${c.routeLabel}`,summary:explicitPreference===null?'Waiting for direct-train preference.':'Gogo is starting the live train search.',progress:explicitPreference===null?10:20,why:'This is a live train search task.',source:params.surface,metadata_json:baseMeta,started_at:now,updated_at:now}).select('id').single()
  if(error||!run?.id)throw new Error(`train_run_create_failed:${error?.message||'unknown'}`)
  const runId=String(run.id)
  if(explicitPreference===null){
    await activity(tg,runId,'waiting_for_user','Gogo has the route and date and needs only the direct-train preference.',{context:c})
    return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:'Direct train only, or are connections okay?',handledBy:'train-preference' as const}
  }
  return await executeTrainRun({actor:params.actor,surface:params.surface,runId,c,inputText:params.text,directOnly:explicitPreference})
}

// Called by /api/cron/autonomous-runs for runs the WhatsApp webhook enqueued.
// Rebuilds the params from the run's metadata and runs the real browser flow.
export async function runQueuedTrainResearch(params:{actor:AgentActor;runId:string}){
  const {data:run,error}=await supabaseAdmin.from('agent_runs').select('id,metadata_json').eq('id',params.runId).maybeSingle()
  if(error||!run?.id)throw new Error(`train_queued_run_missing:${error?.message||params.runId}`)
  const meta:any=run.metadata_json||{}
  if(!meta?.context?.date)throw new Error('train_queued_run_no_context')
  return executeTrainRun({actor:params.actor,surface:'whatsapp',runId:params.runId,c:meta.context,inputText:String(meta.input_text||''),directOnly:Boolean(meta.directOnly),fromWorker:true})
}
