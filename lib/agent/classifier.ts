import type { AgentActionMode, AgentCapability, AgentRiskLevel } from './policy'

export type AgentApprovalAction = 'send_email' | 'submit_form' | 'calendar_change' | 'booking' | 'purchase' | 'share'

export type ClassifiedAgentRequest = {
  capability: AgentCapability
  mode: AgentActionMode
  risk: AgentRiskLevel
  irreversible: boolean
  approvalAction?: AgentApprovalAction
  title: string
  why: string
}

function includesAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term))
}

function cleanTitle(text: string) {
  const value = text.replace(/\s+/g, ' ').trim()
  return value.length <= 90 ? value : `${value.slice(0, 87)}...`
}

/**
 * Deterministic first-pass classifier. It deliberately errs toward asking for
 * approval when an action may create an external consequence. The language
 * model never gets to downgrade its own risk level.
 */
export function classifyAgentRequest(rawText: string): ClassifiedAgentRequest {
  const text = String(rawText || '').trim()
  const t = text.toLowerCase()
  const title = cleanTitle(text) || 'AskGogo action'

  if (includesAny(t, ['pay ', 'payment', 'purchase', 'buy ', 'checkout', 'subscribe', 'renew subscription'])) {
    return { capability: 'payments', mode: 'execute', risk: 'high', irreversible: true, approvalAction: 'purchase', title, why: 'This may spend money or change a paid subscription.' }
  }

  if (includesAny(t, ['send email', 'send mail', 'email ', 'mail ', 'reply to email', 'reply to mail'])) {
    const send = includesAny(t, ['send ', 'reply ', 'email him', 'email her', 'email them'])
    return send
      ? { capability: 'email', mode: 'execute', risk: 'high', irreversible: true, approvalAction: 'send_email', title, why: 'This may send an external message.' }
      : { capability: 'email', mode: 'read', risk: 'low', irreversible: false, title, why: 'This only reads or summarizes connected email.' }
  }

  if (includesAny(t, ['submit form', 'apply for', 'submit application', 'fill and submit', 'send application'])) {
    return { capability: 'browser', mode: 'execute', risk: 'high', irreversible: true, approvalAction: 'submit_form', title, why: 'This may submit information to an external website.' }
  }

  if (includesAny(t, ['book flight', 'book hotel', 'book ticket', 'make booking', 'reserve hotel'])) {
    return { capability: 'travel', mode: 'execute', risk: 'high', irreversible: true, approvalAction: 'booking', title, why: 'This may create a travel booking or financial commitment.' }
  }

  if (includesAny(t, ['calendar', 'meeting', 'event', 'appointment', 'reschedule', 'move meeting', 'cancel meeting'])) {
    const mutation = includesAny(t, ['create', 'add ', 'move ', 'reschedule', 'change ', 'cancel ', 'delete ', 'invite'])
    if (mutation) {
      return { capability: 'calendar', mode: 'execute', risk: includesAny(t, ['cancel ', 'delete ']) ? 'high' : 'medium', irreversible: includesAny(t, ['cancel ', 'delete ']), approvalAction: 'calendar_change', title, why: 'This changes your calendar or another participant’s schedule.' }
    }
    return { capability: 'calendar', mode: 'read', risk: 'low', irreversible: false, title, why: 'This only reads connected calendar context.' }
  }

  if (includesAny(t, ['remind', 'reminder', 'snooze', 'wake me', 'alert me'])) {
    return { capability: 'reminders', mode: 'execute', risk: 'low', irreversible: false, title, why: 'Creating or moving a reminder is reversible and private to your AskGogo account.' }
  }

  if (includesAny(t, ['list', 'grocer', 'shopping list', 'packing'])) {
    const destructive = includesAny(t, ['delete list', 'clear list', 'remove all'])
    return { capability: 'lists', mode: destructive ? 'execute' : includesAny(t, ['show ', 'view ', 'what is', 'what\'s']) ? 'read' : 'execute', risk: destructive ? 'medium' : 'low', irreversible: destructive, title, why: destructive ? 'This removes saved list data.' : 'List changes are normally reversible and private.' }
  }

  if (includesAny(t, ['task', 'todo', 'to-do'])) {
    const destructive = includesAny(t, ['delete task', 'clear task', 'remove all'])
    return { capability: 'tasks', mode: destructive ? 'execute' : includesAny(t, ['show ', 'view ', 'my tasks']) ? 'read' : 'execute', risk: destructive ? 'medium' : 'low', irreversible: destructive, title, why: destructive ? 'This removes saved task data.' : 'Task changes are normally reversible and private.' }
  }

  if (includesAny(t, ['passport', 'document', 'pdf', 'file', 'scan'])) {
    const write = includesAny(t, ['save ', 'remember ', 'store ', 'upload '])
    return { capability: 'files', mode: write ? 'execute' : 'read', risk: 'low', irreversible: false, title, why: write ? 'This saves a private file or document reference.' : 'This only reads your connected files/documents.' }
  }

  if (includesAny(t, ['contact', 'phone number', 'email address'])) {
    return { capability: 'contacts', mode: 'read', risk: 'low', irreversible: false, title, why: 'This reads your saved contact context.' }
  }

  if (includesAny(t, ['flight', 'hotel', 'trip', 'travel', 'itinerary', 'pnr', 'boarding pass'])) {
    return { capability: 'travel', mode: 'read', risk: 'low', irreversible: false, title, why: 'This reads or organizes your travel context without booking.' }
  }

  if (includesAny(t, ['share ', 'send this to', 'share with'])) {
    return { capability: 'memory', mode: 'execute', risk: 'high', irreversible: true, approvalAction: 'share', title, why: 'This may expose private AskGogo context to another person.' }
  }

  if (includesAny(t, ['delete memory', 'forget everything', 'delete everything', 'erase memory'])) {
    return { capability: 'memory', mode: 'execute', risk: 'high', irreversible: true, title, why: 'This may permanently remove stored memory.' }
  }

  if (includesAny(t, ['remember ', 'save this', 'save that', 'keep this'])) {
    return { capability: 'memory', mode: 'execute', risk: 'low', irreversible: false, title, why: 'This saves private context to your AskGogo memory.' }
  }

  return { capability: 'memory', mode: 'read', risk: 'low', irreversible: false, title, why: 'This is a read-only AskGogo memory/context request.' }
}
