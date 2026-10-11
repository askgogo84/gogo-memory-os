import { measureModelCall, type ModelUsage } from './model-usage'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import * as asyncHooks from 'node:async_hooks'

// The browser planner model. A caller (the booking rehearsal) may run one task on another model;
// the override is scoped to that async call only, never to other requests on the same instance.
const DEFAULT_PLANNER_MODEL='claude-haiku-4-5'
const plannerModelScope=typeof (asyncHooks as any).AsyncLocalStorage==='function'?new (asyncHooks as any).AsyncLocalStorage():null
export function withPlannerModel<T>(model:string,work:()=>Promise<T>):Promise<T>{return plannerModelScope?plannerModelScope.run(model,work):work()}
export function currentPlannerModel():string{return (plannerModelScope?.getStore() as string|undefined)||DEFAULT_PLANNER_MODEL}

type Complete = (prompt:string)=>Promise<string>

function safeProviderError(error:any){
  return {
    name:String(error?.name||'Error'),
    status:error?.status||null,
    type:error?.type||error?.error?.type||null,
    message:redactSecretShapedText(String(error?.message||error||'').slice(0,240)),
  }
}

export async function completePlannerPromptWithFallback(
  prompt:string,
  primary:Complete,
  fallback:Complete,
):Promise<string>{
  try{
    const out=String(await primary(prompt)||'').trim()
    if(out)return out
    throw new Error('planner_primary_empty')
  }catch(error:any){
    console.error('AGENT_PLANNER_PRIMARY_FAILED_FALLING_BACK:',safeProviderError(error))
    const out=String(await fallback(prompt)||'').trim()
    if(!out)throw new Error('planner_fallback_empty')
    return out
  }
}

const anthropic=new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY!})
const openai=process.env.OPENAI_API_KEY?new OpenAI({apiKey:process.env.OPENAI_API_KEY}):null
const OPENAI_FALLBACK_MODEL=process.env.OPENAI_FALLBACK_MODEL||'gpt-4o-mini'

async function anthropicComplete(prompt:string,onUsage?: (usage:ModelUsage)=>void,system?:string){
  const model=currentPlannerModel()
  const result=await measureModelCall({provider:'anthropic',model,onUsage,usage:(r:any)=>({input:r.usage?.input_tokens,output:r.usage?.output_tokens,cached:Number(r.usage?.cache_read_input_tokens||0)+Number(r.usage?.cache_creation_input_tokens||0)}),call:()=>anthropic.messages.create({
    model,
    max_tokens:2200,
    // 11 Oct rehearsal: claude-haiku-5-5 rejects temperature ("deprecated for this model") and the
    // planner silently fell back to OpenAI. Only the 4.x models take it.
    ...(/-4-/.test(model)?{temperature:0}:{}),
    ...(system?{system}:{}),
    messages:[{role:'user',content:prompt}],
  })})
  return result.content[0]?.type==='text'?result.content[0].text:''
}

async function openAiComplete(prompt:string,onUsage?: (usage:ModelUsage)=>void,system?:string){
  if(!openai)throw new Error('openai_planner_fallback_not_configured')
  const result=await measureModelCall({provider:'openai',model:OPENAI_FALLBACK_MODEL,onUsage,usage:(r:any)=>({input:r.usage?.prompt_tokens,output:r.usage?.completion_tokens}),call:()=>openai.chat.completions.create({
    model:OPENAI_FALLBACK_MODEL,
    max_tokens:2200,
    temperature:0,
    messages:[...(system?[{role:'system' as const,content:system}]:[]),{role:'user',content:prompt}],
  })})
  return result.choices?.[0]?.message?.content||''
}

export async function completeAgentPlanPrompt(prompt:string,onUsage?:(usage:ModelUsage)=>void,system?:string){
  return completePlannerPromptWithFallback(prompt,p=>anthropicComplete(p,onUsage,system),p=>openAiComplete(p,onUsage,system))
}

