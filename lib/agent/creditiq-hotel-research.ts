import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchCreditIQLiveHotels } from '@/lib/integrations/creditiq-travel'
import { buildTravelResearchContext, isPublicTravelResearchRequest } from './travel-research'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function clean(value: unknown, max = 1200) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function priceLabel(hotel: any) {
  const raw = hotel?.price?.amount ?? hotel?.price ?? hotel?.totalPrice ?? hotel?.amount ?? null
  const n = Number(raw)
  const currency = String(hotel?.price?.currency || hotel?.currency || 'INR').toUpperCase()
  if (!Number.isFinite(n)) return 'price available on provider'
  if (currency === 'INR') return `₹${Math.round(n).toLocaleString('en-IN')}`
  return `${currency} ${Math.round(n).toLocaleString('en-IN')}`
}

function hotelName(hotel: any) {
  return clean(hotel?.name || hotel?.hotel?.name || hotel?.property?.name || 'Hotel', 160)
}

function hotelLink(hotel: any) {
  return clean(hotel?.bookingLink || hotel?.url || hotel?.deepLink || hotel?.deeplink || hotel?.redirect_url || '', 1200)
}

export async function tryRunCreditIQHotelResearch(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  if (!isPublicTravelResearchRequest(params.text) || !/\bhotels?\b/i.test(params.text)) return null
  const context = buildTravelResearchContext(params.text)
  if (context.kind !== 'hotel' || !context.destination || !context.startDate) return null

  const checkin = context.startDate
  const checkout = context.endDate && context.endDate > checkin ? addDays(context.endDate, 1) : addDays(checkin, 1)
  const live = await searchCreditIQLiveHotels({
    destination: context.destination.label,
    checkin,
    checkout,
    adults: 1,
    rooms: 1,
  })

  // Missing service auth is configuration, not a user-facing failure. Return null so
  // the existing curated travel fallback can still answer honestly.
  if (!live?.live || !live.hotels.length) return null

  const tg = params.actor.legacyTelegramId
  const now = new Date().toISOString()
  const top = live.hotels.slice(0, 8)
  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(tg), type:'travel_research', capability:'travel', status:'completed',
    title:`Live hotels · ${context.destination.label}`,
    summary:`CreditIQ returned ${top.length} live hotel options.`, progress:100,
    why:'CreditIQ supplied provider-returned live hotel inventory.', source:params.surface,
    metadata_json:{ plan_type:'creditiq_hotel_research', input_text:clean(params.text,1800), context, provider:live.source },
    started_at:now, updated_at:now, completed_at:now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`creditiq_hotel_run_create_failed:${runError?.message || 'unknown'}`)
  const runId = String(run.id)

  const output = { context, liveInventory:live, source:'creditiq', inventoryType:'live-provider' }
  const { error: stepError } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(tg), run_id:runId, ordinal:1, tool_name:'travel',
    title:'Search CreditIQ live hotel inventory', status:'completed',
    input_json:{ destination:context.destination.label, checkin, checkout },
    output_json:output, started_at:now, completed_at:now,
  })
  if (stepError) throw new Error(`creditiq_hotel_step_create_failed:${stepError.message}`)

  const text = `CreditIQ live hotels · ${context.destination.label} · ${checkin} to ${checkout}\nProvider: ${live.source} · fetched ${live.fetchedAt}\n\n${top.map((hotel:any,index:number) => {
    const link = hotelLink(hotel)
    const rating = hotel?.rating ?? hotel?.reviewScore ?? hotel?.score
    const bits = [priceLabel(hotel), rating ? `rating ${rating}` : '', clean(hotel?.area || hotel?.address || hotel?.location || '', 180)].filter(Boolean)
    return `${index + 1}. ${hotelName(hotel)}${bits.length ? `\n${bits.join(' · ')}` : ''}${link ? `\nBooking/provider link: ${link}` : ''}`
  }).join('\n\n')}\n\nThese are provider-returned hotel results through CreditIQ. Availability and final price must be repriced before any approved booking action.`

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(tg), run_id:runId, event_type:'run_completed',
    message:`CreditIQ returned ${top.length} live hotel options.`,
    metadata_json:{ result_count:top.length, provider:live.source, travel_engine:'creditiq' },
  }).catch(()=>{})

  return { runId, status:'completed' as const, capability:'travel' as const, risk:'low' as const, text, handledBy:'creditiq-hotels' as const }
}
