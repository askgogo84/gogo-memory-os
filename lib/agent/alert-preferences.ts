// Duet parity step 2 (approved 22 Oct mock): server side of alert preferences — read/save one row per owner.
// A missing row or table means defaults, so code deploys safely before the migration.
import { supabaseAdmin } from '@/lib/supabase-admin'
import { ALERT_TOPICS, DEFAULT_ALERT_PREFERENCES, normaliseAlertPreferences, type AlertPreferences } from './alert-preferences-shared'
export * from './alert-preferences-shared'

const missingTable = (msg: string) => /user_alert_preferences|does not exist|schema cache|42P01|PGRST205/i.test(msg)

export async function getAlertPreferences(telegramId: string): Promise<AlertPreferences> {
  const { data, error } = await supabaseAdmin.from('user_alert_preferences').select('check_every_minutes,topics,quiet_start,quiet_end')
    .eq('telegram_id', String(telegramId)).maybeSingle()
  if (error) {
    if (!missingTable(String(error.message || error.code || ''))) console.error('ALERT_PREFERENCES_READ_FAILED:', error.message)
    return DEFAULT_ALERT_PREFERENCES
  }
  return data ? normaliseAlertPreferences(data, true) : DEFAULT_ALERT_PREFERENCES
}

export async function saveAlertPreferences(telegramId: string, prefs: AlertPreferences) {
  const now = new Date().toISOString()
  const { error } = await supabaseAdmin.from('user_alert_preferences').upsert({
    telegram_id: String(telegramId), check_every_minutes: prefs.checkEveryMinutes, topics: prefs.topics,
    quiet_start: prefs.quietStart, quiet_end: prefs.quietEnd, updated_at: now,
  }, { onConflict: 'telegram_id' })
  if (error) {
    if (missingTable(String(error.message || ''))) return { ok: false as const, error: 'not_ready' as const }
    throw new Error(`alert_preferences_write_failed:${error.message}`)
  }
  // The inbox watch follows the chosen frequency (never below the 60-minute floor).
  const { error: watchError } = await supabaseAdmin.from('agent_watchers').update({ cadence_minutes: prefs.checkEveryMinutes, updated_at: now })
    .eq('telegram_id', String(telegramId)).eq('type', 'email_triage').eq('active', true)
  if (watchError) console.error('ALERT_PREFERENCES_INBOX_CADENCE_FAILED:', watchError.message)
  await supabaseAdmin.from('agent_activity').insert({
    telegram_id: String(telegramId), event_type: 'alert_preferences_updated', message: 'Alert settings updated.',
    metadata_json: { check_every_minutes: prefs.checkEveryMinutes, quiet_start: prefs.quietStart, quiet_end: prefs.quietEnd, muted: ALERT_TOPICS.filter(t => !prefs.topics[t]) },
  }).then(({ error: e }) => { if (e) console.error('ALERT_PREFERENCES_ACTIVITY_FAILED:', e.message) })
  return { ok: true as const }
}
