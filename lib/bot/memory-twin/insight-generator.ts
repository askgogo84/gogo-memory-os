import { supabaseAdmin } from '@/lib/supabase-admin'

export async function generateUserInsights(telegramId: number) {
  const { data: profile } = await supabaseAdmin
    .from('user_memory_profile')
    .select('*')
    .eq('telegram_id', telegramId)
    .maybeSingle()

  if (!profile) return []

  const insights: Array<{
    insight_type: string
    insight: string
    confidence: number
  }> = []

  const commonTimes = profile.common_times || []
  const frequentContacts = profile.frequent_contacts || []
  const frequentTasks = profile.frequent_tasks || []

  if (commonTimes.length > 0) {
    const topTime = commonTimes[0]
    insights.push({
      insight_type: 'common_reminder_time',
      insight: `User often sets reminders around ${topTime.value}.`,
      confidence: Math.min(0.95, 0.5 + (topTime.count || 1) * 0.1),
    })
  }

  if (frequentContacts.length > 0) {
    const topContact = frequentContacts[0]
    insights.push({
      insight_type: 'frequent_contact',
      insight: `User frequently mentions ${topContact.value}.`,
      confidence: Math.min(0.95, 0.5 + (topContact.count || 1) * 0.1),
    })
  }

  if (frequentTasks.length > 0) {
    const topTask = frequentTasks[0]
    insights.push({
      insight_type: 'frequent_task_type',
      insight: `User frequently creates ${topTask.value} related tasks.`,
      confidence: Math.min(0.95, 0.5 + (topTask.count || 1) * 0.1),
    })
  }

  for (const item of insights) {
    const { data: existing } = await supabaseAdmin
      .from('user_insights')
      .select('id')
      .eq('telegram_id', telegramId)
      .eq('insight_type', item.insight_type)
      .eq('status', 'active')
      .maybeSingle()

    if (existing?.id) {
      await supabaseAdmin
        .from('user_insights')
        .update({
          insight: item.insight,
          confidence: item.confidence,
        })
        .eq('id', existing.id)
    } else {
      await supabaseAdmin.from('user_insights').insert({
        telegram_id: telegramId,
        insight_type: item.insight_type,
        insight: item.insight,
        confidence: item.confidence,
        status: 'active',
      })
    }
  }

  return insights
}
