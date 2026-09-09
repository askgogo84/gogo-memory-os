import { supabaseAdmin } from '@/lib/supabase-admin'
import { sendWhatsAppMessage } from '@/lib/channels/whatsapp'

export type DeadlineWatcherCondition = {
  title: string
  deadline: string
  notifyBeforeHours: number
  delivery: 'app' | 'whatsapp' | 'both'
}

function validDate(value: unknown): string | null {
  const d = new Date(String(value || ''))
  return Number.isFinite(d.getTime()) ? d.toISOString() : null
}

export function normalizeDeadlineWatcher(input: any): DeadlineWatcherCondition | null {
  const title = String(input?.title || '').trim().slice(0, 180)
  const deadline = validDate(input?.deadline)
  const notifyBeforeHours = Math.max(1, Math.min(24 * 30, Math.floor(Number(input?.notifyBeforeHours || 24))))
  const delivery = ['app','whatsapp','both'].includes(String(input?.delivery)) ? String(input.delivery) as DeadlineWatcherCondition['delivery'] : 'both'
  if (!title || !deadline) return null
  return { title, deadline, notifyBeforeHours, delivery }
}

export async function createDeadlineWatcher(params: {
  telegramId: string
  condition: DeadlineWatcherCondition
  goalId?: string | null
}) {
  const now = new Date()
  const deadline = new Date(params.condition.deadline)
  const threshold = new Date(deadline.getTime() - params.condition.notifyBeforeHours * 3600_000)
  const nextCheck = threshold.getTime() > now.getTime() ? threshold : now
  const { data, error } = await supabaseAdmin.from('agent_watchers').insert({
    telegram_id: params.telegramId,
    goal_id: params.goalId || null,
    type: 'deadline',
    condition_json: params.condition,
    cadence_minutes: 60,
    active: true,
    last_state_json: {},
    next_check_at: nextCheck.toISOString(),
  }).select('id, type, condition_json, cadence_minutes, active, next_check_at, created_at').single()
  if (error || !data) throw new Error(`agent_watcher_create_failed:${error?.message || 'unknown'}`)
  return data
}

async function writeActivity(telegramId: string, message: string, metadata: Record<string, unknown>) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({
    telegram_id: telegramId,
    event_type: 'watcher_triggered',
    message: message.slice(0, 900),
    metadata_json: metadata,
  })
  if (error) console.error('AGENT_WATCHER_ACTIVITY_FAILED:', error.message)
}

async function createIdea(telegramId: string, condition: DeadlineWatcherCondition, watcherId: string) {
  const reason = `${condition.title} is approaching its deadline.`
  const { error } = await supabaseAdmin.from('agent_ideas').insert({
    telegram_id: telegramId,
    title: condition.title,
    reason,
    expected_value: 'Review it now so it does not become a last-minute problem.',
    value_score: 0.9,
    action_label: 'Review',
    source_refs: [{ type: 'watcher', id: watcherId }],
    status: 'new',
  })
  if (error) console.error('AGENT_WATCHER_IDEA_FAILED:', error.message)
}

async function sendWhatsAppIfWanted(telegramId: string, condition: DeadlineWatcherCondition) {
  if (condition.delivery !== 'whatsapp' && condition.delivery !== 'both') return
  const tg = Number(telegramId)
  if (!Number.isFinite(tg)) return
  const { data } = await supabaseAdmin.from('users').select('whatsapp_id').eq('telegram_id', tg).maybeSingle()
  const phone = String(data?.whatsapp_id || '').trim()
  if (!phone) return
  await sendWhatsAppMessage(phone, `⏳ Gogo noticed a deadline coming up\n\n${condition.title}\n\nI’ve also added this to your Gogo Activity/Ideas in the app.`)
}

export async function processDueAgentWatchers(limit = 40) {
  const now = new Date()
  const { data, error } = await supabaseAdmin.from('agent_watchers')
    .select('id, telegram_id, type, condition_json, last_state_json, active, next_check_at')
    .eq('active', true)
    .lte('next_check_at', now.toISOString())
    .order('next_check_at', { ascending: true })
    .limit(limit)
  if (error) throw new Error(`agent_watchers_read_failed:${error.message}`)

  let checked = 0, triggered = 0, failed = 0
  for (const watcher of (data || []) as any[]) {
    checked++
    try {
      if (watcher.type !== 'deadline') {
        await supabaseAdmin.from('agent_watchers').update({ next_check_at: new Date(now.getTime() + 3600_000).toISOString(), last_checked_at: now.toISOString() }).eq('id', watcher.id)
        continue
      }
      const condition = normalizeDeadlineWatcher(watcher.condition_json)
      if (!condition) {
        await supabaseAdmin.from('agent_watchers').update({ active:false, last_checked_at:now.toISOString(), last_state_json:{ error:'invalid_condition' } }).eq('id', watcher.id)
        failed++
        continue
      }
      const deadline = new Date(condition.deadline)
      const thresholdMs = deadline.getTime() - condition.notifyBeforeHours * 3600_000
      const due = now.getTime() >= thresholdMs
      const alreadyTriggered = watcher.last_state_json?.triggered === true

      if (due && !alreadyTriggered) {
        await createIdea(String(watcher.telegram_id), condition, String(watcher.id))
        await sendWhatsAppIfWanted(String(watcher.telegram_id), condition).catch(err => console.error('AGENT_WATCHER_WHATSAPP_FAILED:', err?.message || err))
        await writeActivity(String(watcher.telegram_id), `Background Gogo surfaced: ${condition.title}`, { watcher_id: watcher.id, type:'deadline', delivery:condition.delivery })
        await supabaseAdmin.from('agent_watchers').update({
          active:false,
          last_checked_at:now.toISOString(),
          last_state_json:{ triggered:true, triggeredAt:now.toISOString(), deadline:condition.deadline },
          next_check_at:null,
          updated_at:now.toISOString(),
        }).eq('id', watcher.id)
        triggered++
      } else {
        const next = new Date(Math.min(deadline.getTime(), Math.max(now.getTime() + 3600_000, thresholdMs)))
        await supabaseAdmin.from('agent_watchers').update({
          last_checked_at:now.toISOString(),
          last_state_json:{ triggered:alreadyTriggered, deadline:condition.deadline },
          next_check_at:next.toISOString(),
          updated_at:now.toISOString(),
        }).eq('id', watcher.id)
      }
    } catch (err:any) {
      failed++
      console.error('AGENT_WATCHER_PROCESS_FAILED:', watcher.id, err?.message || err)
    }
  }
  return { checked, triggered, failed }
}
