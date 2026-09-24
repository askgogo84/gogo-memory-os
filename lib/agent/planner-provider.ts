import { measureModelCall, type ModelUsage } from './model-usage'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

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

async function anthropicComplete(prompt:string,onUsage?:(usage:ModelUsage)=>void){
  const result=await measureModelCall({provider:'anthropic',model:'claude-haiku-4-5',onUsage,usage:(r:any)=>({input:r.usage?.input_tokens,output:r.usage?.output_tokens,cached:Number(r.usage?.cache_read_input_tokens||0)+Number(r.usage?.cache_creation_input_tokens||0)}),call:()=>anthropic.messages.create({
    model:'claude-haiku-4-5',
    max_tokens:2200,
    temperature:0,
    messages:[{role:'user',content:prompt}],
  })})
  return result.content[0]?.type==='text'?result.content[0].text:''
}

async function openAiComplete(prompt:string,onUsage?:(usage:ModelUsage)=>void){
  if(!openai)throw new Error('openai_planner_fallback_not_configured')
  const result=await measureModelCall({provider:'openai',model:OPENAI_FALLBACK_MODEL,onUsage,usage:(r:any)=>({input:r.usage?.prompt_tokens,output:r.usage?.completion_tokens}),call:()=>openai.chat.completions.create({
    model:OPENAI_FALLBACK_MODEL,
    max_tokens:2200,
    temperature:0,
    messages:[{role:'user',content:prompt}],
  })})
  return result.choices?.[0]?.message?.content||''
}

export async function completeAgentPlanPrompt(prompt:string,onUsage?:(usage:ModelUsage)=>void){
  return completePlannerPromptWithFallback(prompt,p=>anthropicComplete(p,onUsage),p=>openAiComplete(p,onUsage))
}

