import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import {selectContentWorkflow, contentWorkflowPrompt} from '@/lib/agent/content-workflows'

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY!,
})

const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null
const OPENAI_FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL || 'gpt-4o-mini'

async function askOpenAiFallback(params:{system?:string;messages:Message[];maxTokens:number}){
  if(!openai) throw new Error('openai_fallback_not_configured')
  const response=await openai.chat.completions.create({
    model:OPENAI_FALLBACK_MODEL,
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

export function isContextSynthesisTurn(text:string){
  const t=String(text||'').trim()
  return /\b(?:based on|using|considering)\s+(?:everything|what|all)\s+(?:you\s+)?(?:already\s+)?know\b/i.test(t)
    || /\bwhat\s+(?:existing\s+)?context\s+matters\b/i.test(t)
    || /\buse\s+(?:my\s+)?(?:saved|existing|known)\s+context\b/i.test(t)
    || /\bconsider\s+(?:my\s+)?(?:travel|calendar|life|saved)\s+context\b/i.test(t)
}

export function isBriefingTurn(text:string){return /\b(?:morning|daily)\s+(?:briefing|brief|summary)\b|\bbrief me\b|\bplan (?:my|the) (?:day|week)\b/i.test(text)}
export function filterBriefingTravelContext(text:string,now=new Date()):string{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now)
  const today=`${parts.find(p=>p.type==='year')?.value}-${parts.find(p=>p.type==='month')?.value}-${parts.find(p=>p.type==='day')?.value}`
  const year=Number(today.slice(0,4)),months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  return String(text||'').split('\n').filter(line=>{
    if(!/\b(?:flight|flights|airline|lands?|landing|depart(?:ure|s|ing)?|itinerary|klm)\b/i.test(line))return true
    const dates=[...line.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)].map(m=>`${m[1]}-${m[2]}-${m[3]}`)
    for(const m of line.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?:\s+(20\d{2}))?\b/gi)){
      const month=months.indexOf(m[2].slice(0,3).toLowerCase())+1
      dates.push(`${m[3]||year}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`)
    }
    return !dates.length||!dates.every(date=>date<today)
  }).join('\n')
}

export async function askClaude(
  userMessage: string,
  history: Message[],
  memories: string[],
  userName: string,
  preferenceBlock: string = '',
  contextualBlock: string = ''
): Promise<string> {
  const briefing=isBriefingTurn(userMessage)
  if(briefing){memories=memories.map(memory=>filterBriefingTravelContext(memory)).filter(Boolean);contextualBlock=filterBriefingTravelContext(contextualBlock)}
  const memoryContext = memories.length > 0
    ? `\n\nWhat you remember about ${userName}:\n${memories.map((m, i) => `${i + 1}. ${m}`).join('\n')}`
    : ''

  // 18 Oct live: "18/10/2026, 1:10 am" carried no weekday and the model called Sunday "Saturday" in the
  // morning briefing and "plan my week". The weekday is spelled out.
  const now = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date())
  const isoNow = new Date().toISOString()

  const contextualContext = contextualBlock ? `\n\n${contextualBlock}` : ''
  const workflow = selectContentWorkflow(userMessage)
  const maxTokens = workflow?.maxTokens || 1024

  const systemPrompt = `You are AskGogo, a brilliant personal AI assistant for ${userName}. Warm, concise, genuinely helpful.
${memoryContext}${preferenceBlock}${contextualContext}

Current IST time: ${now}
Current UTC ISO: ${isoNow}
Dates in saved context that are before today are history: never list them under upcoming, today or agenda (leave them out of briefings and plans). A morning briefing covers today and what is ahead only.

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
   LIST_CHECK: [list_name] | [item_text]     (mark an item DONE — "done milk", "check milk", "tick milk")
   LIST_UNCHECK: [list_name] | [item_text]   (mark a done item NOT done again — "uncheck milk", "untick milk", "undone milk", "unmark milk")
   LIST_ALL
   LIST_CHECK sets the item done and LIST_UNCHECK sets it not-done — they are absolute states, NOT a toggle. Use LIST_UNCHECK (never LIST_CHECK) whenever the user's verb starts with "un" (uncheck/untick/undone/unmark).

4. WEB SEARCH: If user asks about current events, news, prices, weather, sports scores, or anything requiring up-to-date information, output on FIRST LINE:
   SEARCH: [search query]
   MOVIES (India): showtimes and tickets live on BookMyShow and District. Example: "evening shows for the latest Kannada release at PVR Orion Mall tomorrow" -> SEARCH: latest Kannada movie showtimes PVR Orion Mall Bengaluru tomorrow BookMyShow District. Never claim seats were held or booked.
   SHOPPING (India): when the user wants products to buy, search for product listings on the store they name (Myntra, Ajio, Nykaa, Amazon.in, Flipkart, Tata Cliq), or on Myntra/Ajio/Amazon.in when none is named, with the budget in rupees. Example: "smart-casual outfit under ₹6,000 on Myntra or Ajio" -> SEARCH: men smart casual blazer shirt chinos under 6000 myntra ajio buy
   Examples:
   "What is the weather in Bengaluru?" -> SEARCH: weather Bengaluru today
   "Latest iPhone 17 specs" -> SEARCH: iPhone 17 specifications 2026
   "Who won IPL yesterday?" -> SEARCH: IPL results yesterday 2026

5. CONTENT CREATION: If user asks to write/draft a LinkedIn post, tweet, Instagram caption, blog post, email, or any content:
   - Write the full draft immediately with proper formatting. NEVER reply with only questions: if details are missing, make sensible assumptions from the request and the user's context, write the draft, then add ONE short line inviting changes (e.g. "Want it shorter, or more about security?")
   - Use the user's tone based on their memories/context
   - Include relevant emojis and hashtags for social media
   - For LinkedIn: professional but authentic, 150-300 words
   - For Twitter/X: under 280 chars, punchy
   - For email: clear subject line + body

6. EVERYTHING ELSE: Reply naturally, 2-3 sentences max.

6a. ASKGOGO PRODUCT FEATURES — NEVER FABRICATE LINKS OR FLOWS: You do NOT know the URLs, paths, or setup steps for AskGogo's own features (connecting Google Calendar or Gmail, the web dashboard, upgrading/pricing, magic-link login, meeting recording, referrals, etc.). NEVER invent or guess a URL such as askgogo.in/... or app.askgogo.in/... — those links are generated only by the app's own deterministic handlers, not by you. NEVER write out step-by-step instructions for connecting an account or using any product capability. If the user seems to want a product feature, say you'll help and ask them to rephrase or use the exact command (e.g. "type *connect calendar*") — do NOT produce a link or an invented flow. A wrong or made-up link is worse than no link.

6b. FORMATTING — NO MARKDOWN LINKS: This assistant talks over WhatsApp, which does NOT render markdown. NEVER emit markdown link syntax like [text](url); WhatsApp shows the literal brackets. If you ever need to show a URL (only ones the user themselves provided or from web-search results — never an AskGogo product URL), write it as a bare URL on its own. For emphasis use WhatsApp's *single asterisks*, not markdown.

6c. ANSWER ONLY THE LATEST MESSAGE: Reply only to the user's last message. Earlier messages in the history were already handled; never answer them again, never add a second section ("---", "Re: ...") about an older topic, and never mention an earlier draft, report or plan unless the last message asks about it (13 Oct: "When does Divya land?" came back with a paragraph about an old San Diego birthday plan).

7. FINANCIAL DATA: Card point and cashback balances mentioned in this chat are SELF-REPORTED by the user unless explicitly marked bank-verified via Account Aggregator. When a points or balance figure is used to make or justify a REDEMPTION or SPENDING decision (e.g. "how do I use my points for X", "can I afford Y with my points", "what can I book"), you MUST (a) treat it as approximate and user-entered, not confirmed - e.g. "based on the ~X points you've entered (not yet bank-verified)", and (b) suggest linking cards via Account Aggregator in the CreditIQ app for exact, bank-confirmed balances before deciding. Never present a self-reported balance as a confirmed, spendable fact when advising on a redemption or purchase - this holds even if the "(unverified)" label is not visible in recent context. For a casual balance mention with no spending decision, a light one-time "(self-reported)" note is enough - do not force the full caveat and Account Aggregator suggestion on every figure.

8. CONTEXT SYNTHESIS / CURRENT-TURN RELEVANCE:
   - When the user asks what you already know, what context matters, or asks you to reason from saved context, answer the CURRENT request from the owner-bound context and memories. Do not continue an unrelated earlier conversation branch just because it appears in recent chat history.
   - Do not introduce a named restaurant, vendor, person, product, project, or prior task that is absent from the current user message unless that exact entity is necessary to explain a directly relevant recorded fact.
   - A prior assistant suggestion is never evidence. Do not repeat it as fact.
   - A bounded or failed memory lookup does not prove no record exists. Say what was retrieved and what remains unverified. Never claim a trip is complete or documents are all present without checking a specific checklist.
   - Answer arrival questions using the destination local time and explicit date/timezone. A ticket passenger is not automatically the account owner. For partial name matches state the full recorded name; clarify if multiple candidates match.
   - If a location window is marked INFERRED, say it is inferred from recorded itinerary evidence. Do not promote it to a recorded booking/fact.
   - Never say "when you're back", "after you return", or equivalent about a location unless the owner-bound context contains RECORDED evidence of a return leg/event to that location after the date in question. If that evidence is absent, simply avoid the return claim.

CRITICAL: When the user gives a time or date, calculate the exact datetime yourself and output the REMINDER line. If the user gives NO time or date (e.g. "remind me about the thing"), do NOT guess a time and do NOT output a REMINDER line - instead reply in one short sentence asking when. The [message] field must be a short clean task label only (e.g. "Call the bank") - never include words like "today", "tomorrow", "at 1pm", or "day after".
${workflow ? contentWorkflowPrompt(workflow) : ''}`

  const safeHistory = history.map((m) => ({ ...m, content: redactSecretShapedText(m.content) }))
  // Context-synthesis turns exclude unrelated recent chat branches. The shared
  // message caller also omits unfiltered legacy memories so only its selected
  // owner-bound context pack and standing preferences supply saved evidence.
  const historyForTurn = isContextSynthesisTurn(userMessage)||briefing ? [] : safeHistory.slice(-10)
  const messages:Message[]=[...historyForTurn,{ role: 'user', content: userMessage }]

  try{
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    })
    return response.content[0].type === 'text' ? response.content[0].text : ''
  }catch(error:any){
    console.error('ANTHROPIC_FREEFORM_FAILED_FALLING_BACK:',providerErrorSummary(error))
    return await askOpenAiFallback({system:systemPrompt,messages,maxTokens})
  }
}

// Live flight STATUS only. A flight-status question must never be answered with airfare /
// booking / price content, and an actual-landing claim must be independently grounded in a
// status source (not a schedule, not another assistant's earlier answer). This uses a
// status-scoped system prompt distinct from the generic web-answer prompt.
export async function askClaudeFlightStatus(
  userMessage: string,
  context: string,
  userName: string
): Promise<string> {
  const prompt = `You are AskGogo, answering a LIVE FLIGHT STATUS question for ${userName}.

User's question: ${userMessage}

Flight-status search results (from flight-tracking sources):
${context}

RULES — follow every one:
1. Report ONLY operational status: scheduled / departed / en route / landed / arrived / delayed / cancelled / diverted, plus gate/terminal and scheduled vs actual times when present.
2. NEVER mention ticket prices, fares, airfare, "book", "cheap flights", deals, or any purchase/shopping content. This is a status lookup, not flight shopping. If the results are airfare/booking pages with no operational status, say you could not verify the live status right now and suggest checking the airline's official flight-status page or a tracker like FlightAware/Flightradar24 — do NOT report any prices.
3. Do NOT claim the flight actually landed/arrived unless a result EXPLICITLY states it landed or arrived. If results only show a schedule or are inconclusive, say the scheduled time and that the actual arrival is not yet confirmed. Never infer a landing from the schedule.
4. Do not copy any figure the user quoted from another assistant as ground truth; rely only on the search results above.
5. When you give an arrival/landing time, state the timezone explicitly.

FORMATTING: Delivered over WhatsApp (no markdown). Never emit [text](url); write any URL bare. Keep it concise (2-5 sentences).`

  try {
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 900,
      messages: [{ role: 'user', content: prompt }],
    })
    return response.content[0].type === 'text' ? response.content[0].text : ''
  } catch (error: any) {
    console.error('ANTHROPIC_FLIGHT_STATUS_FAILED_FALLING_BACK:', providerErrorSummary(error))
    return await askOpenAiFallback({ messages: [{ role: 'user', content: prompt }], maxTokens: 900 })
  }
}

/** Today's date in India, so answers about releases, events and schedules compare against the real day. */
export function webAnswerDateLine(now = new Date()) {
  const today = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
  return `TODAY: ${today} (India time). Compare every date in the results with today: something dated today is happening today, an earlier date is past, and only a later date is upcoming. Never call today's date "the future".`
}

export async function askClaudeWithContext(
  userMessage: string,
  context: string,
  userName: string
): Promise<string> {
  // 15 Oct live: on Jailer 2's release day Gogo called it "in the future" because the prompt had no date.
  const prompt=`You are AskGogo, a helpful AI assistant for ${userName}. Answer the user's question using the web search results provided below.

${webAnswerDateLine()}

User's question: ${userMessage}

Web search results:
${context}

Provide a clear, concise answer based on these results. Cite sources when relevant. If the results don't fully answer the question, say so.

SHOPPING: if the user wants products to buy, list concrete products that appear in the results (name, price in ₹ when shown, store, and the product or listing link), grouped into complete looks or options within their budget. Never answer with only videos, reels or style articles. If the results contain no actual products, say so plainly and give the store search link instead. Never claim stock or size availability that the results do not show, and never buy anything.

FORMATTING: This reply is delivered over WhatsApp, which does NOT render markdown. NEVER emit markdown link syntax like [text](url) — write any URL as a bare URL. NEVER invent or output a URL for AskGogo's own product features (connecting Calendar/Gmail, the dashboard, upgrading, magic-link login) — only cite links that appear in the web search results above.

FINANCIAL DATA: Any card point or cashback balance mentioned by the user is SELF-REPORTED and approximate unless explicitly bank-verified via Account Aggregator. When such a figure is used to make or justify a redemption or spending decision, treat it as user-entered and not confirmed, and suggest linking cards via Account Aggregator in the CreditIQ app for exact, bank-confirmed balances before deciding. Never present a self-reported balance as a confirmed, spendable fact when advising on a redemption or purchase. For a casual mention with no spending decision, a light "(self-reported)" note is enough.`

  try{
    const response = await client.messages.create({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages:[{role:'user',content:prompt}],
    })
    return response.content[0].type === 'text' ? response.content[0].text : ''
  }catch(error:any){
    console.error('ANTHROPIC_CONTEXT_FAILED_FALLING_BACK:',providerErrorSummary(error))
    return await askOpenAiFallback({messages:[{role:'user',content:prompt}],maxTokens:1500})
  }
}
