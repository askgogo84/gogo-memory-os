// Plain inbox questions answered from Gmail (6 Nov live, Duet/Wajo benchmark). "Which emails have waited more than
// 3 days for my reply?", "Any subscriptions renewing soon?" and "Any free trials I forgot?" reached the brain, which
// said "I don't have access to your Gmail" although Gmail was connected. Read-only: nothing is drafted or sent.
import type { AgentActor } from './actor'

const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, a: 1 }

/** "emails waiting for my reply", "haven't replied to", "unreplied emails" → the minimum age in days, or 0. */
export function replyWaitAsk(text: string): { minAgeDays: number } | null {
  const t = String(text || '').toLowerCase().trim()
  if (t.length > 200 || /\b(?:send|draft|write|reply to (?:him|her|them|it)|forward|delete|archive)\b/.test(t.replace(/\b(?:my|a)\s+reply\b/g, ''))) return null
  const mail = /\b(?:e-?mails?|mails?|messages?|inbox|threads?)\b/.test(t)
  const waiting = /\b(?:wait(?:ed|ing)?\b.{0,30}?\b(?:for|on)\s+(?:my|a)\s+(?:reply|response|answer)|(?:need|needs|needing|require|requires)\s+(?:my|a)\s+(?:reply|response)|(?:have\s*n[o']t|havent|did\s*n[o']t|didnt|not\s+yet)\s+(?:i\s+)?(?:replied|responded|answered)|unreplied|unanswered|pending\s+(?:my\s+)?(?:reply|replies|response)|(?:i\s+)?(?:owe|forgot\s+to\s+reply)|to\s+reply\s+to)\b/.test(t)
  if (!mail || !waiting) return null
  const m = t.match(/\b(?:more than|over|at least|older than|for)\s+(\d{1,2}|one|two|three|four|five|six|seven|ten|a)\s+(day|days|week|weeks)\b/)
  const n = m ? (NUM[m[1]] ?? Number(m[1])) * (/week/.test(m[2]) ? 7 : 1) : 0
  // Preserve the user's explicit age; the bounded Gmail reader must not silently rewrite it.
  return { minAgeDays: n }
}

export type BillingAskKind = 'renewals' | 'trials' | 'bills'
/** Subscriptions renewing, free trials, bills or invoices due. */
export function billingAsk(text: string): BillingAskKind | null {
  const t = String(text || '').toLowerCase().trim()
  if (t.length > 200 || /\b(?:cancel|pay|renew it|remind me|set a reminder|book|buy)\b/.test(t)) return null
  if (!/^(?:any|do i|are there|which|what|show|list|find|check|tell me|have i|did i)\b|\?\s*$/.test(t)) return null
  if (/\bfree\s+trials?\b|\btrials?\b.{0,30}\b(?:forgot|ending|end|expir|running)/.test(t)) return 'trials'
  if (/\b(?:subscriptions?|memberships?|plans?)\b.{0,40}\b(?:renew\w*|due|expir\w*|forgot|running|charg\w*|active)\b|\brenew(?:als?|ing)\b|\bforgot(?:ten)?\b.{0,30}\bsubscriptions?\b/.test(t)) return 'renewals'
  if (/\b(?:unpaid|outstanding|pending|due|overdue)\b.{0,30}\b(?:invoices?|bills?|payments?|dues)\b|\b(?:invoices?|bills?)\b.{0,30}\b(?:due|unpaid|pending|outstanding|overdue)\b/.test(t)) return 'bills'
  return null
}

type Mail = { subject: string; from: string; date?: string; snippet?: string; evidence?: string }
const DATE = '(?:\\d{4}-\\d{2}-\\d{2}|\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}|\\d{1,2}\\s+[A-Za-z]{3,9},?\\s+\\d{4}|[A-Za-z]{3,9}\\s+\\d{1,2},?\\s+\\d{4})'

/** Compact lines: who, what, the amount and the date the email itself shows. Nothing guessed. Pure. */
export function formatBilling(kind: BillingAskKind, mails: Mail[], amounts: (s: string) => string[], days: number): string {
  const head = kind === 'trials' ? 'Free trials in your Gmail' : kind === 'bills' ? 'Bills and invoices in your Gmail' : 'Subscriptions and renewals in your Gmail'
  if (!mails.length) return `I checked your Gmail for the last ${days} days and found no ${kind === 'trials' ? 'free-trial' : kind === 'bills' ? 'bill or invoice' : 'subscription or renewal'} emails. This is an email check, not your bank statement.`
  const lines = mails.slice(0, 8).map((m, i) => {
    const ev = String(m.evidence || m.snippet || '')
    const sender = m.from.replace(/\s*<[^>]+>/, '').replace(/^"|"$/g, '').trim() || m.from
    const amount = amounts(ev)[0]
    const when = ev.match(new RegExp(`\\b(?:renew\\w*|expir\\w*|ends?|ending|due|charged?|billed)\\s*(?:on|by|:|date)?\\s*(${DATE})`, 'i'))?.[1]
    const bits = [amount, when ? `${/due/i.test(ev) && kind === 'bills' ? 'due' : kind === 'trials' ? 'ends' : 'date'} ${when}` : null].filter(Boolean)
    return `${i + 1}. *${sender}* · ${m.subject}${bits.length ? `\n   ${bits.join(' · ')}` : ''}`
  })
  return `${head} · last ${days} days\n\n${lines.join('\n')}\n\nFrom the emails themselves; amounts and dates only where the email states them. Ask "remind me to cancel <name> on <date>" and I'll set it.`
}

const notConnected = (code: string) => /workspace_not_connected|workspace_reconnect_required|workspace_scope_required|not_connected/.test(code)

export async function tryEmailAsk(actor: AgentActor, text: string): Promise<{ text: string; handledBy: string } | null> {
  const wait = replyWaitAsk(text)
  if (wait) {
    // The underlying Gmail attention reader examines only the last 14 days. For
    // older-than-window questions, a 14-day search cannot establish an absence;
    // do not silently substitute a different age or claim a Gmail verification.
    if (wait.minAgeDays >= 14) {
      return {
        text: `I can currently check only Gmail threads from the last 14 days for reply requests. You asked about emails waiting ${wait.minAgeDays}+ days, outside that limited scan, so I cannot verify them. I did not read Gmail, send, draft or change anything.`,
        handledBy: 'inbox-reply-read',
      }
    }
    const { handleInboxReplyRead } = await import('./open-loops')
    const out: any = await handleInboxReplyRead({ actor, text: 'which emails need my reply', ...(wait.minAgeDays ? { minAgeDays: wait.minAgeDays } : {}) })
    return out?.text ? { text: out.text, handledBy: 'inbox-reply-read' } : null
  }
  const kind = billingAsk(text)
  if (!kind) return null
  const days = 60
  const g = await import('./google-workspace-read')
  try {
    let mails: Mail[]
    if (kind === 'trials') {
      const found = await g.searchWorkspaceEmailsByQuery(actor, `subject:(trial) newer_than:${days}d -in:spam -in:trash`, 10)
      mails = (found as Mail[]).filter(m => /\btrial\b/i.test(m.subject) && /\b(?:free|ends?|ending|expir|over|last day|left|started|welcome|upgrade)\b/i.test(`${m.subject} ${m.snippet || ''}`))
    } else {
      const res = await g.searchWorkspaceEmails(actor, `audit my gmail emails for subscription receipts and renewal notices in the last ${days} days, at most 20 messages`)
      mails = res.messages as Mail[]
      if (kind === 'bills') mails = mails.filter(m => /\b(?:invoice|bill|due|payment|outstanding|statement)\b/i.test(`${m.subject} ${m.evidence || ''}`))
    }
    console.log('EMAIL_ASK:', JSON.stringify({ kind, found: mails.length }))
    return { text: formatBilling(kind, mails, g.emailBillingAmounts, days), handledBy: 'email-billing-read' }
  } catch (err: any) {
    const code = String(err?.message || err)
    console.error('EMAIL_ASK_FAILED:', code.slice(0, 120))
    if (code.includes('workspace_email_reading_disabled')) return { text: 'Gmail is connected, but email reading is turned off in your privacy setting, so I did not read your mail.', handledBy: 'email-billing-read' }
    if (notConnected(code)) return { text: 'Connect Gmail in Connections and I can check your subscription, trial and bill emails.', handledBy: 'email-billing-read' }
    return { text: "I couldn't read your Gmail just now. Try again in a minute.", handledBy: 'email-billing-read' }
  }
}
