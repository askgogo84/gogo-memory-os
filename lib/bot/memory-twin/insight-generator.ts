import { supabaseAdmin } from '@/lib/supabase-admin'

const NOISY_CONTACTS = new Set([
  'about','team','someone','them','him','her','me','myself','appointment','meeting',
  'in 2 mins','in 5 mins','in 10 mins','in 20 mins','tomorrow','today',
])

const NON_PROACTIVE_TASKS = new Set(['general','health','payment','expense'])

type EvidenceItem = { value?: string; count?: number; last_seen?: string }

type InsightCandidate = {
  insight_type: string
  insight: string
  confidence: number
  evidence_count: number
  source_refs: any[]
  actionable?: {
    title: string
    reason: string
    expectedValue: string
    actionLabel: string
    valueScore: number
  }
}

function n(value: unknown) {
  const parsed = Number(value || 0)
  return Number.isFinite(parsed) ? parsed : 0
}

function confidenceFor(count: number, base = 0.58) {
  return Math.min(0.96, base + Math.min(count, 12) * 0.035)
}

function cleanItems(value: unknown): EvidenceItem[] {
  return Array.isArray(value)
    ? value.filter((x:any) => x && typeof x === 'object' && String(x.value || '').trim())
    : []
}

function usefulContacts(value: unknown) {
  return cleanItems(value)
    .map(x => ({...x, value:String(x.value || '').trim()}))
    .filter(x => n(x.count) >= 3)
    .filter(x => !NOISY_CONTACTS.has(String(x.value).toLowerCase()))
    .filter(x => !/^\d|\b(?:salary|bill|reminder|tomorrow|today|mins?|minutes?)\b/i.test(String(x.value)))
    .sort((a,b) => n(b.count)-n(a.count))
}

function usefulTasks(value: unknown) {
  return cleanItems(value)
    .map(x => ({...x, value:String(x.value || '').trim().toLowerCase()}))
    .filter(x => n(x.count) >= 3 && !NON_PROACTIVE_TASKS.has(String(x.value)))
    .sort((a,b) => n(b.count)-n(a.count))
}

function usefulTimes(value: unknown) {
  return cleanItems(value)
    .filter(x => n(x.count) >= 5)
    .sort((a,b) => n(b.count)-n(a.count))
}

async function upsertInsight(telegramId:number, item:InsightCandidate) {
  const { data: existing } = await supabaseAdmin
    .from('user_insights')
    .select('id,user_confirmed')
    .eq('telegram_id', telegramId)
    .eq('insight_type', item.insight_type)
    .eq('status', 'active')
    .order('updated_at', { ascending:false })
    .limit(1)
    .maybeSingle()

  const patch = {
    insight:item.insight,
    confidence:item.confidence,
    evidence_count:item.evidence_count,
    source_refs:item.source_refs,
    updated_at:new Date().toISOString(),
  }

  if (existing?.id) {
    const { error } = await supabaseAdmin.from('user_insights').update(patch).eq('id',existing.id)
    if (error) console.error('[memory-twin] insight update failed:', error.message)
    return existing.id as string
  }

  const { data, error } = await supabaseAdmin.from('user_insights').insert({
    telegram_id:telegramId,
    insight_type:item.insight_type,
    insight:item.insight,
    confidence:item.confidence,
    evidence_count:item.evidence_count,
    source_refs:item.source_refs,
    user_confirmed:false,
    status:'active',
    updated_at:new Date().toISOString(),
  }).select('id').single()
  if (error) console.error('[memory-twin] insight insert failed:', error.message)
  return data?.id || null
}

async function maybeCreateAgentIdea(telegramId:number, insightId:string|null, item:InsightCandidate) {
  if (!item.actionable || item.confidence < 0.72 || item.evidence_count < 5) return false

  const since = new Date(Date.now()-14*86400_000).toISOString()
  const { data: existing } = await supabaseAdmin.from('agent_ideas')
    .select('id')
    .eq('telegram_id',String(telegramId))
    .eq('title',item.actionable.title)
    .in('status',['new','accepted','snoozed'])
    .gte('created_at',since)
    .limit(1)
    .maybeSingle()
  if (existing?.id) return false

  const { error } = await supabaseAdmin.from('agent_ideas').insert({
    telegram_id:String(telegramId),
    title:item.actionable.title,
    reason:item.actionable.reason,
    expected_value:item.actionable.expectedValue,
    value_score:item.actionable.valueScore,
    action_label:item.actionable.actionLabel,
    source_refs:[{
      type:'memory_twin',
      insight_id:insightId,
      insight_type:item.insight_type,
      confidence:item.confidence,
      evidence_count:item.evidence_count,
    }],
    status:'new',
  })
  if (error) {
    console.error('[memory-twin] agent idea insert failed:', error.message)
    return false
  }
  return true
}

export async function generateUserInsights(telegramId: number) {
  const [{data:profile},{data:consent}] = await Promise.all([
    supabaseAdmin.from('user_memory_profile').select('*').eq('telegram_id',telegramId).maybeSingle(),
    supabaseAdmin.from('user_consent_settings').select('memory_enabled,proactive_suggestions_enabled').eq('telegram_id',telegramId).maybeSingle(),
  ])

  if (!profile || consent?.memory_enabled === false) return []

  const candidates: InsightCandidate[] = []
  const topTime = usefulTimes(profile.common_times)[0]
  if (topTime?.value) {
    const count=n(topTime.count)
    candidates.push({
      insight_type:'common_reminder_time',
      insight:`You often choose ${topTime.value} for reminders.`,
      confidence:confidenceFor(count),
      evidence_count:count,
      source_refs:[{type:'profile_pattern',field:'common_times',value:topTime.value,count,last_seen:topTime.last_seen||null}],
      actionable:{
        title:'Use your usual reminder time',
        reason:`You have chosen ${topTime.value} repeatedly. Gogo can suggest it first when you say “morning” without giving an exact time.`,
        expectedValue:'Less back-and-forth while you stay in control of the final time.',
        actionLabel:'Use as suggested time',
        valueScore:0.72,
      },
    })
  }

  const topContact = usefulContacts(profile.frequent_contacts)[0]
  if (topContact?.value) {
    const count=n(topContact.count)
    candidates.push({
      insight_type:'frequent_contact',
      insight:`You frequently coordinate with ${topContact.value}.`,
      confidence:confidenceFor(count,0.56),
      evidence_count:count,
      source_refs:[{type:'profile_pattern',field:'frequent_contacts',value:topContact.value,count,last_seen:topContact.last_seen||null}],
    })
  }

  const topTask = usefulTasks(profile.frequent_tasks)[0]
  if (topTask?.value) {
    const count=n(topTask.count)
    const task=String(topTask.value)
    let actionable:InsightCandidate['actionable']
    if (task==='meeting' || task==='briefing') {
      actionable={
        title:'Let Gogo prepare your meeting days',
        reason:`Meeting/briefing work appears repeatedly in your Gogo activity. Gogo can prepare context and briefs before the day starts.`,
        expectedValue:'Fewer manual preparation steps before meetings.',
        actionLabel:'Create a preparation goal',
        valueScore:0.79,
      }
    } else if (task==='follow-up' || task==='call') {
      actionable={
        title:'Let Gogo keep track of follow-ups',
        reason:`Follow-up and call tasks recur in your activity. Background Gogo can surface what is due instead of waiting for you to remember.`,
        expectedValue:'Less mental load and fewer missed follow-ups.',
        actionLabel:'Create a follow-up goal',
        valueScore:0.81,
      }
    }
    candidates.push({
      insight_type:'frequent_task_type',
      insight:`${task[0].toUpperCase()+task.slice(1)} work appears frequently in your Gogo activity.`,
      confidence:confidenceFor(count),
      evidence_count:count,
      source_refs:[{type:'profile_pattern',field:'frequent_tasks',value:task,count,last_seen:topTask.last_seen||null}],
      actionable,
    })
  }

  const results:any[]=[]
  for (const item of candidates) {
    const insightId=await upsertInsight(telegramId,item)
    const ideaCreated = consent?.proactive_suggestions_enabled === false
      ? false
      : await maybeCreateAgentIdea(telegramId,insightId,item)
    results.push({...item,insightId,ideaCreated})
  }
  return results
}
