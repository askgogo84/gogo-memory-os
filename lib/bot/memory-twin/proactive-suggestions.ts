import { loadMemoryTwinContext } from './context-loader'

export async function buildProactiveSuggestion(params: {
  telegramId: number
  userText: string
}) {
  const context = await loadMemoryTwinContext(params.telegramId)
  const lower = (params.userText || '').toLowerCase()

  if (!context.memoryEnabled || !context.proactiveSuggestionsEnabled || !context.profile) return ''

  const commonTimes = Array.isArray(context.profile.common_times)
    ? context.profile.common_times.filter((x:any)=>Number(x?.count||0)>=3)
    : []
  const frequentContacts = Array.isArray(context.profile.frequent_contacts)
    ? context.profile.frequent_contacts.filter((x:any)=>Number(x?.count||0)>=3)
    : []
  const frequentTasks = Array.isArray(context.profile.frequent_tasks)
    ? context.profile.frequent_tasks.filter((x:any)=>Number(x?.count||0)>=3)
    : []

  if (
    /\bremind|reminder|call|follow/i.test(lower) &&
    commonTimes.length > 0 &&
    !/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(lower)
  ) {
    return `\n\n💡 You often set reminders around ${commonTimes[0].value}. Want me to use that time?`
  }

  if (/\bfollow/i.test(lower) && frequentContacts.length > 0) {
    return `\n\n💡 You often mention ${frequentContacts[0].value}. Should I include them in this follow-up?`
  }

  if (/\btoday|briefing|plan my day/i.test(lower) && frequentTasks.length > 0) {
    return `\n\n💡 You often work on ${frequentTasks[0].value} tasks. I can include those in your day plan.`
  }

  return ''
}
