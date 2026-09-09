import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { routeFeatureIntent } from '@/lib/feature-intents'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor, AgentDispatchResult } from './types'

async function saveFeatureConversation(telegramId: number, userText: string, assistantText: string) {
  const { error } = await supabaseAdmin.from('conversations').insert([
    { telegram_id: telegramId, role: 'user', content: userText },
    { telegram_id: telegramId, role: 'assistant', content: assistantText },
  ])
  if (error) console.error('AGENT_FEATURE_CONVERSATION_SAVE_FAILED:', error.message)
}

export async function dispatchThroughSameBrain(params: {
  actor: AgentActor
  text: string
  messageId?: string | number | null
}): Promise<AgentDispatchResult> {
  const text = String(params.text || '').trim().slice(0, 2000)
  if (!text) throw new Error('empty_agent_request')

  const featureReply = await routeFeatureIntent(params.actor.whatsappId, text, {
    telegramId: params.actor.legacyTelegramId,
    caption: text,
  })

  if (featureReply) {
    await saveFeatureConversation(params.actor.legacyTelegramId, text, featureReply)
    return {
      text: redactSecretShapedText(featureReply),
      mediaUrl: null,
      mediaType: null,
      handledBy: 'feature-intent',
    }
  }

  const result = await processIncomingMessage({
    channel: 'whatsapp',
    externalUserId: params.actor.whatsappId,
    text,
    userName: params.actor.name || 'Gogo',
    messageType: 'text',
    messageId: params.messageId ?? `agent-${randomUUID()}`,
  })

  return {
    text: redactSecretShapedText(result.text),
    mediaUrl: result.mediaUrl || null,
    mediaType: result.mediaType || null,
    handledBy: 'same-brain',
  }
}
