// Chat entry for procedures that are not read-only. Only for owners in GOGO_PROCEDURES_OWNERS / GOGO_PROCEDURES=1.
// "follow up with Nithin on the Harbor deck" → email.follow_up. The run reads the thread, drafts a short follow-up and
// stops at an approval card; nothing is sent until the owner approves that exact message.
import type { AgentActor } from '@/lib/agent/actor'

export function parseFollowUpAsk(text: string): { target: string } | null {
  const t = String(text || '').trim().replace(/[.!?]+$/, '')
  const m = t.match(/^(?:please\s+)?(?:send\s+(?:a\s+)?)?follow[\s-]?up\s+(?:email\s+)?(?:with|to|on)\s+(.{2,120})$/i)
  if (!m) return null
  // "Varun Sharma email on ET awards" / "Varun's mail about the awards" → "Varun Sharma on ET awards": the words
  // email/mail only say what kind of thread it is, they are not part of the name or the subject.
  const target = m[1].replace(/^(?:my\s+)?(?:last\s+|latest\s+)?(?:email|mail)\s+(?:from|with|to)\s+/i, '')
    .replace(/(?:'s)?\s+(?:e-?mail|mail)\s+(?=(?:on|about|re|regarding)\b)/i, ' ').replace(/\s{2,}/g, ' ').trim()
  return target.length >= 2 ? { target } : null
}

export type ProcedureSurface = 'dashboard' | 'whatsapp'
/** Approvals stay on the dashboard card (bound to the exact draft); WhatsApp only starts the run and points there. */
export const PROCEDURE_APPROVAL_URL = 'https://app.askgogo.in/dashboard/today'

export function followUpReply(status: string, surface: ProcedureSurface = 'dashboard', error?: string | null, target?: string): string {
  const who = String(target || '').trim().slice(0, 80) || 'them'
  if (status === 'waiting_approval') return surface === 'whatsapp'
    ? `I've drafted a follow-up in that thread. Review and approve it on your dashboard (Needs you): ${PROCEDURE_APPROVAL_URL}\n\nNothing is sent until you approve that exact message.`
    : `I've drafted a follow-up in that thread. Review it in the card below; nothing is sent until you approve it.`
  if (status === 'completed') return `You were the last to write in that thread, so there's nothing to follow up yet.`
  const e = String(error || '')
  if (/^thread_not_found/.test(e)) return `I couldn't find an email thread with ${who} in the Gmail you connected to AskGogo. Nothing was sent. If that mail went to another address, it isn't connected (ask me: which email am I connected to?). Otherwise tell me the sender's name or a word from the subject as it appears in Gmail.`
  if (/^thread_ambiguous/.test(e)) return `I found more than one email thread matching ${who}. Nothing was sent. Tell me the subject so I pick the right one.`
  if (/^gmail_(?:not_connected|consent_missing)/.test(e)) return `I can't read your Gmail for this yet, so nothing was sent. Connect Gmail and allow reading on your dashboard: https://app.askgogo.in/dashboard`
  if (status === 'outcome_unknown') return `I couldn't confirm what happened with that follow-up. Please check your Sent folder before asking again.`
  if (status === 'running') return `I'm still reading that thread; Gmail didn't answer in time. Nothing has been sent. If a draft is ready it will wait for your approval at ${PROCEDURE_APPROVAL_URL}.`
  return `I couldn't prepare that follow-up. Nothing was sent.`
}

export async function tryProcedureAsk(actor: AgentActor, text: string, surface: ProcedureSurface = 'dashboard'): Promise<string | null> {
  const ask = parseFollowUpAsk(text)
  if (!ask) return null
  const { proceduresEnabledFor } = await import('./registry')
  if (!proceduresEnabledFor(String(actor.legacyTelegramId))) return null
  // 12 Nov: email at 'off' or 'read' means no follow-up draft or send (review: this path was not covered).
  const block = await import('@/lib/agent/adaptive-autonomy').then(m => m.emailDraftBlock(actor.legacyTelegramId)).catch(() => 'error' as const)
  if (block === 'off') return 'Email is currently off in your Gogo autonomy settings, so I have not drafted or sent anything. Say *set email autonomy to draft* to turn it back on.'
  if (block === 'read') return 'Email is set to read-only in your Gogo autonomy settings, so I have not drafted or sent anything. Say *set email autonomy to draft* to allow drafts.'
  if (block === 'error') return 'I couldn’t check your email setting just now, so I have not drafted or sent anything. Please try again in a minute.'
  try {
    const { startProcedureRun } = await import('./runtime')
    const r = await startProcedureRun({ actor, procedureId: 'email.follow_up', inputs: { target: ask.target }, objective: text.slice(0, 200), source: surface === 'whatsapp' ? 'whatsapp-follow-up' : 'chat-follow-up' })
    if (!r) return null
    console.log('PROCEDURE_FOLLOW_UP:', JSON.stringify({ runId: r.runId, status: r.status, error: (r as any).error || null, surface }))
    return followUpReply(r.status, surface, (r as any).error, ask.target)
  } catch (e: any) {
    console.error('PROCEDURE_FOLLOW_UP_FAILED:', String(e?.message || e).slice(0, 160))
    return null
  }
}
