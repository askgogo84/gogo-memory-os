import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { tryResumeAppointmentAfterHumanAuth } from './appointment-auth-resume'
import type { AgentActor } from './actor'
import { resolveIndiaPlace, resultInPlace } from './india-locality'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1200) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function locationHint(text: string) {
  const match = String(text || '').match(/\b(?:in|near|around)\s+([A-Za-z][A-Za-z .'-]{2,45}?)(?=\s+(?:next|this|tomorrow|today|on|for|at|after|before|with|and|but|are|is|that|which|free|available|open|do\s+not|don't)\b|[,.!?]|$)/i)
  return safe(match?.[1] || '', 80)
}

// India-first: a locality resolves to its Indian city ("HSR Layout" -> Bengaluru) and every
// search stays in India.
function locationProfile(location: string) {
  const place = resolveIndiaPlace(location)
  return { canonical: [place.locality && place.locality.toLowerCase() !== place.city.toLowerCase() ? place.locality : '', place.city].filter(Boolean).join(', ') || location, place, querySuffix: place.querySuffix }
}

function serviceHint(text: string) {
  const raw = String(text || '')
  const withProvider = raw.match(/\b(?:appointment|consultation|session)\s+(?:with|at)\s+(?:an?\s+)?([A-Za-z][A-Za-z &.'-]{2,50}?)(?=\s+(?:in|near|around|next|this|tomorrow|today|on|for|at|after|before|and|but)\b|[,.!?]|$)/i)?.[1]
  if (withProvider) return safe(withProvider, 80)
  const sport = raw.match(SPORT)?.[1]
  if (sport) return safe(`${sport.toLowerCase()} court`.replace(/(turf|nets|pool) court$/,'$1'), 80)
  const category = raw.match(/\b(dentist|dental|doctor|physician|dermatologist|cardiologist|ophthalmologist|optometrist|physiotherapist|therapist|psychologist|psychiatrist|clinic|hospital|salon|spa|visa|passport)\b/i)?.[1]
  return safe(category || 'appointment provider', 80)
}

function timingHint(text: string) {
  const match = String(text || '').match(/\b(today|tomorrow|next\s+week|this\s+week|next\s+month|this\s+month|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+20\d{2})?)\b/i)
  return safe(match?.[1] || '', 80)
}

// Muse case 02 (11 Oct): "Which badminton courts near Indiranagar are free this Saturday 7-9 am?"
// was caught by the calendar and reminder routes. Sports venues are found like salons: India-first,
// on Playo/Hudle and venue pages, read-only; booking stays a separate, approved step.
const SPORT = /\b(badminton|tennis|squash|pickleball|table\s+tennis|turf|futsal|football|cricket\s+nets?|box\s+cricket|swimming|basketball|volleyball)\b/i
export function isSportsVenueRequest(raw: string) {
  const text = String(raw || '')
  return SPORT.test(text) && /\b(courts?|turfs?|nets|venues?|grounds?|pools?|slots?|arena)\b/i.test(text)
    && /\b(find|which|where|any|free|available|availability|open|book|booking|slots?)\b/i.test(text)
    && !/\bremind|\breminder\b/i.test(text)
}

export function isAppointmentResearchRequest(raw: string) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return false
  const appointment = /\b(appointment|consultation|doctor|dentist|dental|clinic|dermatologist|physiotherapist|therapist|salon|spa)\b/.test(text)
  if (isSportsVenueRequest(raw)) return true
  const discovery = /\b(find|look for|search|show|compare|available|availability|options?|slot|slots|book|booking|schedule)\b/.test(text)
  const directCalendarMutation = /\b(create|add|move|change)\s+(?:a\s+|an\s+|my\s+)?(?:calendar\s+)?(?:event|appointment)\b/.test(text)
  return appointment && discovery && !directCalendarMutation
}

type AppointmentOption = { title: string; snippet: string; url: string; provider: string; bookableScore: number }

function locationMatch(result: WebSearchResult, location: string) {
  return resultInPlace(`${result.title || ''} ${result.snippet || ''} ${result.url || ''}`, resolveIndiaPlace(location))
}

// Search snippets arrive as scraped page text (markdown, image names, menus). Keep one readable line.
export function readableSnippet(raw: string) {
  const cleaned = String(raw || '')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\S+\.(?:webp|png|jpe?g|svg|gif)\)?/gi, ' ')
    .replace(/#+\s*/g, ' ')
    .replace(/\[\s*\.\.\.\s*\]|\[…\]/g, ' ')
    .replace(/(?:privacy\s*policy|terms\s*of\s*service|terms\s*(?:&|and)\s*conditions|cancellation\s*policy|posh\s*policy|download\s*(?:the\s*)?app|need\s*help\??|minimi[sz]e|close\s*icon|live\s*games\s*\d+)/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned.length <= 180) return cleaned
  const cut = cleaned.slice(0, 180)
  return `${cut.slice(0, Math.max(cut.lastIndexOf('. '), cut.lastIndexOf(' '))).trim()}…`
}

export function appointmentBookableScore(result: Pick<WebSearchResult,'title'|'snippet'|'url'>) {
  const url = String(result.url || '').toLowerCase()
  const text = `${result.title || ''} ${result.snippet || ''}`.toLowerCase()
  let score = 0
  if (/\b(book|booking|appointment|appointments|schedule|slots?|availability|consultation)\b/.test(text)) score += 3
  if (/\/(book|booking|appointment|appointments|schedule|slots?|availability)(\/|\?|$)/.test(url)) score += 6
  if (/book[-_]?appointment|appointment[-_]?booking|schedule[-_]?appointment/.test(url)) score += 6
  if (/\b(book appointment|schedule appointment|request appointment|available slots?)\b/.test(text)) score += 5
  // A site's home page is not a venue or provider (live 11 Oct: playo.co and hudle.in home pages).
  try { if (/^\/?$/.test(new URL(String(result.url || '')).pathname)) score -= 8 } catch {}
  if (/\b(our clinics|locations|about us|blog|services|dentist near me)\b/.test(text) || /\/(our-clinics|locations|about|blog|services)(\/|\?|$)/.test(url)) score -= 4
  return score
}

// Social posts are not places to book (live 11 Oct: an Instagram promo was option 2).
const SOCIAL_HOST = /(?:^|\.)(?:instagram\.com|facebook\.com|fb\.com|youtube\.com|youtu\.be|x\.com|twitter\.com|linkedin\.com|reddit\.com|quora\.com|pinterest\.\w+|threads\.net)$/i

// Courts and turfs in India are booked on these platforms. 11 Oct 18:33: a blog ("Where to play
// badminton in Bengaluru") came first, was picked as option 1, and could not be booked.
export const SPORT_BOOKING_HOST = /(?:^|\.)(?:playo\.co|hudle\.in|khelomore\.com|turftown\.in|bookmyplay\.in)$/i

export function curate(results: WebSearchResult[], location: string, sports = false) {
  const seen = new Set<string>()
  const area = resolveIndiaPlace(location).locality.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  let eligible = results
    .filter(result => result?.url && /^https?:\/\//i.test(result.url) && !SOCIAL_HOST.test(host(result.url)) && locationMatch(result, location))
  // For courts, offer only places that can actually be booked when any exist.
  if (sports && eligible.some(r => SPORT_BOOKING_HOST.test(host(r.url)))) eligible = eligible.filter(r => SPORT_BOOKING_HOST.test(host(r.url)))
  const ranked = eligible
    .map(result => ({ result, score: appointmentBookableScore(result)
      + (sports && SPORT_BOOKING_HOST.test(host(result.url)) ? 10 : 0)
      // The person's own area page ranks above the whole-city page.
      + (sports && area && String(result.url).toLowerCase().includes(area) ? 4 : 0) }))
    .sort((a,b) => b.score - a.score)
  const options: AppointmentOption[] = []
  for (const item of ranked) {
    const result = item.result
    const provider = host(result.url)
    const key = `${provider}|${safe(result.title, 180).toLowerCase()}`
    if (!provider || seen.has(key)) continue
    seen.add(key)
    options.push({ title:safe(result.title || provider,160), snippet:readableSnippet(safe(result.snippet || '',900)), url:result.url, provider, bookableScore:item.score })
    if (options.length >= 6) break
  }
  return options
}

async function activity(tg: number, runId: string, eventType: string, message: string, metadata: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin.from('agent_activity').insert({ telegram_id:String(tg), run_id:runId, event_type:eventType, message:safe(message,900), metadata_json:metadata })
  if (error) console.error('APPOINTMENT_RESEARCH_ACTIVITY_FAILED:', error.message)
}

export async function tryRunAppointmentResearch(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  // Human-auth/provider-block resumes share the same appointment brain on WhatsApp,
  // Dashboard and Agent. The strict matcher inside the resume handler declines all
  // ordinary research requests, so public-inventory discovery remains unchanged.
  const resumed = await tryResumeAppointmentAfterHumanAuth(params)
  if (resumed) return resumed

  if (!isAppointmentResearchRequest(params.text)) return null
  const service = serviceHint(params.text)
  const locationRaw = locationHint(params.text)
  const profile = locationProfile(locationRaw)
  const location = profile.canonical || locationRaw
  const timing = timingHint(params.text)
  // Beauty and wellness are booked on salon pages and Indian listings, not clinic sites.
  const beauty = /\b(salon|spa|haircut|hair|beauty|parlou?r|barber|nails?|massage|facial)\b/i.test(params.text)
  const sports = isSportsVenueRequest(params.text)
  const query = sports
    ? [service, 'booking', profile.querySuffix, 'Playo Hudle'].filter(Boolean).join(' ')
    : beauty
    ? [service === 'appointment provider' ? 'salon' : service, 'near', profile.querySuffix, 'book appointment online'].filter(Boolean).join(' ')
    : [service, 'appointment booking availability', profile.querySuffix, timing, 'official clinic hospital provider'].filter(Boolean).join(' ')
  const fallbackQuery = sports
    ? [service, profile.querySuffix, 'book slot online'].filter(Boolean).join(' ')
    : beauty
    ? [service === 'appointment provider' ? 'salon' : service, profile.querySuffix, 'Justdial Fresha Google reviews book'].filter(Boolean).join(' ')
    : [service, profile.querySuffix, 'Practo book appointment online'].filter(Boolean).join(' ')
  const tg = params.actor.legacyTelegramId
  const now = new Date().toISOString()

  const { data: run, error: runError } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id:String(tg), type:'appointment_research', capability:'browser', status:'running',
    title:`Appointment search · ${service}${location ? ` · ${location}` : ''}`,
    summary:'Gogo is finding appointment providers and booking paths without changing anything.', progress:20,
    why:'Provider discovery is read-only. Booking, confirmation and payment remain behind approval.', source:params.surface,
    metadata_json:{ plan_type:'appointment_research', input_text:safe(params.text,1800), service, location:location || null, timing:timing || null, query, fallbackQuery, readOnly:true, mutated:false },
    started_at:now, updated_at:now,
  }).select('id').single()
  if (runError || !run?.id) throw new Error(`appointment_research_run_create_failed:${runError?.message || 'unknown'}`)
  const runId = String(run.id)
  const { data: step, error: stepError } = await supabaseAdmin.from('agent_steps').insert({
    telegram_id:String(tg), run_id:runId, ordinal:1, tool_name:'web_search', title:'Find appointment providers and booking paths', status:'running',
    input_json:{ query, fallbackQuery, service, location, timing }, output_json:{}, started_at:now,
  }).select('id').single()
  if (stepError || !step?.id) throw new Error(`appointment_research_step_create_failed:${stepError?.message || 'unknown'}`)
  await activity(tg, runId, 'run_started', `Gogo started appointment discovery for ${service}.`, { query, location })

  try {
    const primary = await searchWebResults(query)
    const sportsSearch = isSportsVenueRequest(params.text)
    let options = curate(primary, location, sportsSearch)
    let usedFallback = false
    if ((!options.length || (options[0]?.bookableScore ?? 0) < 3) && fallbackQuery !== query) {
      const secondary = await searchWebResults(fallbackQuery)
      options = curate([...primary, ...secondary], location, sportsSearch)
      usedFallback = true
    }
    const completedAt = new Date().toISOString()
    await supabaseAdmin.from('agent_steps').update({ status:'completed', output_json:{ options, query, fallbackQuery, usedFallback, verifiedStore:'public-web', locationStrict:true, bookableRanked:true, mutated:false }, completed_at:completedAt }).eq('id',String(step.id))

    const sportsVenue = isSportsVenueRequest(params.text)
    const heading = sportsVenue ? `Places to book ${service}s` : `Appointment options · ${service}`
    const text = options.length
      ? `${heading}${location ? ` · ${location}` : ''}${timing ? ` · ${timing}` : ''}\n\n${options.map((o,i) => `${i+1}. ${o.title}\n${o.snippet ? `${o.snippet}\n` : ''}Booking/provider page: ${o.url}`).join('\n\n')}\n\n${sportsVenue
        ? `I haven't checked live slots or booked anything. Reply *open option 1* (or any number) and I'll open that booking page and look for your time before asking you to approve anything.`
        : `I put direct booking pages first. I haven't checked live slots or changed anything. Reply *open option 1* (or any number) and I'll open that booking page before asking you to approve anything.`}`
      : `I couldn't find a provider page I can verify for ${service}${location ? ` in ${location}` : ''}. I rejected results from other cities/countries rather than showing you the wrong location. I did not invent availability or change anything.`

    await supabaseAdmin.from('agent_runs').update({
      status:'completed', summary:safe(text,1800), progress:100, completed_at:completedAt, updated_at:completedAt,
      metadata_json:{ plan_type:'appointment_research', input_text:safe(params.text,1800), service, location:location || null, timing:timing || null, query, fallbackQuery, usedFallback,
        options:options.map((o,index)=>({ index:index+1,title:o.title,provider:o.provider,url:o.url,bookableScore:o.bookableScore })), readOnly:true, mutated:false, locationStrict:true, bookableRanked:true },
    }).eq('id',runId).eq('telegram_id',String(tg))
    await activity(tg,runId,'run_completed',options.length ? `Found ${options.length} location-matched appointment provider paths.` : 'No location-matched appointment provider path found.',{ result_count:options.length,location,location_strict:true,bookable_ranked:true })
    return { runId,status:'completed' as const,capability:'browser' as const,risk:'low' as const,text,handledBy:'appointment-research' as const,readOnly:true,mutated:false }
  } catch (error:any) {
    const message = safe(error?.message || 'appointment_research_failed',500)
    const completedAt = new Date().toISOString()
    await Promise.resolve(supabaseAdmin.from('agent_steps').update({status:'failed',error:message,completed_at:completedAt}).eq('id',String(step.id))).catch(()=>{})
    await Promise.resolve(supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete appointment discovery.',error:message,completed_at:completedAt,updated_at:completedAt}).eq('id',runId).eq('telegram_id',String(tg))).catch(()=>{})
    await activity(tg,runId,'run_failed','Appointment discovery failed.',{error:message})
    throw error
  }
}

