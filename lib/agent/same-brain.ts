import { randomUUID } from 'crypto'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { routeFeatureIntent as routeLegacyFeatureIntent } from '@/lib/feature-intents-legacy'
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
 * Planner steps use the mature deterministic feature layer directly, followed by
 * the normal message engine. They deliberately DO NOT call the Agent-enhanced
 * routeFeatureIntent wrapper because that wrapper can start a new Agent mission;
 * allowing a plan step to invoke it would create planner → router → planner
 * recursion and split one user outcome into nested runs.
 */
export async function dispatchThroughSameBrain(params: {
  actor: AgentActor
  text: string
  messageId?: string | number | null
}): Promise<SameBrainResult> {
  const text = String(params.text || '').trim().slice(0, 2000)
  if (!text) throw new Error('empty_agent_request')

  const featureReply = await routeLegacyFeatureIntent(params.actor.whatsappId, text, {
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
    messageId: params.messageId ?? `agent-step-${randomUUID()}`,
  })

  return {
    text: redactSecretShapedText(result.text),
    mediaUrl: result.mediaUrl || null,
    mediaType: result.mediaType || null,
    handledBy: 'same-brain',
  }
}
