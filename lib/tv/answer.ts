import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { resolveAgentActor } from '@/lib/agent/actor'
import { detectReadOnlyScheduleRequest } from '@/lib/agent/read-only-schedule'
import { executeReadOnlyCalendarStep } from '@/lib/agent/calendar-read'
import { askClaude } from '@/lib/services/claude'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { recallableMemoryText } from '@/lib/services/memory-index'
import { sensitiveCategory } from '@/lib/agent/context-graph/recall'

export async function answerTvQuestion(owner: string, name: string | null, question: string) {
  const text = redactSecretShapedText(question)
  const topic = /^(?:what do you remember about|what have i told you about)\s+(.+?)[?.!]*$/i.exec(text)?.[1]
  if (topic) return readSavedFacts(owner, topic)
  const schedule = detectReadOnlyScheduleRequest(text)
  if (schedule) {
    const actor = await resolveAgentActor({ telegramId: owner, surface: 'web' })
    const result = await executeReadOnlyCalendarStep({
      actor, instruction: text, missionText: text, rememberSelection: false,
    })
    return redactSecretShapedText(result.text).slice(0, 2400)
  }

  // Same AskGogo conversational model, with no command executor, tools, saved history or vault access.
  const result = await askClaude(text, [], [], name || 'Gogo', '',
    'This is the shared TV surface. Answer briefly. For account actions or private saved information, direct the user to their phone.')
  if (/^\s*(?:\*{1,2})?(?:REMINDER|MEMORY|LIST_[A-Z]+|SEARCH)\b/im.test(result)) {
    return 'Open AskGogo on your phone for that request.'
  }
  return redactSecretShapedText(result).slice(0, 2400)
}

async function readSavedFacts(owner: string, topic: string) {
  const ownerId = Number(owner)
  if (!Number.isSafeInteger(ownerId) || !ownerId || String(ownerId) !== owner) throw new Error('invalid_tv_owner')
  const terms = topic.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)?.filter(word => !['the', 'and', 'about'].includes(word))
  if (!terms?.length || sensitiveCategory(topic) || !recallableMemoryText(topic))
    return 'Open AskGogo on your phone for that request.'
  const { data, error } = await supabaseAdmin.from('memories').select('content')
    .eq('telegram_id', ownerId).order('created_at', { ascending: false }).limit(100)
  if (error) throw new Error('tv_memory_unavailable')
  const matches = new Set<string>()
  for (const row of data ?? []) {
    if (typeof row.content !== 'string') continue
    const fact = recallableMemoryText(row.content, 'memories')
    if (fact && !sensitiveCategory(fact) && terms.every(term => fact.toLowerCase().includes(term))) {
      matches.add(redactSecretShapedText(fact).slice(0, 300))
      if (matches.size === 5) break
    }
  }
  return matches.size ? Array.from(matches, fact => '• ' + fact).join('\n')
    : 'I found no matching recent saved facts. You can check your full history on your phone.'
}
