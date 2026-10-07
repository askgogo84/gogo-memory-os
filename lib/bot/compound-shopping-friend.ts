import {parsePriceComparison} from '@/lib/commerce/comparison-model'
import {detectFriendReminder} from '@/lib/bot/handlers/friend-reminders'
import {isReminderReadQuery} from '@/lib/agent/compound-planner'

export type CompoundShoppingFriendStep = {kind: 'price' | 'friend' | 'reminder_read'; text: string; constraints?: string[]}

/** Split only independently recognisable requests; leave prose and partial lines alone. */
export function splitCompoundShoppingFriendRequests(text: string): CompoundShoppingFriendStep[] | null {
  if (!/\r?\n/.test(text)) return null
  const lines = text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean)
  if (lines.length < 2 || lines.length > 8) return null

  const steps: CompoundShoppingFriendStep[] = []
  const constraints: string[] = []
  for (const line of lines) {
    // Constraints apply to every request; they are not another task. Recognise
    // only complete supported restrictions, never discard an unknown clause.
    if (/^(?:do not|don't|never)\s+(?:buy(?:\s+anything)?(?:\s+(?:or|and)\s+create\s+(?:any\s+)?new\s+reminders?)?|create\s+(?:any\s+)?new\s+reminders?)[.!?]*$/i.test(line)) constraints.push(line)
    else if (parsePriceComparison(line)) steps.push({kind: 'price', text: line})
    else if (isReminderReadQuery(line)) steps.push({kind: 'reminder_read', text: line})
    else if (detectFriendReminder(line)) steps.push({kind: 'friend', text: line})
    else return null
  }
  if (steps.length < 2 || steps.length > 4) return null
  return constraints.length ? steps.map(step => ({...step, constraints})) : steps
}

export async function runCompoundShoppingFriendRequests(text: string, handlers: {
  checkPrice: (step: string) => Promise<string>
  prepareFriend: (step: string, index: number) => Promise<string>
  readReminders: (step: string, index: number) => Promise<string>
  onError: (error: unknown, kind: CompoundShoppingFriendStep['kind'], index: number) => void
}): Promise<string[] | null> {
  const steps = splitCompoundShoppingFriendRequests(text)
  if (!steps) return null
  const replies: string[] = []
  for (const [index, step] of steps.entries()) {
    try {
      if (step.kind === 'friend' && step.constraints?.some(line => /\bcreate\s+(?:any\s+)?new\s+reminders?\b/i.test(line))) {
        replies.push(`I did not create the reminder for: ${step.text}. Your instruction says not to create new reminders.`)
      } else if (step.kind === 'price') {
        replies.push(await handlers.checkPrice([step.text, ...(step.constraints || [])].join('\n')))
      } else if (step.kind === 'reminder_read') {
        replies.push(await handlers.readReminders(step.text, index))
      } else replies.push(await handlers.prepareFriend(step.text, index))
    } catch (error) {
      handlers.onError(error, step.kind, index)
      replies.push(step.kind === 'price'
        ? `I couldn't start the store check for: ${step.text}. Please resend that request separately.`
        : step.kind === 'reminder_read'
          ? `I couldn't read your reminders. Please resend that request separately.`
          : `I couldn't set up the reminder for: ${step.text}. Please resend that request separately.`)
    }
  }
  return replies
}
