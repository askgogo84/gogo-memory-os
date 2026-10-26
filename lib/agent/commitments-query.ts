// "Who promised to send the proposal?" (Perisclaw-style relationship/commitment memory, 27 Oct).
// Answers from the person's own open loops (agent_open_loops): promises seen in email threads ("I'll send…"),
// replies they are waiting on, and asks they owe. Every answer names the person, the thread subject, the date
// and a link to the source thread. Nothing is inferred from a model; no match is said plainly.
import type { AgentActor } from './actor'

/** Cheap gate for routes: only these phrasings load this module. */
export const WHO_PROMISED_GATE = /\b(?:who\s+(?:promised|said\s+(?:they|he|she)(?:'d|\s+would|\s+will)|owes\s+me|was\s+(?:going|supposed)\s+to)|what\s+(?:did|has)\s+[a-z][\w.'-]*(?:\s+[a-z][\w.'-]*)?\s+promise|(?:what|anything)\s+(?:am\s+i|i'?m)\s+(?:still\s+)?waiting\s+(?:on|for)\s+from\s+[a-z])/i

export type WhoPromisedQuery = { person: string | null; thing: string | null }

const STOP = new Set(['the', 'a', 'an', 'to', 'me', 'my', 'us', 'our', 'it', 'that', 'this', 'send', 'share', 'give', 'get', 'do', 'deliver', 'over', 'back', 'with'])

export function parseWhoPromisedQuery(text: string): WhoPromisedQuery | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '')
  if (!WHO_PROMISED_GATE.test(t)) return null
  let m = t.match(/^(?:who|which\s+person)\s+(?:promised|said\s+(?:they|he|she)(?:'d|\s+would|\s+will)|was\s+(?:going|supposed)\s+to)\s+(?:to\s+)?(.{2,120})$/i)
  if (m) return { person: null, thing: thingOf(m[1]) }
  m = t.match(/^who\s+owes\s+me\s+(.{2,120})$/i)
  if (m) return { person: null, thing: thingOf(m[1]) }
  m = t.match(/^what\s+(?:did|has)\s+([a-z][\w.'-]*(?:\s+[a-z][\w.'-]*)?)\s+promise(?:d)?(?:\s+(?:me|us))?(?:\s+(?:to\s+)?(.{2,120}))?$/i)
  if (m) return { person: m[1].trim(), thing: m[2] ? thingOf(m[2]) : null }
  m = t.match(/(?:what|anything)\s+(?:am\s+i|i'?m)\s+(?:still\s+)?waiting\s+(?:on|for)\s+from\s+([a-z][\w.'-]*(?:\s+[a-z][\w.'-]*)?)$/i)
  if (m) return { person: m[1].trim(), thing: null }
  return null
}

function thingOf(raw: string) {
  const words = (raw.toLowerCase().match(/[a-z0-9]+/g) || [] as string[]).filter((w: string) => !STOP.has(w))
  return words.length ? words.join(' ') : null
}

const tokens = (s: string) => (String(s || '').toLowerCase().match(/[a-z0-9]+/g) || [] as string[]).filter((w: string) => w.length > 2 && !STOP.has(w))
const stem = (w: string) => w.replace(/(?:ies|es|s)$/, '')

/** Score an open loop against the question; 0 means it does not answer it. Pure, exported for tests. */
export function commitmentMatches(loop: { kind?: string; title?: string; summary?: string; evidence_json?: any }, q: WhoPromisedQuery): number {
  if (!['waiting_on', 'commitment', 'followup', 'meeting_action'].includes(String(loop.kind || ''))) return 0
  const hay = `${loop.title || ''} ${loop.summary || ''} ${loop.evidence_json?.last_message_from || ''}`.toLowerCase()
  const words = new Set(tokens(hay).map(stem))
  let score = 1
  if (q.person) {
    const p = tokens(q.person).map(stem)
    if (!p.length || !p.every(w => words.has(w))) return 0
    score += 2
  }
  if (q.thing) {
    const th = tokens(q.thing).map(stem)
    const hit = th.filter(w => words.has(w)).length
    if (!hit) return 0
    score += hit / th.length
  }
  // A promise they made to the person ranks above a reply they owe.
  if (loop.kind === 'waiting_on') score += 0.5
  return score
}

function gmailLink(threadId: string) {
  return /^[0-9a-f]{10,24}$/i.test(threadId) ? `https://mail.google.com/mail/u/0/#all/${threadId}` : ''
}

export async function handleWhoPromisedQuery(params: { actor: AgentActor; text: string }) {
  const q = parseWhoPromisedQuery(params.text)
  if (!q) return null
  // 27 Oct live: going through listOpenLoops re-synced Gmail first and the answer took ~60 s. Open loops are kept fresh
  // by the scout pass, so read the stored active rows directly (owner-scoped).
  const { supabaseAdmin: db } = await import('@/lib/supabase-admin')
  const { data: rows, error } = await db.from('agent_open_loops')
    .select('id,kind,title,summary,priority,due_at,source_type,source_id,evidence_json,last_seen_at,updated_at')
    .eq('telegram_id', String(params.actor.legacyTelegramId)).eq('status', 'active')
    .in('kind', ['waiting_on', 'commitment', 'followup', 'meeting_action'])
    .order('updated_at', { ascending: false }).limit(80)
  if (error) throw new Error('who_promised_read_failed')
  const loops = rows || []
  const ranked = (loops || []).map((loop: any) => ({ loop, score: commitmentMatches(loop, q) })).filter(r => r.score > 0).sort((a, b) => b.score - a.score).slice(0, 5)
  const about = [q.person ? `from ${q.person}` : '', q.thing ? `about “${q.thing}”` : ''].filter(Boolean).join(' ')
  if (!ranked.length) {
    return { runId: 'who-promised-none', status: 'completed' as const, capability: 'orchestrator' as const, risk: 'low' as const, handledBy: 'who-promised',
      text: `I couldn't find an open promise ${about || 'like that'} in your email threads. I track emails where someone said they'll send or share something, replies you're waiting on, and asks you owe. If it was on a call or in another chat, tell me and I'll keep track of it.` }
  }
  const lines = ranked.map(({ loop }, i) => {
    const from = String(loop.evidence_json?.last_message_from || '').replace(/<[^>]+>/, '').replace(/"/g, '').trim()
    const when = Date.parse(String(loop.evidence_json?.last_internal_date ? Number(loop.evidence_json.last_internal_date) : loop.last_seen_at || loop.updated_at || ''))
    const date = Number.isFinite(when) ? new Date(when).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }) : ''
    const role = loop.kind === 'waiting_on' ? (loop.evidence_json?.direction === 'outbound_waiting' ? 'You are waiting for their reply' : 'They said they would follow up') : loop.kind === 'commitment' ? 'They asked you for this' : 'Follow-up'
    const quote = String(loop.summary || '').replace(/\s+/g, ' ').trim().slice(0, 200)
    const link = loop.source_type === 'gmail_thread' ? gmailLink(String(loop.source_id || '')) : ''
    return `${i + 1}. *${String(loop.title || '').slice(0, 150)}*\n   ${role}${from ? ` · ${from}` : ''}${date ? ` · ${date}` : ''}${quote ? `\n   “${quote}”` : ''}${link ? `\n   ${link}` : ''}`
  })
  // Same numbered-list snapshot as "what am I waiting on", so "draft follow-up for 2" acts on these rows.
  try {
    const { supabaseAdmin } = await import('@/lib/supabase-admin')
    await supabaseAdmin.from('agent_activity').insert({ telegram_id: String(params.actor.legacyTelegramId), event_type: 'open_loops_list_shown',
      message: 'Gogo showed promises matching a question.', metadata_json: { open_loop_ids: ranked.map(r => String(r.loop.id)), source: 'who_promised' } })
  } catch {}
  return { runId: 'who-promised', status: 'completed' as const, capability: 'orchestrator' as const, risk: 'low' as const, handledBy: 'who-promised',
    text: `${ranked.length === 1 ? 'Here’s the promise' : 'Here’s what I found'} ${about}:\n\n${lines.join('\n\n')}\n\nSay *draft follow-up for 1* and I'll write a nudge for you to approve.` }
}
