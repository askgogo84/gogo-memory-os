import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from './actor'
import type { AgentCapability, AgentPermissionLevel } from './policy'

const CAPABILITIES:AgentCapability[]=['memory','files','reminders','lists','tasks','email','calendar','browser','contacts','travel','payments']
const LEVELS:AgentPermissionLevel[]=['off','read','draft','ask','auto']

const DEFAULT_LEVEL:Record<AgentCapability,AgentPermissionLevel>={
  memory:'ask',files:'ask',reminders:'auto',lists:'auto',tasks:'auto',
  email:'draft',calendar:'ask',browser:'draft',contacts:'read',travel:'draft',payments:'ask',
}

function clean(value:unknown,max=500){return String(value??'').replace(/\s+/g,' ').trim().slice(0,max)}

function capabilityFrom(value:string):AgentCapability|null{
  const v=clean(value,80).toLowerCase().replace(/[^a-z]/g,'')
  const aliases:Record<string,AgentCapability>={
    memory:'memory',memories:'memory',
    file:'files',files:'files',documents:'files',
    reminder:'reminders',reminders:'reminders',
    list:'lists',lists:'lists',
    task:'tasks',tasks:'tasks',todo:'tasks',todos:'tasks',
    email:'email',emails:'email',mail:'email',gmail:'email',
    calendar:'calendar',meetings:'calendar',meeting:'calendar',
    browser:'browser',web:'browser',website:'browser',
    contact:'contacts',contacts:'contacts',
    travel:'travel',flight:'travel',flights:'travel',hotel:'travel',hotels:'travel',
    payment:'payments',payments:'payments',purchase:'payments',purchases:'payments',
  }
  return aliases[v]||null
}

export function parseAutonomyCommand(text:string):
  |{kind:'status'}
  |{kind:'set';capability:AgentCapability;level:AgentPermissionLevel}
  |null{
  const raw=clean(text,700)
  const lower=raw.toLowerCase()
  if(/^(?:how autonomous are you|what can you do without asking|show(?: me)? (?:my )?autonomy(?: settings)?|what are my autonomy settings)\??$/i.test(raw)){
    return {kind:'status'}
  }

  let m=raw.match(/^set\s+(?:my\s+)?([a-z ]+?)\s+autonomy\s+to\s+(off|read|draft|ask|auto)$/i)
  if(!m)m=raw.match(/^set\s+(off|read|draft|ask|auto)\s+(?:for\s+)?(?:my\s+)?([a-z ]+)$/i) as any
  if(m){
    let capText:string,levelText:string
    if(/^(off|read|draft|ask|auto)$/i.test(String(m[1]||''))){
      levelText=String(m[1]);capText=String(m[2]||'')
    }else{
      capText=String(m[1]||'');levelText=String(m[2]||'')
    }
    const capability=capabilityFrom(capText)
    const level=LEVELS.find(x=>x===levelText.toLowerCase())||null
    if(capability&&level)return {kind:'set',capability,level}
  }

  const more=raw.match(/^be\s+more\s+autonomous\s+with\s+(?:my\s+)?(.+)$/i)
  if(more){
    const capability=capabilityFrom(String(more[1]||''))
    if(capability)return {kind:'set',capability,level:'auto'}
  }

  const ask=raw.match(/^always\s+ask\s+me\s+(?:for|about|before)\s+(?:my\s+)?(.+)$/i)
  if(ask){
    const capability=capabilityFrom(String(ask[1]||''))
    if(capability)return {kind:'set',capability,level:'ask'}
  }

  if(lower==='be less autonomous')return null
  return null
}

async function readLevels(actor:AgentActor){
  const {data,error}=await supabaseAdmin.from('agent_permissions')
    .select('capability,level').eq('telegram_id',String(actor.legacyTelegramId))
  if(error)throw new Error(`autonomy_permission_read_failed:${error.message}`)
  const explicit=new Map<string,AgentPermissionLevel>((data||[]).map((r:any)=>[String(r.capability),String(r.level) as AgentPermissionLevel]))
  return CAPABILITIES.map(capability=>({capability,level:explicit.get(capability)||DEFAULT_LEVEL[capability]}))
}

function levelMeaning(level:AgentPermissionLevel){
  if(level==='off')return 'off'
  if(level==='read')return 'read only'
  if(level==='draft')return 'read + prepare drafts'
  if(level==='ask')return 'ask before execution'
  return 'auto for policy-safe actions'
}

export async function tryRunAdaptiveAutonomyCommand(params:{actor:AgentActor;text:string}){
  const parsed=parseAutonomyCommand(params.text)
  if(!parsed)return null

  if(parsed.kind==='status'){
    const levels=await readLevels(params.actor)
    const lines=levels.map(row=>`• ${row.capability}: *${row.level}* — ${levelMeaning(row.level)}`)
    return {
      runId:'adaptive-autonomy-status',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
      text:`🧭 *Gogo autonomy settings*\n\n${lines.join('\n')}\n\n*Hard safety still wins:* auto never bypasses one-shot approval for irreversible actions, and medium/high-risk consequential email/calendar/browser/travel/payment actions stay approval-gated.\n\nChange one with: *set calendar autonomy to auto* or *set email autonomy to ask*.`,
      handledBy:'adaptive-autonomy',
    }
  }

  const now=new Date().toISOString()
  const {error}=await supabaseAdmin.from('agent_permissions').upsert({
    telegram_id:String(params.actor.legacyTelegramId),
    capability:parsed.capability,
    level:parsed.level,
    updated_at:now,
  },{onConflict:'telegram_id,capability'})
  if(error)throw new Error(`autonomy_permission_update_failed:${error.message}`)

  await supabaseAdmin.from('agent_activity').insert({
    telegram_id:String(params.actor.legacyTelegramId),
    event_type:'autonomy_permission_changed',
    message:`Autonomy changed: ${parsed.capability} → ${parsed.level}`,
    metadata_json:{capability:parsed.capability,level:parsed.level,surface:'whatsapp',explicit_user_request:true},
  }).then(({error})=>{if(error)console.error('AUTONOMY_ACTIVITY_WRITE_FAILED:',error.message)})

  const safety=parsed.level==='auto'
    ? 'I’ll automatically execute only actions the deterministic policy classifies as safe. Consequential or irreversible actions still require approval.'
    : parsed.level==='ask'
      ? 'I’ll ask before execution for this capability.'
      : `This capability is now set to ${levelMeaning(parsed.level)}.`

  return {
    runId:'adaptive-autonomy-set',status:'completed' as const,capability:'orchestrator' as const,risk:'low' as const,
    text:`✅ ${parsed.capability} autonomy is now *${parsed.level}*.\n\n${safety}`,
    handledBy:'adaptive-autonomy',
  }
}
