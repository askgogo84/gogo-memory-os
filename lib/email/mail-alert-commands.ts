// "what do you alert me about?", "stop renewals", "add newsletters", "quiet 11 pm to 7 am", "at most 3 a day"
// (mock screen 3, 6 Nov). The rules live on the person's inbox watch (agent_watchers, type email_triage,
// condition_json.mailAlerts); a person with no inbox watch is told how to start one.
import { supabaseAdmin } from '@/lib/data/supabase-admin'
import { RULES_ASK_RE, RULE_COMMAND_RE, applyRuleCommand, formatRules, normalizeRules } from './mail-alerts'

export function isMailAlertCommand(text: string) {
  const t = String(text || '').trim()
  return t.length <= 120 && (RULES_ASK_RE.test(t) || (RULE_COMMAND_RE.test(t) && /\b(?:alerts?|renewals?|newsletters?|offers?|replies|reply|deadlines?|security|sign[- ]?ins?|payments?|failed|money|charges?|mandates?|subscriptions?|quiet|a day|per day)\b/i.test(t)))
}

export async function tryMailAlertCommand(telegramId: string | number, text: string): Promise<string | null> {
  if (!isMailAlertCommand(text)) return null
  const owner = Number(telegramId)
  if (!Number.isSafeInteger(owner)) return null
  const { data: watcher } = await supabaseAdmin.from('agent_watchers').select('id,condition_json').eq('telegram_id', owner).eq('type', 'email_triage').eq('active', true)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()
  const rules = normalizeRules((watcher?.condition_json as any)?.mailAlerts)
  if (RULES_ASK_RE.test(text)) {
    return watcher ? formatRules(rules) : `I'm not watching your inbox yet. Say "watch my inbox" and I'll message you about each email that needs you: ${formatRules(rules).split('\n\n')[1].replace(/\n/g, ' ')}`
  }
  const change = applyRuleCommand(text, rules)
  if (!change) return null
  if (!watcher) return 'I\'m not watching your inbox yet. Say "watch my inbox" first, then set what I alert you about.'
  if (change.rules !== rules) {
    const { error } = await supabaseAdmin.from('agent_watchers').update({ condition_json: { ...(watcher.condition_json as any), mailAlerts: change.rules }, updated_at: new Date().toISOString() }).eq('id', watcher.id).eq('telegram_id', owner)
    if (error) { console.error('MAIL_ALERT_RULES_SAVE_FAILED:', error.message); return "I couldn't save that just now. Try again in a minute." }
  }
  return `${change.changed}\n\n${formatRules(change.rules)}`
}
