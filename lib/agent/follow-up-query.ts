// Follow-up questions for web lookups (23 Oct live, the "context memory" failures):
//   "Suggest 3 South Indian restaurants in Rajajinagar" → "which of those is open late?" searched the web for
//   "open late" and answered about Delhi bars. "Who is the CEO of Zomato?" → "how old is he?" lost the person.
// A web search sees only the words it is given, so a follow-up is rewritten into one standalone search query
// from the last few turns BEFORE searching. Only the search query changes: the user's text, approvals and
// stored records are never touched.
import Anthropic from '@anthropic-ai/sdk'

export type Turn = { role: 'user' | 'assistant'; content: string }

const ANAPHORA = /\b(?:those|these|them|they|their|theirs|that one|this one|that|this|it|its|he|him|his|she|her|hers|which one|which of|the (?:first|second|third|last|other|cheaper|cheapest|better|best) one|same)\b/i
const ELLIPTIC_LEAD = /^(?:and|also|ok(?:ay)?(?: and)?|what about|how about|and what about|vs\.?|versus|or|then)\b/i

/** True for a short question that leans on the previous turn ("which of those…", "and on Flipkart?", "how old is he?"). */
export function isFollowUpQuery(text: string): boolean {
  const t = String(text || '').trim()
  if (!t || t.length > 140) return false
  const words = t.split(/\s+/).length
  if (ELLIPTIC_LEAD.test(t) && words <= 10) return true
  return ANAPHORA.test(t) && words <= 14
}

function recent(history: Turn[], currentText: string): Turn[] {
  const turns = history.filter(t => t && (t.role === 'user' || t.role === 'assistant') && String(t.content || '').trim())
  // The current message may already be saved as the newest user turn.
  const last = turns[turns.length - 1]
  const trimmed = last && last.role === 'user' && last.content.trim() === currentText.trim() ? turns.slice(0, -1) : turns
  return trimmed.slice(-4)
}

/** Deterministic fallback: the previous user question carries the subject. */
export function fallbackStandaloneQuery(text: string, history: Turn[]): string {
  const prevUser = [...recent(history, text)].reverse().find(t => t.role === 'user')
  if (!prevUser) return text
  return `${prevUser.content.trim().replace(/[?.!]+$/, '')}. ${text.trim()}`.slice(0, 300)
}

type Rewriter = (prompt: string) => Promise<string>

const defaultRewriter: Rewriter = async prompt => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('no_model')
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const res = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 80, temperature: 0, messages: [{ role: 'user', content: prompt }] }, { timeout: 3500 })
  return (res.content.find((b: any) => b.type === 'text') as any)?.text || ''
}

/** Returns the query to SEARCH with. Unchanged when the text is not a follow-up or there is no history. */
export async function standaloneSearchQuery(text: string, history: Turn[], rewrite: Rewriter = defaultRewriter): Promise<string> {
  if (!isFollowUpQuery(text)) return text
  const turns = recent(history, text)
  if (!turns.length) return text
  const convo = turns.map(t => `${t.role === 'user' ? 'User' : 'Assistant'}: ${String(t.content).replace(/\s+/g, ' ').slice(0, 700)}`).join('\n')
  const prompt = `Rewrite the user's last message as ONE standalone web search query that keeps every name, place, product and list item it refers to from the conversation. Reply with the query only, no quotes, max 25 words.\n\n${convo}\nUser (last message): ${text}`
  try {
    const out = (await rewrite(prompt)).trim().split('\n')[0].replace(/^["'`]|["'`]$/g, '').trim()
    if (out && out.length >= 4 && out.length <= 300 && !/^(?:i |sorry|i'm)/i.test(out)) return out
  } catch {}
  return fallbackStandaloneQuery(text, history)
}
