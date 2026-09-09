import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { routeFeatureIntent } from '@/lib/feature-intents'
import { processIncomingMessage } from '@/lib/bot/process-message'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import type { AgentActor } from './actor'

export type SameBrainResult = {
  text: string
  mediaUrl?: string | null
  mediaType?: string | null
  handledBy: 'feature-intent' | 'same-brain'
}

async function saveFeatureConversation(telegramId: number, userText: string, assistantText: string) {
  const { error } = await supabaseAdmin.from('conversations').insert([
    { telegram_id: telegramId, role: 'user', content: userText },
    { telegram_id: telegramId, role: 'assistant', content: assistantText },
  ])
  if (error) console.error('AGENT_FEATURE_CONVERSATION_SAVE_FAILED:', error.message)
}

/**
 * App requests use the exact same feature router and production message engine
 * that WhatsApp uses. This is the key same-brain boundary: no native-only
 * reminder/list/calendar implementation and no second memory silo.
 */
export async function dispatchThroughSameBrain(params: {
  actor: AgentActor
  text: string
  messageId?: string | number | null
}): Promise<SameBrainResult> {
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
    messageId: params.messageId ?? `native-${randomUUID()}`,
  })

  return {
    text: redactSecretShapedText(result.text),
    mediaUrl: result.mediaUrl || null,
    mediaType: result.mediaType || null,
    handledBy: 'same-brain',
  }
}
