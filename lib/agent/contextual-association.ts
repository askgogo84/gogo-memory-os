import { buildContextPack, renderContextBlock } from './context-brain'
import { askClaude } from '@/lib/claude'

export type ContextualAssociationItem={
  kind:'media'|'image_note'|'link'|'document'
  platform?:string
  title:string
  summary:string
  tags?:string[]
}

export async function contextualizeSavedItemReply(params:{
  userId:string
  telegramId:number
  whatsappId?:string|null
  name?:string|null
  baseReply:string
  item:ContextualAssociationItem
}){
  const query=[params.item.title,params.item.summary,...(params.item.tags||[])].filter(Boolean).join(' ').slice(0,1800)
  if(query.length<20)return params.baseReply

  const pack=await buildContextPack({
    actor:{
      userId:params.userId,
      legacyTelegramId:params.telegramId,
      whatsappId:String(params.whatsappId||''),
      name:params.name||'Gogo',
    },
    text:query,
    options:{includeSemantic:true,maxFacts:10,horizonDays:60},
  }).catch(()=>null)
  if(!pack)return params.baseReply

  const relevant=pack.facts
    .filter(f=>['semantic_memory','memory_insight','open_loop','goal','typed_context','life_event'].includes(f.source))
    .filter(f=>f.score>=0.58&&f.confidence>=0.55)
    .slice(0,6)
  if(!relevant.length)return params.baseReply

  const contextualBlock=renderContextBlock({...pack,facts:relevant},2200)
  const associationPrompt=[
    'A new saved item was just understood.',
    `Kind: ${params.item.kind}`,
    params.item.platform?`Platform: ${params.item.platform}`:'',
    `Title: ${params.item.title}`,
    `Summary: ${params.item.summary}`,
    '',
    'Using only the supplied AskGogo context, write ONE short, natural sentence about an existing project/workstream/person that this item is clearly relevant to and why.',
    'If there is no strong, specific connection, return exactly NONE.',
    'Do not mention internal memory, retrieval, scores, context packs, watchers, open loops, or hidden identifiers.',
    'Do not introduce any named entity unless it appears in the supplied context and is materially connected to the new item.',
    'Do not repeat the saved-item summary. Add only the useful association.',
  ].filter(Boolean).join('\n')

  try{
    const association=(await askClaude(associationPrompt,[],[],params.name||'Gogo','',contextualBlock)).trim()
    if(!association||/^none[.!]?$/i.test(association))return params.baseReply
    if(association.length>320)return params.baseReply
    return `${params.baseReply}\n\n${association}`
  }catch{
    return params.baseReply
  }
}
