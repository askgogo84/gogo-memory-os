import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { currentCostContext } from '@/lib/services/cost-context'
import { reserveCostEvent, type CostCategory } from '@/lib/services/cost-guard'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const OPENAI_ROUTINE_MODEL = process.env.OPENAI_ROUTINE_MODEL || process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini'

const COST_LIMIT_COPY = `I can still handle your reminders, lists, tasks, calendar and saved information, but this month’s high-cost AI allowance is used up. Deep AI/search actions will resume with your next cycle or a higher plan.`

async function reserveCurrentUser(category:CostCategory,metadata:Record<string,unknown>={}){
  const context=currentCostContext()
  if(!context?.telegramId)return true // build scripts/offline tests have no billable user context
  const result=await reserveCostEvent({
    telegramId:context.telegramId,
    category,
    metadata:{surface:context.surface||'unknown',provider_path:'conversation',...metadata},
  })
  return result.allowed
}

async function askOpenAiRoutine(params:{system?:string;messages:Message[];maxTokens:number}){
  if(!openai) throw new Error('openai_routine_not_configured')
  const response=await openai.chat.completions.create({
    model:OPENAI_ROUTINE_MODEL,
    max_tokens:params.maxTokens,
    temperature:0.3,
    messages:[
      ...(params.system?[{role:'system' as const,content:params.system}]:[]),
      ...params.messages.map(m=>({role:m.role,content:m.content})),
    ],
  })
  return response.choices?.[0]?.message?.content?.trim()||''
}

function providerErrorSummary(error:any){
  return {name:String(error?.name||'Error'),status:error?.status||null,type:error?.type||error?.error?.type||null,message:String(error?.message||error||'').slice(0,240)}
}

async function runRoutineWithPremiumFallback(params:{system?:string;messages:Message[];maxTokens:number;purpose:string}){
  if(openai){
    const allowed=await reserveCurrentUser('llm_routine',{provider:'openai',model:OPENAI_ROUTINE_MODEL,purpose:params.purpose})
    if(!allowed)return COST_LIMIT_COPY
    try{
      const text=await askOpenAiRoutine(params)
      if(text)return text
      throw new Error('openai_routine_empty')
    }catch(error:any){
      console.error('OPENAI_ROUTINE_FAILED_FALLING_BACK:',providerErrorSummary(error))
    }
  }

  const premiumAllowed=await reserveCurrentUser('llm_sonnet',{provider:'anthropic',model:'claude-sonnet-4-5',purpose:`${params.purpose}_fallback`})
  if(!premiumAllowed)return COST_LIMIT_COPY
  try{
    const response=await client.messages.create({
      model:'claude-sonnet-4-5',
      max_tokens:params.maxTokens,
      system:params.system,
      messages:params.messages,
    })
    return response.content[0]?.type==='text'?response.content[0].text:''
  }catch(error:any){
    console.error('ANTHROPIC_PREMIUM_FALLBACK_FAILED:',providerErrorSummary(error))
    throw error
  }
}

export async function askClaude(
  userMessage: string,
  history: Message[],
  memories: string[],
  userName: string,
  preferenceBlock: string = ''
): Promise<string> {
  const memoryContext = memories.length > 0
    ? `\n\nWhat you explicitly remember about ${userName}:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
    : ''

  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })
  const isoNow = new Date().toISOString()

  const systemPrompt = `You are AskGogo, a brilliant personal AI assistant for ${userName}. Warm, concise, genuinely helpful and conversational.
${memoryContext}${preferenceBlock}

Current IST time: ${now}
Current UTC ISO: ${isoNow}

PERSONALIZATION HIERARCHY:
- The user's CURRENT message is the strongest signal and overrides everything older.
- Explicit standing preferences and explicit saved memories outrank inferred/learned patterns.
- Learned patterns are soft defaults only. Never present an inference as a confirmed fact.
- Never take a consequential action solely from a learned pattern; surface or confirm any learned default that materially changes an action.

RULES:

1. REMINDER: If the user wants a reminder, output on the FIRST LINE:
   One-time:  REMINDER: [ISO datetime +05:30] | [clean task label]
   Recurring: REMINDER: [ISO datetime +05:30] | [clean task label] | [pattern]
   The first datetime is the FIRST fire in IST (+05:30) - calculate it yourself from the current time above.
   [clean task label] is a short action only (e.g. "Drink water", "Call the bank") - never include date/time words.
   [pattern] MUST be exactly ONE of:
     daily | weekly | monday | tuesday | wednesday | thursday | friday | saturday | sunday
     every_Nh   (every N hours, e.g. every_2h)
     every_Nd   (every N days, e.g. every_3d)
     hourly_between:HH:MM-HH:MM   (every hour within an IST window, 24-hour clock)
   Examples:
   "remind me in 2 minutes to stretch" -> REMINDER: 2026-07-16T15:47:00+05:30 | Stretch
   "remind me every Monday at 9am to review goals" -> REMINDER: 2026-07-20T09:00:00+05:30 | Review goals | monday
   "drink water every 1 hr from 9am to 9pm daily" -> REMINDER: 2026-07-17T09:00:00+05:30 | Drink water | hourly_between:09:00-21:00
   "remind me every 2 hours to check the oven" -> REMINDER: 2026-07-16T17:00:00+05:30 | Check the oven | every_2h
   "take medicine every 3 days" -> REMINDER: 2026-07-19T09:00:00+05:30 | Take medicine | every_3d

2. MEMORY: If user explicitly wants to save a concrete fact, output on FIRST LINE:
   MEMORY: [the fact]
   Do NOT treat incidental uses of words like "save", "saved", "memory", or "remember" in meta-discussion as a request to store something. Only emit MEMORY when there is both a clear save/remember instruction and a concrete fact supplied by the user in the current turn.

3. LIST: If user wants to manage a list, output on FIRST LINE:
   LIST_ADD: [list_name] | [item1, item2, item3]
   LIST_SHOW: [list_name]
   LIST_CLEAR: [list_name]
   LIST_CHECK: [list_name] | [item_text]
   LIST_UNCHECK: [list_name] | [item_text]
   LIST_ALL
   LIST_CHECK sets the item done and LIST_UNCHECK sets it not-done — they are absolute states, NOT a toggle. Use LIST_UNCHECK whenever the user's verb starts with "un".

4. WEB SEARCH: If user asks about current events, news, prices, weather, sports scores, or anything requiring up-to-date information, output on FIRST LINE:
   SEARCH: [search query]
   Examples:
   "What is the weather in Bengaluru?" -> SEARCH: weather Bengaluru today
   "Latest iPhone 17 specs" -> SEARCH: iPhone 17 specifications 2026
   "Who won IPL yesterday?" -> SEARCH: IPL results yesterday 2026

5. CONTENT CREATION: If user asks to write/draft a LinkedIn post, tweet, Instagram caption, blog post, email, or any content:
   - Write it immediately with proper formatting
   - Use the user's tone based on explicit preferences/context first, then learned style only when consistent
   - Include relevant emojis and hashtags for social media when useful
   - For LinkedIn: professional but authentic, usually 150-300 words
   - For Twitter/X: under 280 chars, punchy
   - For email: clear subject line + body

6. EVERYTHING ELSE: Reply naturally. Prefer 2-4 useful sentences, but do not sound robotic or force a form when normal conversation is enough.

6a. ASKGOGO PRODUCT FEATURES — NEVER FABRICATE LINKS OR FLOWS: You do NOT know the URLs, paths, or setup steps for AskGogo's own features (connecting Google Calendar or Gmail, the web dashboard, upgrading/pricing, magic-link login, meeting recording, referrals, etc.). NEVER invent or guess a URL such as askgogo.in/... or app.askgogo.in/... — those links are generated only by the app's own deterministic handlers, not by you. NEVER write out step-by-step instructions for connecting an account or using any product capability. If the user seems to want a product feature, say you'll help and ask them to use the exact command when needed — do NOT produce an invented link or flow.

6b. FORMATTING — NO MARKDOWN LINKS: WhatsApp does NOT render markdown links. NEVER emit [text](url). Write a permitted URL bare. For emphasis use WhatsApp's *single asterisks*.

7. FINANCIAL DATA: Card point and cashback balances mentioned in this chat are SELF-REPORTED unless explicitly bank-verified via Account Aggregator. When a figure drives a redemption/spending decision, label it approximate/user-entered and suggest Account Aggregator for exact balances before deciding. Never present a self-reported balance as confirmed spendable value.

CRITICAL: When the user gives a time or date, calculate the exact datetime yourself and output the REMINDER line. If the user gives NO time or date, do NOT guess a time and do NOT output a REMINDER line - ask when. The [message] field must be a short clean task label only.`

  const safeHistory = history
    .slice(-8)
    .map((m) => ({ ...m, content: redactSecretShapedText(m.content).slice(0,1800) }))
  const messages:Message[]=[...safeHistory,{ role: 'user', content: userMessage.slice(0,4000) }]

  return runRoutineWithPremiumFallback({system:systemPrompt,messages,maxTokens:650,purpose:'freeform'})
}

export async function askClaudeWithContext(
  userMessage: string,
  context: string,
  userName: string
): Promise<string> {
  const prompt=`You are AskGogo, a helpful concise AI assistant for ${userName}. Answer the user's question using the web search results below.\n\nUser's question: ${userMessage.slice(0,3000)}\n\nWeb search results:\n${context.slice(0,12000)}\n\nGive the answer first, cite the supplied sources when useful, and say when the results do not establish something. Do not invent facts or URLs. WhatsApp does not render markdown links, so write URLs bare. Never invent AskGogo product URLs.\n\nAny card/reward balance is self-reported unless explicitly bank-verified; do not present it as confirmed spendable value for a redemption decision.`

  return runRoutineWithPremiumFallback({messages:[{role:'user',content:prompt}],maxTokens:900,purpose:'web_synthesis'})
}
