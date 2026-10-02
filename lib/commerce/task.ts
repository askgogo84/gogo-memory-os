import {supabaseAdmin} from '@/lib/supabase-admin'
import {commerceOrigin, type CommerceProvider} from './providers'
import type {CommerceAddress} from './addresses'

const STATES = ['provider_connection_required', 'waiting_address', 'waiting_verified_quote', 'waiting_restaurant_selection', 'waiting_item_selection', 'cart_outcome_unknown', 'cart_contents_verified', 'browser_research']
export type CommerceBrowserRead = {provider:string; runId:string; status:string; summary:string; checkedAt:string; taskUrl:string}
export type CommerceTask = {type: 'food_comparison' | 'grocery_comparison'; id: string; status: string; updated_at: string; summary: string; metadata_json: Record<string, any>; browserReads?:CommerceBrowserRead[]}

export function commerceTaskLink(runId: string) {
  return commerceOrigin() + '/dashboard/commerce?run=' + encodeURIComponent(runId)
}

// Bind connections to explicit owned tasks, never the latest task.
export async function readCommerceTask(owner: string, runId: string): Promise<CommerceTask | null> {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(runId)) return null
  const {data, error} = await supabaseAdmin.from('agent_runs')
    .select('id,type,status,updated_at,summary,metadata_json').eq('id', runId).eq('telegram_id', owner).maybeSingle()
  if (error) throw new Error('commerce_task_read_failed')
  if (!data || !['food_comparison', 'grocery_comparison'].includes(data.type) || !['paused', 'outcome_unknown'].includes(data.status) || !STATES.includes(data.metadata_json?.state)) return null
  const task=data as CommerceTask
  if(task.metadata_json.state==='browser_research'){
    const reads:CommerceBrowserRead[]=[]
    for(const [provider,childId] of Object.entries(task.metadata_json.browser_runs||{}).slice(0,4)){
      if(typeof childId!=='string')continue
      const {data:child,error:childError}=await supabaseAdmin.from('agent_runs').select('id,status,summary,updated_at,metadata_json')
        .eq('id',childId).eq('telegram_id',owner).eq('type','secure_browser').maybeSingle()
      if(childError)throw new Error('commerce_browser_read_failed')
      if(!child||child.metadata_json?.commerce_parent_id!==task.id)continue
      reads.push({provider,runId:child.id,status:child.status,summary:child.summary,checkedAt:child.updated_at,
        taskUrl:commerceOrigin()+'/dashboard/activity/'+encodeURIComponent(child.id)+'/browser'})
    }
    task.browserReads=reads
    task.summary=reads.length?reads.map(read=>`${read.provider}: ${read.summary}\nBrowser task: ${read.taskUrl}`).join('\n\n')+'\n\nThese are browser observations, not a verified comparison of delivered totals. Cart preparation and phone-cart opening remain unverified.': 'Browser results are unavailable. This comparison is not complete.'
  }
  return task
}

export function commerceTaskView(task: CommerceTask) {
  return {runId: task.id, service: commerceTaskService(task), state: task.metadata_json.state, summary: task.summary,
    subject: task.metadata_json.subject, provider: task.metadata_json.commerce?.provider,
    addressLabel: task.metadata_json.commerce?.address?.label || null, catalogue: task.metadata_json.commerce?.catalogue || null, browserReads:task.browserReads||[]}
}

async function saveTask(owner: string, task: CommerceTask, metadata: Record<string, any>, summary: string) {
  // A closed/replaced task or simultaneous update must not be resurrected.
  const {data, error} = await supabaseAdmin.from('agent_runs')
    .update({metadata_json: metadata, summary, updated_at: new Date().toISOString()})
    .eq('id', task.id).eq('telegram_id', owner).eq('type', task.type)
    .eq('status', 'paused').eq('updated_at', task.updated_at).select('id,type,status,updated_at,summary,metadata_json').maybeSingle()
  if (error || !data) throw new Error('commerce_task_changed')
  return data as CommerceTask
}

export async function resumeCommerceTaskAfterAuth(owner: string, runId: string, provider: CommerceProvider) {
  const task = await readCommerceTask(owner, runId)
  if (!task || task.metadata_json.state.startsWith('cart_') || task.metadata_json.state==='browser_research') return null
  // New authorization can represent a different provider account; select its address again.
  return saveTask(owner, task, {...task.metadata_json, state: 'waiting_address', commerce: {provider, authorized_at: new Date().toISOString()}},
    'Account connected. Choose a saved delivery address to continue this comparison. Prices and cart are not verified yet.')
}

export async function saveCommerceBrowserLink(owner:string,task:CommerceTask,provider:string,runId:string){
  return saveTask(owner,task,{...task.metadata_json,state:'browser_research',browser_runs:{...task.metadata_json.browser_runs,[provider]:runId}},
    'Browser research is linked to this comparison. Sign-in or delivery-location selection may need your help. Delivered totals and cart preparation remain unverified.')
}

export async function selectCommerceTaskAddress(owner: string, task: CommerceTask, provider: CommerceProvider, address: CommerceAddress, page = 1) {
  if (task.metadata_json.commerce?.provider !== provider || !['waiting_address', 'waiting_verified_quote', 'waiting_restaurant_selection', 'waiting_item_selection'].includes(task.metadata_json.state)) throw new Error('commerce_task_changed')
  return saveTask(owner, task, {...task.metadata_json, state: 'waiting_verified_quote', commerce: {
    ...task.metadata_json.commerce, address: {id: address.id, label: address.label, source: 'provider_saved_address', page, selected_at: new Date().toISOString()}, catalogue: null, blocker: null,
  }}, 'Saved delivery address selected. Live item availability, delivery totals and cart preparation are still unverified. No order has been placed.')
}

export function commerceTaskService(task: CommerceTask): 'food' | 'grocery' { return task.type === 'grocery_comparison' ? 'grocery' : 'food' }

export type FoodCatalogue = {observedAt: string; products?: import('./swiggy-read').GroceryChoice[]; restaurants?: import('./swiggy-read').RestaurantChoice[]; items?: import('./swiggy-read').FoodChoice[]; restaurantId?: string}
export async function saveCommerceCatalogue(owner: string, task: CommerceTask, catalogue: FoodCatalogue) {
  const items = catalogue.items || catalogue.products
  const options = items || catalogue.restaurants || []
  const state = items ? 'waiting_item_selection' : 'waiting_restaurant_selection'
  const summary = options.length
    ? (catalogue.products ? 'Instamart' : 'Swiggy') + ' returned these ' + (catalogue.products ? 'available products' : items ? 'available menu items' : 'open restaurants') + ' for your selected address: ' + options.map(option => option.name + ('variant' in option ? ' — ' + option.variant : '')).join('; ') + '. ' + (items ? 'Item prices, delivery totals and cart preparation are not yet verified.' : 'Choose a restaurant to read its menu. Prices and delivered totals are not yet verified.')
    : (catalogue.products ? 'Instamart' : 'Swiggy') + ' did not return verifiably available ' + (catalogue.products ? 'matching products' : items ? 'matching menu items' : 'restaurants') + ' in this search. Nothing was added to a cart or ordered.'
  return saveTask(owner, task, {...task.metadata_json, state, commerce: {...task.metadata_json.commerce, blocker: null, catalogue}}, summary + ' Checked: ' + catalogue.observedAt + '. Availability can change.')
}

export async function saveCommerceReadBlocker(owner: string, task: CommerceTask, reason: 'reauth_required' | 'address_changed' | 'provider_unverified') {
  const explanation = reason === 'reauth_required' ? 'Sign in to Swiggy again to continue this same task.' : reason === 'address_changed' ? 'Choose a saved delivery address again; the previous selection could not be confirmed.' : 'The provider result could not be verified. Retry this same task.'
  return saveTask(owner, task, {...task.metadata_json, commerce: {...task.metadata_json.commerce, blocker: {reason, observedAt: new Date().toISOString()}}}, explanation + ' The comparison is incomplete. No cart was changed by this lookup and no order was placed.')
}
