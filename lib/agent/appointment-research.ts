import { supabaseAdmin } from '@/lib/supabase-admin'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'
import { redactSecretShapedText } from '@/lib/bot/memory-redaction'
import { tryResumeAppointmentAfterHumanAuth } from './appointment-auth-resume'
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'

function safe(value: unknown, max = 1200) {
  return redactSecretShapedText(String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max))
}

function host(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, '') } catch { return '' }
}

function locationHint(text: string) {
  const match = String(text || '').match(/\b(?:in|near|around)\s+([A-Za-z][A-Za-z .'-]{2,45}?)(?=\s+(?:next|this|tomorrow|today|on|for|at|after|before|with|and|but|do\s+not|don't)\b|[,.!?]|$)/i)
  return safe(match?.[1] || '', 80)
}

function locationProfile(location: string) {
  const l = String(location || '').trim().toLowerCase()
  if (!l) return { canonical:'', aliases:[] as string[], querySuffix:'' }
  if (/\b(bangalore|bengaluru|blr)\b/.test(l)) {
    return { canonical:'Bengaluru', aliases:['bengaluru','bangalore','blr','karnataka','india'], querySuffix:'Bengaluru Bangalore Karnataka India' }
  }
  return { canonical:location, aliases:[l], querySuffix:location }
}

function serviceHint(text: string) {
  const raw = String(text || '')
  const withProvider = raw.match(/\b(?:appointment|consultation|session)\s+(?:with|at)\s+(?:an?\s+)?([A-Za-z][A-Za-z &.'-]{2,50}?)(?=\s+(?:in|near|around|next|this|tomorrow|today|on|for|at|after|before|and|but)\b|[,.!?]|$)/i)?.[1]
  if (withProvider) return safe(withProvider, 80)
  const category = raw.match(/\b(dentist|dental|doctor|physician|dermatologist|cardiologist|ophthalmologist|optometrist|physiotherapist|therapist|psychologist|psychiatrist|clinic|hospital|salon|spa|visa|passport)\b/i)?.[1]
  return safe(category || 'appointment provider', 80)
}

function timingHint(text: string) {
  const match = String(text || '').match(/\b(today|tomorrow|next\s+week|this\s+week|next\s+month|this\s+month|(?:mon|tue|wed|thu|fri|sat|sun)(?:day)?|\d{1,2}\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+20\d{2})?)\b/i)
  return safe(match?.[1] || '', 80)
}

export function isAppointmentResearchRequest(raw: string) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return false
  const appointment = /\b(appointment|consultation|doctor|dentist|dental|clinic|dermatologist|physiotherapist|therapist|salon|spa)\b/.test(text)
  const discovery = /\b(find|look for|search|show|compare|available|availability|options?|slot|slots|book|booking|schedule)\b/.test(text)
  const directCalendarMutation = /\b(create|add|move|change)\s+(?:a\s+|an\s+|my\s+)?(?:calendar\s+)?(?:event|appointment)\b/.test(text)
  return appointment && discovery && !directCalendarMutation
}

type AppointmentOption = { title: string; snippet: string; url: string; provider: string; bookableScore: number }

const WRONG_GEO = /\b(dubai|sharjah|abu dhabi|fujairah|uae|united arab emirates|qatar|doha|singapore|london|new york|california|texas)\b/i

function locationMatch(result: WebSearchResult, location: string) {
  const profile = locationProfile(location)
  if (!profile.aliases.length) return true
  const haystack = `${result.title || ''} ${result.snippet || ''} ${result.url || ''}`.toLowerCase()
  if (WRONG_GEO.test(haystack) && !profile.aliases.some(alias => haystack.includes(alias))) return false
  return profile.aliases.some(alias => haystack.includes(alias))
}

export function appointmentBookableScore(result: Pick<WebSearchResult,'title'|'snippet'|'url'>) {
  const url = String(result.url || '').toLowerCase()
  const text = `${result.title || ''} ${result.snippet || ''}`.toLowerCase()
  let score = 0
  if (/\b(book|booking|appointment|appointments|schedule|slots?|availability|consultation)\b/.test(text)) score += 3
  if (/\/(book|booking|appointment|appointments|schedule|slots?|availability)(\/|\?|$)/.test(url)) score += 6
  if (/book[-_]?appointment|appointment[-_]?booking|schedule[-_]?appointment/.test(url)) score += 6
  if (/\b(book appointment|schedule appointment|request appointment|available slots?)\b/.test(text)) score += 5
  if (/\b(our clinics|locations|about us|blog|services|dentist near me)\b/.test(text) || /\/(our-clinics|locations|about|blog|services)(\/|\?|$)/.test(url)) score -= 4
  return score
}

function curate(results: WebSearchResult[], location: string) {
  const seen = new Set<string>()
  const ranked = results
    .filter(result => result?.url && /^https?:\/\//i.test(result.url) && locationMatch(result, location))
    .map(result => ({ result, score: appointmentBookableScore(result) }))
    .sort((a,b) => b.score - a.score)
  const options: AppointmentOption[] = []
  for (const item of ranked) {
    const result = item.result
    const provider = host(result.url)
    const key = `${provider}|${safe(result.title, 180).toLowerCase()}`
    if (!provider || seen.has(key)) continue
    seen.add(key)
    options.push({ title:safe(result.title || provider,220), snippet:safe(result.snippet || '',520), url:result.url, provider, bookableScore:item.score })
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
  const query = [service, 'appointment booking availability', profile.querySuffix || location, timing, 'official clinic hospital provider'].filter(Boolean).join(' ')
  const fallbackQuery = [service, profile.querySuffix || location, 'book appointment online official'].filter(Boolean).join(' ')
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
    let options = curate(primary, location)
    let usedFallback = false
    if ((!options.length || (options[0]?.bookableScore ?? 0) < 3) && fallbackQuery !== query) {
      const secondary = await searchWebResults(fallbackQuery)
      options = curate([...primary, ...secondary], location)
      usedFallback = true
    }
    const completedAt = new Date().toISOString()
    await supabaseAdmin.from('agent_steps').update({ status:'completed', output_json:{ options, query, fallbackQuery, usedFallback, verifiedStore:'public-web', locationStrict:true, bookableRanked:true, mutated:false }, completed_at:completedAt }).eq('id',String(step.id))

    const text = options.length
      ? `Appointment options · ${service}${location ? ` · ${location}` : ''}${timing ? ` · ${timing}` : ''}\n\n${options.map((o,i) => `${i+1}. ${o.title}\n${o.snippet ? `${o.snippet}\n` : ''}Booking/provider page: ${o.url}`).join('\n\n')}\n\nI ranked direct booking/appointment paths ahead of generic clinic pages where possible. I have not claimed a slot is live and I changed nothing. Tell me which option to prepare and Gogo can inspect the provider flow without confirming anything.`
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
    await supabaseAdmin.from('agent_steps').update({status:'failed',error:message,completed_at:completedAt}).eq('id',String(step.id)).catch(()=>{})
    await supabaseAdmin.from('agent_runs').update({status:'failed',summary:'Gogo could not complete appointment discovery.',error:message,completed_at:completedAt,updated_at:completedAt}).eq('id',runId).eq('telegram_id',String(tg)).catch(()=>{})
    await activity(tg,runId,'run_failed','Appointment discovery failed.',{error:message})
    throw error
  }
}
