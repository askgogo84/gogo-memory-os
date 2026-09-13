export type AgentMemoryType =
  | 'working'
  | 'semantic'
  | 'episodic'
  | 'procedural'
  | 'retrieval'
  | 'parametric'
  | 'prospective'

export type ExecutionSurface =
  | 'local_memory'
  | 'connected_account_read'
  | 'partner_api'
  | 'secure_browser'
  | 'device_handoff'
  | 'human_approval'
  | 'payment_handoff'

export type SpecialistAgentId =
  | 'orchestrator'
  | 'travel'
  | 'ticketing'
  | 'food'
  | 'grocery'
  | 'shopping'
  | 'local_services'
  | 'communications'
  | 'documents'
  | 'calendar'
  | 'life_events'
  | 'payments'
  | 'research'
  | 'secure_browser'

export type SpecialistAgentDefinition = {
  id: SpecialistAgentId
  purpose: string
  memories: AgentMemoryType[]
  surfaces: ExecutionSurface[]
  providerFamilies: string[]
  externalMutationRequiresApproval: boolean
  paymentBoundary: 'none' | 'prepare_only' | 'approval_then_handoff'
}

export type SpecialistRoute = {
  primary: SpecialistAgentId
  supporting: SpecialistAgentId[]
  memories: AgentMemoryType[]
  surfaces: ExecutionSurface[]
  externalMutationRequiresApproval: boolean
  paymentBoundary: SpecialistAgentDefinition['paymentBoundary']
  reason: string
}

const ALL_MEMORY: AgentMemoryType[] = ['working','semantic','episodic','procedural','retrieval','parametric','prospective']

export const SPECIALIST_AGENTS: Record<SpecialistAgentId, SpecialistAgentDefinition> = {
  orchestrator: {
    id:'orchestrator', purpose:'Understand the desired outcome, choose specialists, constrain context, sequence work and verify completion.',
    memories:['working','semantic','episodic','procedural','prospective'],
    surfaces:['local_memory','human_approval'], providerFamilies:[], externalMutationRequiresApproval:true, paymentBoundary:'none',
  },
  travel: {
    id:'travel', purpose:'Research and prepare rail, flight, bus, hotel and itinerary outcomes across providers.',
    memories:ALL_MEMORY, surfaces:['local_memory','connected_account_read','partner_api','secure_browser','device_handoff','human_approval','payment_handoff'],
    providerFamilies:['rail','airline','hotel','bus','ota'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  ticketing: {
    id:'ticketing', purpose:'Find, compare, prepare and manage movie, concert, sports and event tickets.',
    memories:ALL_MEMORY, surfaces:['local_memory','connected_account_read','partner_api','secure_browser','device_handoff','human_approval','payment_handoff'],
    providerFamilies:['movie','concert','event','sports'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  food: {
    id:'food', purpose:'Compare restaurants, menus, fees, delivery times, preferences and prepare food orders.',
    memories:['working','semantic','episodic','procedural','retrieval','parametric'],
    surfaces:['local_memory','partner_api','secure_browser','device_handoff','human_approval','payment_handoff'],
    providerFamilies:['restaurant_marketplace','direct_restaurant'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  grocery: {
    id:'grocery', purpose:'Compare basket availability, substitutions, final price and delivery time across quick-commerce/grocery providers.',
    memories:['working','semantic','episodic','procedural','retrieval','parametric'],
    surfaces:['local_memory','partner_api','secure_browser','device_handoff','human_approval','payment_handoff'],
    providerFamilies:['quick_commerce','grocery'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  shopping: {
    id:'shopping', purpose:'Research products, compare landed price, seller quality, delivery, returns, rewards and prepare carts.',
    memories:['working','semantic','episodic','procedural','retrieval','parametric','prospective'],
    surfaces:['local_memory','connected_account_read','partner_api','secure_browser','device_handoff','human_approval','payment_handoff'],
    providerFamilies:['marketplace','brand_store'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  local_services: {
    id:'local_services', purpose:'Find and prepare bookings for appointments, home services, reservations and other local services.',
    memories:['working','semantic','episodic','procedural','retrieval','parametric','prospective'],
    surfaces:['local_memory','partner_api','secure_browser','device_handoff','human_approval','payment_handoff'],
    providerFamilies:['local_service','reservation'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  communications: {
    id:'communications', purpose:'Read approved communication context and prepare messages/email while protecting outbound mutation boundaries.',
    memories:['working','semantic','episodic','procedural','retrieval','parametric'],
    surfaces:['local_memory','connected_account_read','human_approval'], providerFamilies:['gmail','contacts','messaging'], externalMutationRequiresApproval:true, paymentBoundary:'none',
  },
  documents: {
    id:'documents', purpose:'Read, classify, retrieve and track documents, receipts, credentials and expiry evidence.',
    memories:['working','semantic','episodic','procedural','retrieval','prospective'],
    surfaces:['local_memory','connected_account_read'], providerFamilies:['files','drive','email_attachments'], externalMutationRequiresApproval:false, paymentBoundary:'none',
  },
  calendar: {
    id:'calendar', purpose:'Reason over schedule context and prepare calendar mutations with conflict awareness.',
    memories:['working','semantic','episodic','procedural','retrieval','prospective'],
    surfaces:['local_memory','connected_account_read','human_approval'], providerFamilies:['calendar'], externalMutationRequiresApproval:true, paymentBoundary:'none',
  },
  life_events: {
    id:'life_events', purpose:'Maintain long-running state for trips, bookings, purchases, renewals, deadlines and follow-up actions.',
    memories:['working','semantic','episodic','procedural','retrieval','prospective'],
    surfaces:['local_memory','connected_account_read','partner_api','secure_browser','device_handoff','human_approval'], providerFamilies:['life_event'], externalMutationRequiresApproval:true, paymentBoundary:'none',
  },
  payments: {
    id:'payments', purpose:'Own spend authorization, payment preparation, idempotency and final user-controlled payment handoff.',
    memories:['working','semantic','episodic','procedural','retrieval'],
    surfaces:['local_memory','partner_api','device_handoff','human_approval','payment_handoff'], providerFamilies:['payment'], externalMutationRequiresApproval:true, paymentBoundary:'approval_then_handoff',
  },
  research: {
    id:'research', purpose:'Gather fresh public evidence, normalize alternatives and explain trade-offs without executing purchases.',
    memories:['working','semantic','episodic','procedural','retrieval','parametric'],
    surfaces:['local_memory','partner_api','secure_browser'], providerFamilies:['web','catalog','public_data'], externalMutationRequiresApproval:false, paymentBoundary:'none',
  },
  secure_browser: {
    id:'secure_browser', purpose:'Perform permitted web navigation when no safer supported API exists; never bypass anti-bot or authentication controls.',
    memories:['working','episodic','procedural','retrieval'],
    surfaces:['secure_browser','device_handoff','human_approval'], providerFamilies:['web'], externalMutationRequiresApproval:true, paymentBoundary:'prepare_only',
  },
}

function uniq<T>(values:T[]):T[]{return [...new Set(values)]}

export function selectSpecialistRoute(text:string):SpecialistRoute {
  const t=String(text||'').toLowerCase().replace(/\s+/g,' ').trim()
  let primary:SpecialistAgentId='orchestrator', supporting:SpecialistAgentId[]=[]
  let reason='general outcome orchestration'

  if(/\b(train|railway|irctc|flight|airline|hotel|bus|trip|travel|pnr|boarding pass)\b/.test(t)) { primary='travel'; supporting=['research','life_events','calendar']; reason='travel search/booking lifecycle' }
  else if(/\b(movie|cinema|concert|event ticket|match ticket|bookmyshow|ticketmaster|tickets?)\b/.test(t)) { primary='ticketing'; supporting=['research','life_events','calendar']; reason='event/ticket search or lifecycle' }
  else if(/\b(swiggy|zomato|restaurant|order food|food delivery|meal delivery)\b/.test(t)) { primary='food'; supporting=['research','payments']; reason='food ordering/comparison' }
  else if(/\b(blinkit|zepto|instamart|bigbasket|grocer(?:y|ies)|quick commerce)\b/.test(t)) { primary='grocery'; supporting=['research','payments']; reason='grocery basket comparison/order' }
  else if(/\b(amazon|flipkart|myntra|ajio|buy|purchase|shopping|best deal|best price|compare price|cart)\b/.test(t)) { primary='shopping'; supporting=['research','payments','life_events']; reason='commerce research/cart/purchase lifecycle' }
  else if(/\b(appointment|salon|spa|doctor appointment|home service|reservation|table booking)\b/.test(t)) { primary='local_services'; supporting=['research','calendar','life_events']; reason='local service/reservation' }
  else if(/\b(email|gmail|mail|contact|message|reply|forward)\b/.test(t)) { primary='communications'; supporting=['documents']; reason='communication context/action' }
  else if(/\b(calendar|meeting|schedule|appointment)\b/.test(t)) { primary='calendar'; supporting=['life_events']; reason='schedule/calendar outcome' }
  else if(/\b(document|pdf|receipt|passport|visa|license|licence|file|attachment|expiry|expires)\b/.test(t)) { primary='documents'; supporting=['life_events']; reason='document retrieval/lifecycle' }
  else if(/\b(remind|reminder|renewal|deadline|follow up|watch|monitor)\b/.test(t)) { primary='life_events'; supporting=[]; reason='prospective life-event/reminder outcome' }

  const defs=[SPECIALIST_AGENTS[primary],...supporting.map(id=>SPECIALIST_AGENTS[id])]
  const memories=uniq(defs.flatMap(x=>x.memories))
  const surfaces=uniq(defs.flatMap(x=>x.surfaces))
  const needsApproval=defs.some(x=>x.externalMutationRequiresApproval)
  const paymentBoundary=defs.some(x=>x.paymentBoundary==='approval_then_handoff')?'approval_then_handoff':defs.some(x=>x.paymentBoundary==='prepare_only')?'prepare_only':'none'
  return {primary,supporting:uniq(supporting),memories,surfaces,externalMutationRequiresApproval:needsApproval,paymentBoundary,reason}
}

export function specialistDefinition(id:SpecialistAgentId){return SPECIALIST_AGENTS[id]}
