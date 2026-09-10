export type PublicGogoPlanCode = 'free' | 'essential' | 'plus' | 'pro'

export type PublicGogoPlan = {
  code: PublicGogoPlanCode
  name: string
  priceInrMonthly: number
  positioning: string
  cogsBudgetInr: number
  targetHeavyUserMarginPercent: number
  activeWebWatchersMax: number
  watcherMode: string
  highlights: string[]
}

export const GOGO_INDIA_PLANS: Record<PublicGogoPlanCode, PublicGogoPlan> = {
  free: {
    code:'free', name:'Gogo', priceInrMonthly:0,
    positioning:'Meet Gogo', cogsBudgetInr:25, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:0, watcherMode:'Not included',
    highlights:['Talk to Gogo','Basic Gogo Memory','Tasks, Lists & Reminders','Basic Daily Gogo'],
  },
  essential: {
    code:'essential', name:'Gogo Essential', priceInrMonthly:249,
    positioning:'Let Gogo help', cogsBudgetInr:120, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:1, watcherMode:'Adaptive · daily baseline',
    highlights:['More Gogo capacity','WhatsApp Gogo','Calendar','Light connected work','1 Background Gogo watch'],
  },
  plus: {
    code:'plus', name:'Gogo Plus', priceInrMonthly:499,
    positioning:'Let Gogo work', cogsBudgetInr:240, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:3, watcherMode:'Adaptive · faster when useful',
    highlights:['Multi-step Gogo Agent','Connected apps','Background Gogo','Goals & Ideas','Live travel intelligence','Cash vs points intelligence','Voice allowance','Secure Computer allowance'],
  },
  pro: {
    code:'pro', name:'Gogo Pro', priceInrMonthly:999,
    positioning:'Let Gogo handle it', cogsBudgetInr:480, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:6, watcherMode:'Adaptive + bounded burst watch',
    highlights:['Highest Gogo capacity','More Background Gogo','More Goals','More voice','More Secure Computer time','Priority capabilities','Approved booking/transaction features as they become verified'],
  },
}

// Existing paid users keep their entitlements while billing migrates. Never rewrite
// a subscription merely because the public marketing name changed.
export const LEGACY_PLAN_TO_PUBLIC: Record<string, PublicGogoPlanCode> = {
  free:'free', imported:'free',
  lite:'essential', essential:'essential',
  starter:'plus', plus:'plus',
  pro:'pro', pro_annual:'pro', power:'pro', founder_pro:'pro',
}

export function publicPlanForInternalCode(code: string | null | undefined) {
  return GOGO_INDIA_PLANS[LEGACY_PLAN_TO_PUBLIC[String(code || 'free').toLowerCase()] || 'free']
}

export const GOGO_PUBLIC_PRICING_VERSION = 'india-v5-0-249-499-999'
