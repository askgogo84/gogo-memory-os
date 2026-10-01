import {supabaseAdmin} from '@/lib/supabase-admin'
import {commerceOrigin, type CommerceProvider} from './providers'
import type {CommerceAddress} from './addresses'

const STATES = ['provider_connection_required', 'waiting_address', 'waiting_verified_quote']
export type CommerceTask = {id: string; status: string; updated_at: string; summary: string; metadata_json: Record<string, any>}

export function commerceTaskLink(runId: string) {
  return commerceOrigin() + '/dashboard/commerce?run=' + encodeURIComponent(runId)
}

// Bind connections to explicit owned tasks, never the latest task.
export async function readCommerceTask(owner: string, runId: string): Promise<CommerceTask | null> {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId)) return null
  const {data, error} = await supabaseAdmin.from('agent_runs')
    .select('id,status,updated_at,summary,metadata_json').eq('id', runId).eq('telegram_id', owner).eq('type', 'food_comparison').maybeSingle()
  if (error) throw new Error('commerce_task_read_failed')
  if (!data || data.status !== 'paused' || !STATES.includes(data.metadata_json?.state)) return null
  return data as CommerceTask
}

export function commerceTaskView(task: CommerceTask) {
  return {runId: task.id, state: task.metadata_json.state, summary: task.summary,
    subject: task.metadata_json.subject, provider: task.metadata_json.commerce?.provider,
    addressLabel: task.metadata_json.commerce?.address?.label || null}
}

async function saveTask(owner: string, task: CommerceTask, metadata: Record<string, any>, summary: string) {
  // A closed/replaced task or simultaneous update must not be resurrected.
  const {data, error} = await supabaseAdmin.from('agent_runs')
    .update({metadata_json: metadata, summary, updated_at: new Date().toISOString()})
    .eq('id', task.id).eq('telegram_id', owner).eq('type', 'food_comparison')
    .eq('status', 'paused').eq('updated_at', task.updated_at).select('id,status,updated_at,summary,metadata_json').maybeSingle()
  if (error || !data) throw new Error('commerce_task_changed')
  return data as CommerceTask
}

export async function resumeCommerceTaskAfterAuth(owner: string, runId: string, provider: CommerceProvider) {
  const task = await readCommerceTask(owner, runId)
  if (!task) return null
  // New authorization can represent a different provider account; select its address again.
  return saveTask(owner, task, {...task.metadata_json, state: 'waiting_address', commerce: {provider, authorized_at: new Date().toISOString()}},
    'Account connected. Choose a saved delivery address to continue this comparison. Prices and cart are not verified yet.')
}

export async function selectCommerceTaskAddress(owner: string, task: CommerceTask, provider: CommerceProvider, address: CommerceAddress) {
  if (task.metadata_json.commerce?.provider !== provider || !['waiting_address', 'waiting_verified_quote'].includes(task.metadata_json.state)) throw new Error('commerce_task_changed')
  return saveTask(owner, task, {...task.metadata_json, state: 'waiting_verified_quote', commerce: {
    ...task.metadata_json.commerce, address: {id: address.id, label: address.label, source: 'provider_saved_address', selected_at: new Date().toISOString()},
  }}, 'Saved delivery address selected. Live item availability, delivery totals and cart preparation are still unverified. No order has been placed.')
}
