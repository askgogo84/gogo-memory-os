import { supabaseAdmin } from '@/lib/supabase-admin'

export type MemoryTwinContext = {
  memoryEnabled:boolean
  proactiveSuggestionsEnabled:boolean
  profile:any|null
  insights:any[]
  recentEvents:any[]
}

const EMPTY_CONTEXT:MemoryTwinContext={
  memoryEnabled:false,
  proactiveSuggestionsEnabled:false,
  profile:null,
  insights:[],
  recentEvents:[],
}

export async function loadMemoryTwinContext(telegramId: number):Promise<MemoryTwinContext> {
  // Consent is the first boundary. Old learned rows can remain in storage for
  // audit/history, but they must not influence replies while memory is disabled.
  const {data:consent,error:consentError}=await supabaseAdmin
    .from('user_consent_settings')
    .select('memory_enabled,proactive_suggestions_enabled')
    .eq('telegram_id',telegramId)
    .maybeSingle()
  if(consentError){
    console.error('MEMORY_TWIN_CONSENT_READ_FAILED:',consentError.message)
    return EMPTY_CONTEXT
  }
  if(consent?.memory_enabled !== true)return EMPTY_CONTEXT

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
      .gte('confidence',0.65)
      .order('confidence', { ascending: false })
      .limit(10),

    supabaseAdmin
      .from('user_behavior_events')
      .select('event_type,event_payload,source,created_at')
      .eq('telegram_id', telegramId)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return {
    memoryEnabled:true,
    proactiveSuggestionsEnabled:consent?.proactive_suggestions_enabled === true,
    profile: profile || null,
    insights: insights || [],
    recentEvents: recentEvents || [],
  }
}

function repeated(items:any[],minCount:number){
  return (Array.isArray(items)?items:[])
    .filter((x:any)=>String(x?.value||'').trim() && Number(x?.count||0)>=minCount)
    .slice(0,5)
}

/**
 * Compact SOFT learned context for the conversational model. Never phrase an
 * inferred pattern as a confirmed fact. Current user instructions and explicit
 * standing preferences always outrank this block.
 */
export async function buildMemoryTwinContextText(telegramId: number) {
  const context = await loadMemoryTwinContext(telegramId)
  if (!context.memoryEnabled || (!context.profile && !context.insights.length)) return ''

  const profile = context.profile
  const commonTimes=repeated(profile?.common_times,3)
  const frequentContacts=repeated(profile?.frequent_contacts,3)
  const frequentTasks=repeated(profile?.frequent_tasks,3)
  const lines: string[] = []

  lines.push('Soft learned patterns from this user’s prior AskGogo activity (inferences, not guaranteed facts):')
  lines.push('- Use these only to make replies more natural or to offer a likely default.')
  lines.push('- The current message and explicit saved preferences/memories always override these patterns.')
  lines.push('- Never execute, spend, send, delete, book, disclose or change an external account solely because of a learned pattern.')
  lines.push('- If a learned default materially changes an action, ask or make the default visible before acting.')

  if (commonTimes.length) lines.push(`- Repeated reminder times: ${commonTimes.map((x:any)=>`${x.value} (${x.count}×)`).join(', ')}`)
  if (frequentContacts.length) lines.push(`- Repeated contacts/entities: ${frequentContacts.map((x:any)=>`${x.value} (${x.count}×)`).join(', ')}`)
  if (frequentTasks.length) lines.push(`- Repeated task types: ${frequentTasks.map((x:any)=>`${x.value} (${x.count}×)`).join(', ')}`)

  if (context.insights.length) {
    lines.push('- Higher-confidence learned insights:')
    for (const item of context.insights.slice(0, 5)) {
      lines.push(`  • ${String(item.insight||'').slice(0,280)} (confidence ${Math.round(Number(item.confidence||0)*100)}%)`)
    }
  }

  return lines.length>4 ? lines.join('\n') : ''
}
