// Chat entry for procedures that are not read-only. Only for owners in GOGO_PROCEDURES_OWNERS / GOGO_PROCEDURES=1.
// "follow up with Nithin on the Harbor deck" → email.follow_up. The run reads the thread, drafts a short follow-up and
// stops at an approval card; nothing is sent until the owner approves that exact message.
import type { AgentActor } from '@/lib/agent/actor'

export function parseFollowUpAsk(text: string): { target: string } | null {
  const t = String(text || '').trim().replace(/[.!?]+$/, '')
  const m = t.match(/^(?:please\s+)?(?:send\s+(?:a\s+)?)?follow[\s-]?up\s+(?:email\s+)?(?:with|to|on)\s+(.{2,120})$/i)
  if (!m) return null
  const target = m[1].replace(/^(?:my\s+)?(?:last\s+|latest\s+)?(?:email|mail)\s+(?:from|with|to)\s+/i, '').trim()
  return target.length >= 2 ? { target } : null
}

export async function tryProcedureAsk(actor: AgentActor, text: string): Promise<string | null> {
  const ask = parseFollowUpAsk(text)
  if (!ask) return null
  const { proceduresEnabledFor } = await import('./registry')
  if (!proceduresEnabledFor(String(actor.legacyTelegramId))) return null
  try {
    const { startProcedureRun } = await import('./runtime')
    const r = await startProcedureRun({ actor, procedureId: 'email.follow_up', inputs: { target: ask.target }, objective: text.slice(0, 200), source: 'chat-follow-up' })
    if (!r) return null
    console.log('PROCEDURE_FOLLOW_UP:', JSON.stringify({ runId: r.runId, status: r.status }))
    if (r.status === 'waiting_approval') return `I've drafted a follow-up in that thread. Review it in the card below; nothing is sent until you approve it.`
    if (r.status === 'completed') return `You were the last to write in that thread, so there's nothing to follow up yet.`
    return `I couldn't prepare that follow-up (${r.status}). Nothing was sent.`
  } catch (e: any) {
    console.error('PROCEDURE_FOLLOW_UP_FAILED:', String(e?.message || e).slice(0, 160))
    return null
  }
}
