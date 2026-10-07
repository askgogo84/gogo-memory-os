import type {AgentActor} from './actor'
import {selectContentWorkflow} from './content-workflows'
import {processIncomingMessage} from '@/lib/bot/process-message'

/** All surfaces use PIM's owner context, limits and conversation persistence. */
export async function tryRunContentWorkflow(actor: AgentActor, text: string, messageId?: string | null) {
  if (!selectContentWorkflow(text)) return null
  const result = await processIncomingMessage({
    channel: actor.whatsappId ? 'whatsapp' : 'telegram',
    externalUserId: actor.whatsappId || String(actor.legacyTelegramId),
    userName: actor.name, text, messageId: messageId || null,
  })
  return {text: result.text, handledBy: 'content-workflow' as const, draftOnly: true}
}
