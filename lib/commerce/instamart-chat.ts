import {supabaseAdmin} from '@/lib/supabase-admin'
import {acquireBrainUserLease, releaseBrainUserLease} from '@/lib/agent/brain-runtime-guard'
import {commerceEnabled, commerceOrigin} from './providers'
import {readCommerceConnection} from './connection-store'
import {CommerceMcpClient, CommerceMcpError} from './mcp'
import {swiggyAddressPage, type CommerceAddress} from './addresses'
import {readInstamartProducts, type GroceryChoice} from './swiggy-read'
import {commerceHandoffUrl} from './evidence'
import {readCommerceTask, selectCommerceTaskAddress, saveCommerceCatalogue, saveCommerceReadBlocker, commerceTaskLink, type CommerceTask} from './task'
import {prepareInstamartCart} from './instamart-cart'

// Chat entry point for Swiggy Instamart through the user's own official Swiggy MCP connection.
// "order milk on Instamart" -> read-only search -> three options. Only a 1/2/3 reply that answers
// that list (the latest Gogo reply, on a task still waiting for a pick) adds that exact item, once,
// through the durable executor in ./instamart-cart. Nothing here orders or pays.

export const INSTAMART_PICK_PROMPT = 'Reply 1, 2 or 3 to add it to your Instamart cart. Nothing is ordered; you pay in the Swiggy app.'
const PICK_TTL_MS = 15 * 60_000
const CHECKOUT_URL = 'https://www.swiggy.com/instamart'
const NOT_ITEMS = /\b(?:order|orders|status|refund|refunds|delivery|delivered|invoice|bill|receipt|price|prices|cost|account|cart|offers?|coupons?)\b/i

export type InstamartChatResult = {text: string; handledBy: 'instamart-chat'; status: 'paused' | 'completed' | 'blocked' | 'outcome_unknown'; runId: string | null; capability: 'commerce'; risk: 'low'; mutated: boolean}

function cleanSubject(raw: string): string | null {
  const subject = raw.replace(/^(?:(?:some|a|an|the|me|us)\s+)+/i, '').replace(/\s+(?:please|pls)$/i, '').replace(/\s+/g, ' ').trim()
  if (!subject || subject.length > 120 || !/[a-z]/i.test(subject) || /^my\b/i.test(subject) || NOT_ITEMS.test(subject)) return null
  return subject
}

export function parseInstamartOrderRequest(text: string): string | null {
  const value = String(text || '').trim()
  if (value.length > 200) return null
  const order = value.match(/^(?:(?:hey\s+)?gogo[,\s]+)?(?:please\s+|pls\s+)?(?:(?:can|could|will)\s+you\s+)?(?:please\s+)?(?:order|buy|get)\s+(.{1,140}?)\s+(?:on|from|via|through|using)\s+(?:swiggy(?:'s)?\s+)?instamart(?:\s+(?:please|pls))?\s*[.!?]*$/i)
  const add = value.match(/^(?:please\s+)?add\s+(.{1,140}?)\s+(?:to|in|into)\s+(?:my\s+|the\s+)?(?:swiggy\s+)?instamart\s+(?:cart|basket)(?:\s+(?:please|pls))?\s*[.!?]*$/i)
  const raw = order?.[1] || add?.[1]
  return raw ? cleanSubject(raw) : null
}

// Single digit 1-3 or an ordinal only. PIN codes, amounts, sign-in codes and longer numbers never match.
export function parseInstamartPick(text: string): 1 | 2 | 3 | null {
  const value = String(text || '').trim()
  const digit = value.match(/^(?:(?:add|pick|choose|select|take)\s+)?(?:the\s+)?(?:(?:option|number|no\.?|item)\s*)?#?\s*([123])(?:st|nd|rd)?(?:\s+one)?(?:\s+please)?\s*[.!]?$/i)
  if (digit) return Number(digit[1]) as 1 | 2 | 3
  const word = value.match(/^(?:(?:add|pick|choose|select|take)\s+)?(?:the\s+)?(first|second|third)(?:\s+(?:one|option|item))?(?:\s+please)?\s*[.!]?$/i)
  return word ? ({first: 1, second: 2, third: 3} as const)[word[1].toLowerCase() as 'first' | 'second' | 'third'] : null
}

const result = (text: string, status: InstamartChatResult['status'], runId: string | null = null, mutated = false): InstamartChatResult =>
  ({text, handledBy: 'instamart-chat', status, runId, capability: 'commerce', risk: 'low', mutated})
const connectLink = () => commerceOrigin() + '/dashboard/commerce'
const rupees = (paise: number | null) => paise === null ? 'price shown in the Swiggy app' : '₹' + (paise % 100 ? (paise / 100).toFixed(2) : String(paise / 100))

export async function tryInstamartChat(params: {telegramId: number | string; text: string; surface?: string}): Promise<InstamartChatResult | null> {
  const subject = parseInstamartOrderRequest(params.text)
  const pick = subject ? null : parseInstamartPick(params.text)
  if (!subject && !pick) return null
  const owner = String(params.telegramId)
  if (!owner) return null
  return subject ? startInstamartOrder(owner, subject, params.text, params.surface || 'whatsapp') : bindInstamartPick(owner, pick!)
}

async function chooseAddress(owner: string, addresses: CommerceAddress[]): Promise<CommerceAddress | null> {
  // Reuse the address this user last chose for an Instamart task, if the provider still lists it.
  const {data} = await supabaseAdmin.from('agent_runs').select('metadata_json').eq('telegram_id', owner).eq('type', 'grocery_comparison')
    .order('updated_at', {ascending: false}).limit(10)
  for (const row of data || []) {
    const chosen = row?.metadata_json?.commerce?.address
    if (chosen?.source !== 'provider_saved_address' || typeof chosen.id !== 'string') continue
    const match = addresses.find(address => address.id === chosen.id)
    if (match) return match
  }
  return addresses.length === 1 ? addresses[0] : null
}

async function startInstamartOrder(owner: string, subject: string, requestText: string, surface: string): Promise<InstamartChatResult> {
  if (!commerceEnabled('swiggy')) return result('Swiggy Instamart cannot be connected to AskGogo yet, so I cannot add items to your cart. You can order ' + subject + ' in the Swiggy app.', 'blocked')
  const token = await readCommerceConnection(owner, 'swiggy').catch(() => null)
  if (!token) return result('Connect your Swiggy account first, then ask me again: ' + connectLink(), 'blocked')
  let task: CommerceTask | null = null
  try {
    const client = new CommerceMcpClient('swiggy', 'grocery', token.accessToken)
    const page = swiggyAddressPage(await client.readTool('get_addresses', {page: 1, pageSize: 10}))
    if (!page.addresses.length) return result('Your Swiggy account has no saved delivery address. Add one in the Swiggy app, then ask me again. Nothing was added or ordered.', 'blocked')
    const address = await chooseAddress(owner, page.addresses)
    const now = new Date().toISOString()
    const {data, error} = await supabaseAdmin.from('agent_runs').insert({
      telegram_id: owner, type: 'grocery_comparison', capability: 'browser', status: 'paused',
      title: 'Instamart: ' + subject, progress: 0, source: surface, started_at: now, updated_at: now,
      summary: 'Choose a saved Swiggy delivery address to search Instamart for ' + subject + '. Nothing has been added or ordered.',
      metadata_json: {plan_type: 'grocery_comparison', state: 'waiting_address', subject, request_text: requestText, service: 'grocery', entry: 'instamart_chat', commerce: {provider: 'swiggy', authorized_at: now}},
    }).select('id,type,status,updated_at,summary,metadata_json').single()
    if (error || !data?.id) throw new Error('instamart_task_create_failed')
    task = data as CommerceTask
    if (!address) return result('You have more than one saved Swiggy address. Choose where to deliver ' + subject + ' here, then pick an item: ' + commerceTaskLink(task.id), 'paused', task.id)
    task = await selectCommerceTaskAddress(owner, task, 'swiggy', address, 1)
    const products = await readInstamartProducts(client, address.id, subject)
    const options: GroceryChoice[] = products.slice(0, 3)
    const offeredAt = new Date().toISOString()
    task = await saveCommerceCatalogue(owner, task, {observedAt: offeredAt, products},
      options.length ? {chat_pick: {offeredAt, surface, options: options.map(option => ({spinId: option.id, skuId: option.skuId}))}} : {})
    if (!options.length) return result('Instamart has no in-stock match for "' + subject + '" at ' + address.label + ' right now. Try a more specific name, like "Amul Taaza toned milk 1 litre". Nothing was added or ordered.', 'completed', task.id)
    const lines = options.map((option, index) => (index + 1) + '. ' + option.name + ' — ' + option.variant + ' — ' + rupees(option.pricePaise))
    return result('Instamart options for "' + subject + '" delivering to ' + address.label + ':\n' + lines.join('\n') + '\n\n' + (options.length < 3 ? 'Reply ' + options.map((_, index) => index + 1).join(' or ') + ' to add it to your Instamart cart. Nothing is ordered; you pay in the Swiggy app.' : INSTAMART_PICK_PROMPT), 'paused', task.id)
  } catch (error) {
    const reauth = error instanceof CommerceMcpError && error.reason === 'reauth_required'
    if (task) await saveCommerceReadBlocker(owner, task, reauth ? 'reauth_required' : 'provider_unverified').catch(() => null)
    if (reauth) return result('Your Swiggy sign-in has expired. Reconnect here, then ask me again: ' + connectLink(), 'blocked', task?.id || null)
    return result('Swiggy Instamart did not return a result I could verify for "' + subject + '" (the address may be outside its delivery area, or the service is busy). Nothing was added or ordered. Try again in a minute' + (task ? ', or pick another address here: ' + commerceTaskLink(task.id) : '.'), 'blocked', task?.id || null)
  }
}

async function latestAssistantText(owner: string): Promise<string> {
  const {data} = await supabaseAdmin.from('conversations').select('content').eq('telegram_id', owner).eq('role', 'assistant')
    .order('created_at', {ascending: false}).limit(1).maybeSingle()
  return String(data?.content || '')
}

const PICK_FAILURES: Record<string, string> = {
  refresh_products: 'Those options are more than 5 minutes old, so I did not add anything. Ask me again (for example "order milk on Instamart") to get fresh options.',
  item_no_longer_available: 'That item is no longer available at your address, so I did not add anything. Ask me again for fresh options.',
  reselect_saved_address: 'Your saved Swiggy address changed, so I did not add anything. Ask me again to choose a current address.',
  select_saved_address: 'This request has no confirmed delivery address, so I did not add anything. Ask me again to choose one.',
  quantity_unavailable: 'Instamart will not allow more of that item in your cart, so I did not add it.',
  cart_too_large: 'Your Instamart cart is too large to change safely from chat, so I did not add anything.',
  cart_unverified: 'I could not verify your current Instamart cart (it may have a warning or another address), so I did not change it. Open the Swiggy app to review it.',
  cart_address_unverified: 'Your current Instamart cart is set to a different address, so I did not change it. Open the Swiggy app to review it.',
  cart_item_unverified: 'I could not verify the items already in your Instamart cart, so I did not change it. Open the Swiggy app to review it.',
}

async function bindInstamartPick(owner: string, pick: 1 | 2 | 3): Promise<InstamartChatResult | null> {
  const {data: latest, error} = await supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', owner).eq('type', 'grocery_comparison')
    .order('updated_at', {ascending: false}).limit(1).maybeSingle()
  if (error || !latest?.id) return null
  const task = await readCommerceTask(owner, latest.id).catch(() => null)
  const offer = task?.metadata_json.chat_pick
  // Bind only while this exact list is waiting: same task, still unpicked, recent, and Gogo's latest reply.
  if (!task || task.status !== 'paused' || task.metadata_json.state !== 'waiting_item_selection' || task.metadata_json.commerce?.cartOperation
      || !Array.isArray(offer?.options) || !offer.options.length) return null
  const age = Date.now() - Date.parse(offer.offeredAt || '')
  if (!Number.isFinite(age) || age < 0 || age > PICK_TTL_MS) return null
  if (!(await latestAssistantText(owner)).includes('to add it to your Instamart cart. Nothing is ordered')) return null
  const chosen = offer.options[pick - 1]
  if (!chosen) return result('That list has only ' + offer.options.length + ' option' + (offer.options.length === 1 ? '' : 's') + '. Reply with one of those numbers. Nothing was added.', 'paused', task.id)
  if (!commerceEnabled('swiggy')) return result('Swiggy Instamart cannot be connected to AskGogo right now, so I did not add anything.', 'blocked', task.id)
  const leaseKey = 'commerce:swiggy:' + owner
  const lease = await acquireBrainUserLease(leaseKey, 600).catch(() => null)
  if (!lease) return result('Another Instamart cart change is still running. Nothing new was added; reply ' + pick + ' again in a minute.', 'paused', task.id)
  try {
    // update_cart replaces the shared account cart: never start a new write while an earlier one is unverified.
    const {data: pending, error: pendingError} = await supabaseAdmin.from('agent_runs').select('id').eq('telegram_id', owner).eq('type', 'grocery_comparison').eq('status', 'outcome_unknown').limit(1).maybeSingle()
    if (pendingError) return result('I could not check your earlier Instamart cart changes, so I did not add anything. Try again in a minute.', 'blocked', task.id)
    if (pending?.id) return result('An earlier Instamart cart change still needs checking, so I did not add anything. Check it here (reading only): ' + commerceTaskLink(pending.id), 'blocked', task.id)
    const token = await readCommerceConnection(owner, 'swiggy').catch(() => null)
    if (!token) return result('Your Swiggy sign-in has expired, so I did not add anything. Reconnect here, then ask me again: ' + connectLink(), 'blocked', task.id)
    const client = new CommerceMcpClient('swiggy', 'grocery', token.accessToken)
    let saved: CommerceTask
    try {
      saved = await prepareInstamartCart(owner, task, token.accessToken, client, {spinId: chosen.spinId, skuId: chosen.skuId, quantity: 1})
    } catch (error) {
      if (error instanceof CommerceMcpError && error.reason === 'reauth_required') return result('Your Swiggy sign-in has expired, so I did not add anything. Reconnect here, then ask me again: ' + connectLink(), 'blocked', task.id)
      const reason = error instanceof Error ? error.message : ''
      // Before the durable claim nothing was written; after it the executor returns instead of throwing.
      const current = await readCommerceTask(owner, task.id).catch(() => null)
      if (current?.status === 'outcome_unknown') return result('I asked Instamart to add it but could not confirm your cart afterwards. I will not try again automatically. Check the cart here (reading only): ' + commerceTaskLink(task.id) + '\nNo order was placed.', 'outcome_unknown', task.id, true)
      return result(PICK_FAILURES[reason] || 'Swiggy Instamart did not return a result I could verify, so I did not add anything. Try again in a minute.', 'blocked', task.id)
    }
    if (saved.metadata_json.state === 'cart_contents_verified') {
      const url = commerceHandoffUrl('swiggy', CHECKOUT_URL)
      return result(saved.summary + '\n\nReview and pay in the Swiggy app' + (url ? ': ' + url : '.') + '\nYou pay in the Swiggy app; Gogo does not place orders.', 'completed', saved.id, true)
    }
    return result('I asked Instamart to add it but could not confirm your cart afterwards. I will not try again automatically. Check the cart here (reading only): ' + commerceTaskLink(saved.id) + '\nNo order was placed.', 'outcome_unknown', saved.id, true)
  } finally {
    await releaseBrainUserLease(leaseKey, lease.ownerToken).catch(() => false)
  }
}
