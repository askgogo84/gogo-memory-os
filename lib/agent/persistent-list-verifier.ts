import { addToListDetailed, getAllLists, getList } from '@/lib/data/lists'
import type { AgentActor } from './actor'

type MissionStep = { tool:string; title:string; instruction:string }

function safe(value:unknown,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}
function norm(value:unknown){return safe(value,500).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()}

function explicitListName(step:MissionStep,missionText:string){
  const combined=`${step.instruction}\n${missionText}`
  const patterns=[
    /(?:list\s+)?(?:called|titled|named)\s+['“\"]([^'”\"]+)['”\"]/i,
    /(?:list\s+)?(?:called|titled|named)\s+([^.,;]+?)(?=\s+with\b|\s+containing\b|\s+and\b|[.,;]|$)/i,
  ]
  for(const pattern of patterns){const match=combined.match(pattern);if(match?.[1])return safe(match[1],180)}
  return null
}

function requestedItems(step:MissionStep,missionText:string){
  const combined=`${step.instruction}\n${missionText}`
  const candidates=[
    step.instruction.match(/\bitems?\s*:\s*([^.;]+)/i)?.[1],
    combined.match(/\bwith\s+([^.;]+?)(?=(?:\.\s*Then\b|\bThen\b|\bthen remind\b|$))/i)?.[1],
    combined.match(/\bcontaining\s+([^.;]+?)(?=(?:\.\s*Then\b|\bThen\b|$))/i)?.[1],
  ].filter(Boolean) as string[]
  const out:string[]=[]
  const add=(value:string)=>{const item=safe(value.replace(/^(?:and|the)\s+/i,''),160);if(item&&!out.some(x=>norm(x)===norm(item)))out.push(item)}
  for(const clause of candidates){
    clause.split(/,|\band\b/i).map(x=>x.trim()).filter(Boolean).forEach(add)
    if(out.length)break
  }
  for(const common of ['Passport','Charger','Power Bank','Laptop','Phone Charger']){
    if(new RegExp(`\\b${common.replace(/ /g,'\\s+')}\\b`,'i').test(combined))add(common)
  }
  return out
}

export function hasExplicitNamedListIntent(step:MissionStep,missionText:string){
  return Boolean(explicitListName(step,missionText)) && /\bcreate\b/i.test(`${step.title} ${step.instruction} ${missionText}`)
}

export async function executeExactNamedPersistentList(params:{actor:AgentActor;step:MissionStep;missionText:string}){
  const requestedName=explicitListName(params.step,params.missionText)
  if(!requestedName)throw new Error('persistent_exact_list_name_missing')
  const required=requestedItems(params.step,params.missionText)
  if(!required.length)throw new Error('persistent_exact_list_items_missing')

  const before=await getAllLists(params.actor.legacyTelegramId)
  const existing=(before||[]).find((row:any)=>norm(row.list_name)===norm(requestedName))
  await addToListDetailed(params.actor.legacyTelegramId,requestedName,required)

  const after=await getAllLists(params.actor.legacyTelegramId)
  const exact=(after||[]).find((row:any)=>norm(row.list_name)===norm(requestedName))
  if(!exact?.id)throw new Error('persistent_exact_list_name_unverified')

  const verified=await getList(params.actor.legacyTelegramId,String(exact.list_name))
  if(!verified?.id||norm(verified.list_name)!==norm(requestedName))throw new Error('persistent_exact_list_readback_mismatch')
  const items=Array.isArray(verified.items)?verified.items:[]
  const itemNames=items.map((item:any)=>norm(item?.text||item?.name||item))
  const missing=required.filter(item=>!itemNames.includes(norm(item)))
  if(missing.length)throw new Error(`persistent_exact_list_items_unverified:${missing.join('|')}`)

  return {
    text:`Created ${verified.list_name} with ${required.length} requested items verified.`,
    output:{
      listId:String(verified.id),listName:String(verified.list_name),itemCount:items.length,items:items.slice(0,80),
      requestedItems:required,reused:Boolean(existing),verifiedStore:'lists',verifiedExactName:true,verifiedRequestedItems:true,
    },
  }
}
