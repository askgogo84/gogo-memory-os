// "Plan my day tomorrow" (24 Oct live): returned the calendar list, not a plan. A plan proposes time blocks around
// the fixed events and reminders, the way a good assistant would. Personal data stays on the primary model.
import Anthropic from '@anthropic-ai/sdk'
import type { AgentActor } from './actor'

export function dayPlanRequest(text: string): 'today' | 'tomorrow' | null {
  const t = String(text || '').toLowerCase().replace(/[?.!]+$/, '').trim()
  const m = t.match(/^(?:please\s+)?(?:can you\s+)?(?:help me\s+)?(?:plan|schedule|organi[sz]e|block out)\s+(?:out\s+)?(?:my\s+)?(day|today|tomorrow|morning|evening)(?:\s+(today|tomorrow))?(?:\s+for me)?$/)
  if (!m) return null
  return m[1] === 'tomorrow' || m[2] === 'tomorrow' ? 'tomorrow' : 'today'
}

type Model = (prompt: string) => Promise<string>
const defaultModel: Model = async prompt => {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no_model')
  const client = new Anthropic({ apiKey: key })
  const res = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 700, temperature: 0.3, messages: [{ role: 'user', content: prompt }] }, { timeout: 20_000 })
  return (res.content.find((b: any) => b.type === 'text') as any)?.text || ''
}

export async function buildDayPlan(actor: AgentActor, which: 'today' | 'tomorrow', deps: { read?: (p: any) => Promise<any>; model?: Model; now?: Date } = {}) {
  const read = deps.read || (await import('./read-only-schedule')).readTomorrowSchedule
  const schedule = await read({ actor, scope: 'agenda', text: `Show my calendar and reminders ${which}` })
  const facts = String(schedule?.text || '').slice(0, 3000)
  if (!facts) return null
  const tz = schedule?.timeZone || actor.timezone || 'Asia/Kolkata'
  const prompt = `Make a realistic time-blocked plan for ${which} from the person's fixed schedule below (timezone ${tz}).
Rules: keep every fixed event and reminder at its exact time; add 2-4 focus or admin blocks in the free gaps, lunch, and a short buffer before meetings; never invent meetings, people or tasks that are not listed; if the schedule is empty, suggest a simple shape for the day and say the calendar is clear. If the schedule says it could not be read, say so and do not plan around guesses.
Format for WhatsApp: first line "🗓️ Your plan for ${which}", then one line per block like "9:00–10:30 · Deep work: <what>", 6-10 lines, plain text, no headings, no italics. End with one line: "Say 'remind me at 9 to start deep work' for any block."

Fixed schedule:
${facts}`
  let body = ''
  try { body = (await (deps.model || defaultModel)(prompt)).trim() } catch {}
  return body || null
}
