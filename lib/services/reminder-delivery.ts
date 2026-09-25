import { supabaseAdmin } from '@/lib/supabase-admin'
import { getNextOccurrence } from './reminder-series'

// Coalesce an outage into one current notification and one future occurrence.
// Interval arithmetic is constant-time even after years offline.
export function nextFutureOccurrence(pattern: string, due: Date, now: Date): Date {
  const interval = pattern.match(/^every_(\d+)_?(h|hours?|d|days?|m|mins?|minutes?)\b/i)
  const followup = pattern.match(/^followup:(\d+)(h|d):/i)
  const match = interval || followup
  if (match) {
    const unit = match[2].toLowerCase()[0]
    const ms = Number(match[1]) * (unit === 'd' ? 86400000 : unit === 'h' ? 3600000 : 60000)
    if (!Number.isFinite(ms) || ms <= 0) throw new Error('invalid_recurrence_interval')
    return new Date(due.getTime() + Math.max(1, Math.floor((now.getTime() - due.getTime()) / ms) + 1) * ms)
  }
  let next = getNextOccurrence(pattern, due)
  for (let i = 0; next <= now && i < 10000; i++) {
    const previous = next
    next = getNextOccurrence(pattern, next)
    if (next <= previous) throw new Error('non_advancing_recurrence')
  }
  if (!Number.isFinite(next.getTime()) || next <= now) throw new Error('recurrence_catchup_limit')
  return next
}

export async function deliveryRpc(name: string, args: Record<string, unknown> = {}) {
  const { data, error } = await supabaseAdmin.rpc(name, args)
  if (error) throw new Error(`${name}: ${error.message}`)
  return data
}
