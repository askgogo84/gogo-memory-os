import { supabaseAdmin } from './supabase-admin'

// Stable internal entitlement keys. Public names/prices are Gogo Free,
// Gogo Essential, Gogo Plus and Gogo Pro. Existing Starter users remain valid.
type PlanKey = 'free' | 'lite' | 'starter' | 'pro' | 'founder_pro'

export type UsageKind =
  | 'ai_action'
  | 'voice_note'
  | 'web_search'
  | 'calendar_event'
  | 'reminder_create'

type PlanLimit = {
  label: string
  priceInr: number
  monthlyActions: number
  dailyActions: number
  activeReminders: number
  voiceNotesMonthly: number
  webSearchesMonthly: number
  calendarEventsMonthly: number
  friendRemindersDaily: number
  costGuardrailInr: number
}

const LIMITS: Record<PlanKey, PlanLimit> = {
  free: {
    label: 'Gogo Free', priceInr: 0,
    monthlyActions: 25, dailyActions: 10, activeReminders: 3,
    voiceNotesMonthly: 5, webSearchesMonthly: 3, calendarEventsMonthly: 3,
    friendRemindersDaily: 5, costGuardrailInr: 25,
  },
  // Stable entitlement behind public Gogo Essential.
  lite: {
    label: 'Gogo Essential', priceInr: 249,
    monthlyActions: 120, dailyActions: 30, activeReminders: 20,
    voiceNotesMonthly: 20, webSearchesMonthly: 15, calendarEventsMonthly: 30,
    friendRemindersDaily: 20, costGuardrailInr: 120,
  },
  // Historical entitlement only; no longer sold.
  starter: {
    label: 'Starter (legacy)', priceInr: 149,
    monthlyActions: 100, dailyActions: 25, activeReminders: 10,
    voiceNotesMonthly: 30, webSearchesMonthly: 10, calendarEventsMonthly: 20,
    friendRemindersDaily: 20, costGuardrailInr: 95,
  },
  // Stable entitlement behind public Gogo Plus.
  pro: {
    label: 'Gogo Plus', priceInr: 499,
    monthlyActions: 300, dailyActions: 75, activeReminders: 75,
    voiceNotesMonthly: 120, webSearchesMonthly: 45, calendarEventsMonthly: 150,
    friendRemindersDaily: 75, costGuardrailInr: 240,
  },
  // Stable entitlement behind public Gogo Pro.
  founder_pro: {
    label: 'Gogo Pro', priceInr: 999,
    monthlyActions: 750, dailyActions: 180, activeReminders: 250,
    voiceNotesMonthly: 350, webSearchesMonthly: 120, calendarEventsMonthly: 400,
    friendRemindersDaily: 250, costGuardrailInr: 480,
  },
}

function currentMonthKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit' })
}
function currentDayKey() {
  return new Date().toLocaleDateString('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit', day:'2-digit' })
}
function nextResetLabel() {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Kolkata', year:'numeric', month:'2-digit' }).formatToParts(now)
  const year = Number(parts.find((p) => p.type === 'year')?.value || now.getUTCFullYear())
  const month = Number(parts.find((p) => p.type === 'month')?.value || now.getUTCMonth() + 1)
  const nextMonthAnchor = new Date(Date.UTC(year, month, 1, 0, 0, 0))
  return new Intl.DateTimeFormat('en-IN', { timeZone:'Asia/Kolkata', day:'numeric', month:'short' }).format(nextMonthAnchor)
}

function normalizeTier(tier?: string | null): PlanKey {
  const clean = (tier || 'free').toLowerCase().trim().replace(/[\s-]+/g,'_')
  if (clean === 'lite' || clean === 'essential') return 'lite'
  if (clean === 'starter') return 'starter'
  if (clean === 'pro' || clean === 'plus' || clean === 'gogo_plus') return 'pro'
  if (['power','founder','founder_pro','gogo_pro'].includes(clean)) return 'founder_pro'
  return 'free'
}

function usageMemoryPrefix(kind: UsageKind, periodKey: string) { return `ASKGOGO_USAGE:${kind}:${periodKey}:` }
function usageBar(used: number, limit: number) {
  const total = 5
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0
  const filled = Math.max(0, Math.min(total, Math.ceil(ratio * total)))
  return '🟩'.repeat(filled) + '⬜'.repeat(total - filled)
}
function usageLine(label: string, used: number, limit: number, suffix = '') {
  const remaining = Math.max(limit - used, 0)
  return `*${label}*\n${used} / ${limit} used${suffix}\n${usageBar(used, limit)} ${remaining} left`
}

function recommendedPlan(tier: PlanKey) {
  if (tier === 'free') return `Gogo Essential — ₹249/month\nLet Gogo help with more memory, Calendar, live search and light Agent missions.`
  if (tier === 'lite' || tier === 'starter') return `Gogo Plus — ₹499/month\nLet Gogo handle multi-step missions, connected apps, Background Gogo, Goals, Ideas and travel intelligence.`
  if (tier === 'pro') return `Gogo Pro — ₹999/month\nHighest Gogo capacity, more Background work, voice, Secure Computer time and priority capabilities.`
  return `You’re already on Gogo Pro — the highest plan. 🟢`
}

function buildLimitReachedMessage(params: { planLabel:string; limitLabel:string; limitValue:number }) {
  return (
    `⚡ *You’ve reached your current Gogo capacity*\n\n` +
    `You’re on *${params.planLabel}* and have reached the ${params.limitLabel} allowance of *${params.limitValue}*.\n\n` +
    `Choose how much Gogo carries:\n` +
    `• Gogo Essential — ₹249/month — Let Gogo help\n` +
    `• Gogo Plus — ₹499/month — Let Gogo handle it\n` +
    `• Gogo Pro — ₹999/month — Highest Gogo capacity\n\n` +
    `Reply *upgrade* to pick a plan.\n` +
    `Reply *usage* to see your current capacity.`
  )
}

async function getUserPlan(telegramId: number) {
  const { data: user } = await supabaseAdmin.from('users').select('tier, daily_count, last_reset, tier_expires_at').eq('telegram_id', telegramId).single()
  if (!user) return { user:null, tier:'free' as PlanKey, plan:LIMITS.free }
  let tier = normalizeTier(user.tier)
  if (user.tier_expires_at && new Date(user.tier_expires_at) < new Date()) {
    tier = 'free'
    await supabaseAdmin.from('users').update({ tier:'free' }).eq('telegram_id', telegramId)
  }
  return { user, tier, plan:LIMITS[tier] }
}

async function countUsageFromMemories(telegramId:number, kind:UsageKind, periodKey:string) {
  const prefix = usageMemoryPrefix(kind, periodKey)
  const { count } = await supabaseAdmin.from('memories').select('id',{count:'exact',head:true}).eq('telegram_id',telegramId).like('content',`${prefix}%`)
  return count || 0
}

export async function logUsage(telegramId:number, kind:UsageKind, meta?:Record<string,any>) {
  const monthKey=currentMonthKey(); const dayKey=currentDayKey()
  await supabaseAdmin.from('memories').insert({ telegram_id:telegramId, content:usageMemoryPrefix(kind,monthKey)+JSON.stringify({kind,monthKey,dayKey,meta:meta||{},created_at:new Date().toISOString()}) })
  if(kind==='ai_action') await supabaseAdmin.from('memories').insert({ telegram_id:telegramId, content:usageMemoryPrefix(kind,dayKey)+JSON.stringify({kind,monthKey,dayKey,meta:meta||{},created_at:new Date().toISOString()}) })
}

async function getActiveReminderCount(telegramId:number) {
  const { count }=await supabaseAdmin.from('reminders').select('id',{count:'exact',head:true}).eq('telegram_id',telegramId).eq('sent',false)
  return count||0
}

export async function checkFeatureLimit(telegramId:number, kind:UsageKind):Promise<{allowed:boolean;tier:PlanKey;plan:PlanLimit;used:number;limit:number;upgradeMessage?:string}> {
  const {tier,plan}=await getUserPlan(telegramId); const monthKey=currentMonthKey()
  if(kind==='reminder_create'){
    const used=await getActiveReminderCount(telegramId); const limit=plan.activeReminders
    if(used>=limit)return{allowed:false,tier,plan,used,limit,upgradeMessage:buildLimitReachedMessage({planLabel:plan.label,limitLabel:'active reminders',limitValue:limit})}
    return{allowed:true,tier,plan,used,limit}
  }
  let limit=0
  if(kind==='voice_note')limit=plan.voiceNotesMonthly
  if(kind==='web_search')limit=plan.webSearchesMonthly
  if(kind==='calendar_event')limit=plan.calendarEventsMonthly
  if(kind==='ai_action')limit=plan.monthlyActions
  const used=await countUsageFromMemories(telegramId,kind,monthKey)
  if(used>=limit)return{allowed:false,tier,plan,used,limit,upgradeMessage:buildLimitReachedMessage({planLabel:plan.label,limitLabel:kind==='voice_note'?'monthly voice notes':kind==='web_search'?'monthly web searches':kind==='calendar_event'?'monthly calendar events':'monthly AI actions',limitValue:limit})}
  return{allowed:true,tier,plan,used,limit}
}

export async function checkAndIncrementLimit(telegramId:number):Promise<{allowed:boolean;tier:string;remaining:number;monthlyLimit:number;usedThisMonth:number;upgradeMessage?:string}> {
  const {user,tier,plan}=await getUserPlan(telegramId)
  if(!user){ await logUsage(telegramId,'ai_action'); return{allowed:true,tier:'free',remaining:plan.monthlyActions-1,monthlyLimit:plan.monthlyActions,usedThisMonth:1} }
  const monthKey=currentMonthKey(); const dayKey=currentDayKey(); let usedCount=user.daily_count||0
  if(user.last_reset!==monthKey){ usedCount=0; await supabaseAdmin.from('users').update({daily_count:0,last_reset:monthKey}).eq('telegram_id',telegramId) }
  const dailyUsed=await countUsageFromMemories(telegramId,'ai_action',dayKey)
  if(dailyUsed>=plan.dailyActions)return{allowed:false,tier,remaining:Math.max(plan.monthlyActions-usedCount,0),monthlyLimit:plan.monthlyActions,usedThisMonth:usedCount,upgradeMessage:buildLimitReachedMessage({planLabel:plan.label,limitLabel:'daily AI actions',limitValue:plan.dailyActions})}
  const remainingBefore=plan.monthlyActions-usedCount
  if(remainingBefore<=0)return{allowed:false,tier,remaining:0,monthlyLimit:plan.monthlyActions,usedThisMonth:usedCount,upgradeMessage:buildLimitReachedMessage({planLabel:plan.label,limitLabel:'monthly AI actions',limitValue:plan.monthlyActions})}
  const newUsedCount=usedCount+1
  await supabaseAdmin.from('users').update({daily_count:newUsedCount}).eq('telegram_id',telegramId)
  await logUsage(telegramId,'ai_action')
  return{allowed:true,tier,remaining:Math.max(plan.monthlyActions-newUsedCount,0),monthlyLimit:plan.monthlyActions,usedThisMonth:newUsedCount}
}

export async function getUsageStatusReply(telegramId:number) {
  const {user,tier,plan}=await getUserPlan(telegramId); const monthKey=currentMonthKey()
  const monthlyActionsUsed=user?.daily_count||0
  const activeReminders=await getActiveReminderCount(telegramId)
  const voiceUsed=await countUsageFromMemories(telegramId,'voice_note',monthKey)
  const webUsed=await countUsageFromMemories(telegramId,'web_search',monthKey)
  const calendarUsed=await countUsageFromMemories(telegramId,'calendar_event',monthKey)
  const resetLabel=nextResetLabel()
  return (
    `📊 *Gogo capacity*\n\nPlan: *${plan.label}*\nResets on: *${resetLabel}*\n\n`+
    `${usageLine('AI actions',monthlyActionsUsed,plan.monthlyActions,' this month')}\n\n`+
    `${usageLine('Active reminders',activeReminders,plan.activeReminders)}\n\n`+
    `${usageLine('Voice notes',voiceUsed,plan.voiceNotesMonthly,' this month')}\n\n`+
    `${usageLine('Calendar events',calendarUsed,plan.calendarEventsMonthly,' this month')}\n\n`+
    `${usageLine('Web searches',webUsed,plan.webSearchesMonthly,' this month')}\n\n`+
    `💡 *Best next plan*\n${recommendedPlan(tier)}\n\nReply *pricing* to see all plans.`
  )
}

export function getPlanLimits(){ return LIMITS }
export function getFriendReminderCap(tier?:string|null):number { return LIMITS[normalizeTier(tier)].friendRemindersDaily }
