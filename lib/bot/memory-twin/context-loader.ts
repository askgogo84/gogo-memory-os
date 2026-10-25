import { supabaseAdmin } from '@/lib/supabase-admin'

export async function loadMemoryTwinContext(telegramId: number) {
  const [{ data: profile }, { data: insights }, { data: recentEvents }] = await Promise.all([
    supabaseAdmin
      .from('user_memory_profile')
      .select('*')
      .eq('telegram_id', telegramId)
      .maybeSingle(),

    supabaseAdmin
      .from('user_insights')
      .select('*')
      .eq('telegram_id', telegramId)
      .eq('status', 'active')
      .order('confidence', { ascending: false })
      .limit(10),

    supabaseAdmin
      .from('user_behavior_events')
      .select('*')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return {
    profile: profile || null,
    insights: insights || [],
    recentEvents: recentEvents || [],
  }
}

export async function buildMemoryTwinContextText(telegramId: number) {
  const context = await loadMemoryTwinContext(telegramId)

  if (!context.profile && !context.insights.length) return ''

  const profile = context.profile
  const lines: string[] = []

  lines.push('AskGogo Memory Twin context:')

  if (profile?.preferred_name) lines.push(`- Preferred name: ${profile.preferred_name}`)
  if (profile?.timezone) lines.push(`- Timezone: ${profile.timezone}`)
  if (profile?.communication_style) lines.push(`- Reply style: ${profile.communication_style}`)

  if (profile?.common_times?.length) {
    lines.push(`- Common reminder times: ${profile.common_times.slice(0, 5).map((x: any) => x.value).join(', ')}`)
  }

  if (profile?.frequent_contacts?.length) {
    lines.push(`- Frequent contacts/entities: ${profile.frequent_contacts.slice(0, 5).map((x: any) => x.value).join(', ')}`)
  }

  if (profile?.frequent_tasks?.length) {
    lines.push(`- Frequent task types: ${profile.frequent_tasks.slice(0, 5).map((x: any) => x.value).join(', ')}`)
  }

  if (context.insights.length) {
    lines.push('- Insights:')
    for (const item of context.insights.slice(0, 5)) lines.push(`  • ${item.insight}`)
  }

  return lines.join('\n')
}
