import {parsePriceComparison} from '@/lib/commerce/comparison-model'
import {detectFriendReminder} from '@/lib/bot/handlers/friend-reminders'

export type CompoundShoppingFriendStep = {kind: 'price' | 'friend'; text: string}

/** Split only independently recognisable requests; leave prose and partial lines alone. */
export function splitCompoundShoppingFriendRequests(text: string): CompoundShoppingFriendStep[] | null {
  if (!/\r?\n/.test(text)) return null
  const lines = text.split(/\r?\n/).map(line => line.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim()).filter(Boolean)
  if (lines.length < 2 || lines.length > 4) return null

  const steps: CompoundShoppingFriendStep[] = []
  for (const line of lines) {
    if (parsePriceComparison(line)) steps.push({kind: 'price', text: line})
    else if (detectFriendReminder(line)) steps.push({kind: 'friend', text: line})
    else return null
  }
  return steps
}

export async function runCompoundShoppingFriendRequests(text: string, handlers: {
  checkPrice: (step: string) => Promise<string>
  prepareFriend: (step: string, index: number) => Promise<string>
  onError: (error: unknown, kind: CompoundShoppingFriendStep['kind'], index: number) => void
}): Promise<string[] | null> {
  const steps = splitCompoundShoppingFriendRequests(text)
  if (!steps) return null
  const replies: string[] = []
  for (const [index, step] of steps.entries()) {
    try {
      replies.push(step.kind === 'price'
        ? await handlers.checkPrice(step.text)
        : await handlers.prepareFriend(step.text, index))
    } catch (error) {
      handlers.onError(error, step.kind, index)
      replies.push(step.kind === 'price'
        ? `I couldn't start the store check for: ${step.text}. Please resend that request separately.`
        : `I couldn't set up the reminder for: ${step.text}. Please resend that request separately.`)
    }
  }
  return replies
}
