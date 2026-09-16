import Anthropic from '@anthropic-ai/sdk'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { runSecureBrowser } from './secure-computer'
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
  const t=text.toLowerCase();if(/\btomorrow\b/.test(t)){const d=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate()+1));return isoDay(d)}
  if(/\btoday\b/.test(t))return isoDay(new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate())))
  let m=text.match(/\b(\d{1,2})\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:[,\s]+(20\d{2}))?/i)
  if(m){const mo=MONTHS[m[2].toLowerCase()];const y=Number(m[3]||now.getUTCFullYear());const d=new Date(Date.UTC(y,mo,Number(m[1])));if(d.getUTCMonth()===mo)return isoDay(d)}
  m=text.match(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/);if(m)return isoDay(new Date(Date.UTC(Number(m[1]),Number(m[2])-1,Number(m[3]))))
  return null
}

export function isTrainResearchRequest(text:string){const t=String(text||'').toLowerCase();return /\b(irctc|train|trains|railway|railways)\b/.test(t)&&/\b(find|search|show|available|availability|check|options|seat|seats|ticket|tickets)\b/.test(t)}

function context(text:string){const from=station(seg(text,'from'));const to=station(seg(text,'to'));const date=parseDate(text);return{from,to,date,routeLabel:from&&to?`${from.code||from.label} → ${to.code||to.label}`:'Train search'}}
function parseJsonArray(text:string){const c=String(text||'').replace(/```json|```/g,'').trim();try{const v=JSON.parse(c);return Array.isArray(v)?v:[]}catch{}const m=c.match(/\[[\s\S]*\]/);if(!m)return[];try{const v=JSON.parse(m[0]);return Array.isArray(v)?v:[]}catch{return[]}}

async function extract(pageText:string,routeLabel:string,date:string){
  const prompt=`Extract only actual train options visibly present in this IRCTC/browser page text for ${routeLabel} on ${date}. Return JSON array only. Each item: {"trainNumber":"","trainName":"","departure":"","arrival":"","duration":"","classes":[""],"availability":"","evidence":""}. Do not invent availability or fares. If no real train rows are visible, return []. Page text: ${JSON.stringify(pageText.slice(0,14000))}`
  const res=await anthropic.messages.create({model:'claude-haiku-4-5',max_tokens:2200,temperature:0,messages:[{role:'user',content:prompt}]})
  const raw=res.content[0]?.type==='text'?res.content[0].text:''
  return parseJsonArray(raw).slice(0,10).map((x:any)=>({trainNumber:safe(x.trainNumber,20),trainName:safe(x.trainName,100),departure:safe(x.departure,40),arrival:safe(x.arrival,40),duration:safe(x.duration,40),classes:Array.isArray(x.classes)?x.classes.map((v:any)=>safe(v,20)).filter(Boolean).slice(0,8):[],availability:safe(x.availability,120),evidence:safe(x.evidence,320)})).filter((x:any)=>x.trainNumber&&x.trainName&&x.departure&&x.arrival)
}

async function activity(tg:number,runId:string,event:string,message:string,metadata:Record<string,unknown>={}){await supabaseAdmin.from('agent_activity').insert({telegram_id:String(tg),run_id:runId,event_type:event,message:safe(message,900),metadata_json:metadata}).then(({error})=>{if(error)console.error('TRAIN_ACTIVITY_FAILED:',error.message)})}

export async function tryRunTrainResearch(params:{actor:AgentActor;surface:AgentSurface;text:string}){
  if(!isTrainResearchRequest(params.text))return null
  const c=context(params.text);if(!c.from||!c.to||!c.date)return{runId:'',status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:'I can run the train task, but I need origin, destination and travel date.',handledBy:'train-research' as const}
  const tg=params.actor.legacyTelegramId;const now=new Date().toISOString()
  const {data:run,error}=await supabaseAdmin.from('agent_runs').insert({telegram_id:String(tg),type:'train_research',capability:'travel',status:'running',title:`Train task · ${c.routeLabel}`,summary:'Gogo is working through IRCTC in the secure browser.',progress:20,why:'This is a live train availability task.',source:params.surface,metadata_json:{plan_type:'train_research',input_text:safe(params.text,1800),context:c,task_based:true},started_at:now,updated_at:now}).select('id').single()
  if(error||!run?.id)throw new Error(`train_run_create_failed:${error?.message||'unknown'}`)
  const runId=String(run.id);const {data:step,error:stepError}=await supabaseAdmin.from('agent_steps').insert({telegram_id:String(tg),run_id:runId,ordinal:1,tool_name:'secure_browser',title:'Work through IRCTC train search',status:'running',input_json:{context:c},output_json:{},started_at:now}).select('id').single();if(stepError||!step?.id)throw new Error(`train_step_create_failed:${stepError?.message||'unknown'}`)
  await activity(tg,runId,'browser_research_started',`Gogo opened IRCTC for ${c.routeLabel}.`,{date:c.date})
  try{
    const browser=await runSecureBrowser({userId:params.actor.userId,url:'https://www.irctc.co.in/nget/train-search',objective:`Find trains from ${c.from.label} (${c.from.code}) to ${c.to.label} (${c.to.code}) on ${c.date}. Use safe search controls and obtain actual train rows and visible availability. Do not sign in, book, submit passenger details or pay.`,mode:'read'})
    if(browser.status==='blocked'){
      const at=new Date().toISOString();await supabaseAdmin.from('agent_steps').update({status:'failed',output_json:{browser,context:c},error:browser.blockReason||'blocked',completed_at:at}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:'paused',summary:browser.summary,progress:50,error:browser.blockReason||'blocked',updated_at:at}).eq('id',runId);await activity(tg,runId,'browser_blocked',browser.summary,{reason:browser.blockReason||null});return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`Train task paused · ${c.routeLabel} · ${c.date}\n${browser.summary}\n\nNo booking or payment action was made.`,blockedReason:browser.blockReason,handledBy:'train-research' as const}
    }
    const trains=await extract(browser.pageText,c.routeLabel,c.date);const at=new Date().toISOString()
    if(!trains.length){await supabaseAdmin.from('agent_steps').update({status:'failed',output_json:{browser,context:c,trains:[]},error:'no_verified_train_rows',completed_at:at}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:'paused',summary:'IRCTC opened, but Gogo could not verify actual train rows yet.',progress:65,error:'no_verified_train_rows',updated_at:at}).eq('id',runId);return{runId,status:'paused' as const,capability:'travel' as const,risk:'low' as const,text:`IRCTC task reached the site for ${c.routeLabel} on ${c.date}, but I could not verify actual train rows yet. I did not invent availability.`,handledBy:'train-research' as const}}
    const text=`IRCTC train task completed · ${c.routeLabel} · ${c.date}\n\n${trains.slice(0,8).map((tr:any,i:number)=>`${i+1}. ${tr.trainNumber} ${tr.trainName} · ${tr.departure} → ${tr.arrival}${tr.duration?` · ${tr.duration}`:''}${tr.classes.length?` · ${tr.classes.join(', ')}`:''}${tr.availability?`\nAvailability: ${tr.availability}`:''}`).join('\n\n')}\n\nSource: browser-verified IRCTC page. No booking was made.`
    await supabaseAdmin.from('agent_steps').update({status:'completed',output_json:{browser,context:c,trains,inventoryType:'browser-verified'},completed_at:at}).eq('id',String(step.id));await supabaseAdmin.from('agent_runs').update({status:'completed',summary:safe(text,1800),progress:100,completed_at:at,updated_at:at}).eq('id',runId);await activity(tg,runId,'run_completed',`Task completed with ${trains.length} browser-verified train options.`,{result_count:trains.length});return{runId,status:'completed' as const,capability:'travel' as const,risk:'low' as const,text,handledBy:'train-research' as const}
  }catch(err:any){const at=new Date().toISOString();const msg=safe(err?.message||'train_research_failed',500);await supabaseAdmin.from('agent_steps').update({status:'failed',error:msg,completed_at:at}).eq('id',String(step.id)).catch(()=>{});await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete the IRCTC task.',error:msg,completed_at:at,updated_at:at}).eq('id',runId).catch(()=>{});throw err}
}
