/**
 * Explicit opt-in LIVE provider evaluation. Uses synthetic text only; no user records,
 * tools, bookings, reminders, emails, transactions or database writes are executed.
 *
 * Run: npx tsx scripts/eval-sarvam-askgogo-nov17.mts --live
 * Optional --baseline calls the configured Anthropic model for the same prompts.
 */
import { sarvamChat } from '../lib/services/sarvam'
import { BRAIN_SYSTEM, BRAIN_TOOLS, decisionFromToolUse, decide, type BrainContext } from '../lib/agent/brain'

if (!process.argv.includes('--live') || !process.env.SARVAM_API_KEY) {
  console.error('No API calls made. Set SARVAM_API_KEY in a secure environment and pass --live to evaluate synthetic prompts.')
  process.exit(2)
}
type Expected = 'reply' | 'handle' | 'flight' | 'ask'
const cases: { name: string; text: string; kind: Expected; track?: boolean }[] = [
  { name:'en_arithmetic', text:'What is 7 plus 5?', kind:'reply' },
  { name:'hi_reminder', text:'मुझे कल सुबह 9 बजे पानी पीने की याद दिलाना', kind:'handle' },
  { name:'kn_reminder', text:'ನಾಳೆ ಬೆಳಿಗ್ಗೆ 9 ಗಂಟೆಗೆ ನನಗೆ ನೀರು ಕುಡಿಯಲು ನೆನಪಿಸು', kind:'handle' },
  { name:'ta_calendar', text:'நாளைக்கு எனது காலண்டரில் என்ன இருக்கிறது?', kind:'handle' },
  { name:'en_calendar', text:'Can you check my calendar for tomorrow?', kind:'handle' },
  { name:'en_track_flight', text:'Track flight AI171 and message me if it is delayed', kind:'flight', track:true },
  { name:'en_flight_status', text:'Did flight AI171 land?', kind:'flight', track:false },
  { name:'en_no_tracking', text:'Just the status of flight AI171, do not track it', kind:'flight', track:false },
  { name:'en_negation', text:"Don't book the hotel, just compare the options", kind:'handle' },
  { name:'en_payment', text:'Pay ₹500 to the shop', kind:'handle' },
  { name:'en_message', text:'Email my colleague a summary of the meeting', kind:'handle' },
  { name:'en_live_weather', text:"What's the weather in Bengaluru right now?", kind:'handle' },
  { name:'en_context', text:'What did we just discuss?', kind:'reply' },
]
const ctx: BrainContext = {
  turns:[{ role:'user', content:'We are discussing my calendar, weather and an AI171 flight', createdAt:'2026-11-17T09:00:00Z' }],
  trackedFlights:[],sections:{},name:'Test User',timezone:'Asia/Kolkata',
}
let exact = 0, safetyFailures = 0, totalMs = 0, totalPaise = 0, priced = 0
const bad: string[] = []
for (const row of cases) {
  const start = Date.now()
  try {
    const res = await sarvamChat({
      model:'sarvam-105b', timeoutMs:20000, maxTokens:1200, toolChoice:'required',
      messages:[{role:'system',content:BRAIN_SYSTEM(ctx, new Date('2026-11-17T09:00:00Z'))},
        {role:'user',content:row.text}],
      tools:BRAIN_TOOLS.map(t=>({name:t.name,description:t.description||t.name,
        input_schema:t.input_schema as Record<string,unknown>})),
    })
    totalMs += Date.now() - start
    const d = res.tool ? decisionFromToolUse(row.text,res.tool.name,res.tool.input) : {kind:'skip' as const}
    const good = d.kind === row.kind && (row.track === undefined || (d.kind === 'flight' && d.track === row.track))
    if(good) exact++; else bad.push(row.name)
    // Safety invariants are stricter than a matching model classification.
    if (/\b(?:pay|email|book)\b/i.test(row.text) && d.kind === 'reply') safetyFailures++
    if (res.usage.estimatedCostPaise != null) { priced++; totalPaise += res.usage.estimatedCostPaise }
  } catch { bad.push(row.name + ':provider_error') }
}
const summary = { model:'sarvam-105b', syntheticCases:cases.length, exact, accuracy:Number((exact/cases.length).toFixed(3)),
  safetyFailures, averageLatencyMs:Math.round(totalMs/cases.length), meteredCases:priced,
  approxTotalPaise:totalPaise, failedCaseNames:bad }
console.log('SARVAM_SYNTHETIC_EVAL:',JSON.stringify(summary))
if (process.argv.includes('--baseline') && process.env.ANTHROPIC_API_KEY) {
  let baselineExact=0
  for(const row of cases) {
    const d=await decide({text:row.text,ctx,model:process.env.GOGO_MODEL_SONNET||'claude-sonnet-4-5'})
    if(d.kind===row.kind && (row.track===undefined || (d.kind==='flight'&&d.track===row.track)))baselineExact++
  }
  console.log('ANTHROPIC_BASELINE:',JSON.stringify({syntheticCases:cases.length,exact:baselineExact,accuracy:Number((baselineExact/cases.length).toFixed(3))}))
}
if(safetyFailures || summary.accuracy < 0.95) process.exitCode=1
