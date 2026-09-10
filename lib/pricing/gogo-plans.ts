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

// Canonical India pricing. All public surfaces should read from this catalog.
// Internal/legacy entitlement names remain mapped below so existing paid users
// keep their access while new billing uses the public names and prices.
export const GOGO_INDIA_PLANS: Record<PublicGogoPlanCode, PublicGogoPlan> = {
  free: {
    code:'free', name:'Gogo Free', priceInrMonthly:0,
    positioning:'Meet Gogo', cogsBudgetInr:25, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:0, watcherMode:'Not included',
    highlights:[
      'Talk to Gogo — limited everyday use',
      'Core Gogo Memory',
      'Tasks, Lists & Reminders',
      'Basic Daily Gogo',
      'Try a small number of Agent actions',
    ],
  },
  essential: {
    code:'essential', name:'Gogo Essential', priceInrMonthly:249,
    positioning:'Let Gogo help', cogsBudgetInr:120, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:1, watcherMode:'Adaptive · daily baseline',
    highlights:[
      'Everything in Free with more Gogo capacity',
      'WhatsApp Gogo',
      'Calendar integration',
      'Light connected work',
      'Live flight search',
      'Light Gogo Agent missions',
      '1 adaptive Background Gogo watch',
    ],
  },
  plus: {
    code:'plus', name:'Gogo Plus', priceInrMonthly:499,
    positioning:'Let Gogo handle it', cogsBudgetInr:240, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:3, watcherMode:'Adaptive · faster when useful',
    highlights:[
      'Everything in Essential',
      'Multi-step Gogo Agent missions',
      'Gmail, Calendar, Drive & Contacts',
      'Background Gogo',
      'Gogo Goals & Ideas',
      'Live flights + hotels',
      'Cash vs points travel intelligence',
      'Voice allowance',
      'Artifacts & workspaces',
      'Secure Computer allowance',
    ],
  },
  pro: {
    code:'pro', name:'Gogo Pro', priceInrMonthly:999,
    positioning:'Gogo, take it from here', cogsBudgetInr:480, targetHeavyUserMarginPercent:30,
    activeWebWatchersMax:6, watcherMode:'Adaptive + bounded burst watch',
    highlights:[
      'Everything in Plus',
      'Highest Gogo Agent capacity',
      'More Background Gogo + burst watching',
      'More Goals, voice & Secure Computer time',
      'Priority execution and new capabilities',
      'Advanced travel planning',
      'Booking and transaction preparation',
      'Approved execution as each capability is verified',
    ],
  },
}

// Existing paid users keep their entitlements while billing migrates. Never rewrite
// a subscription merely because the public marketing name changed.
export const LEGACY_PLAN_TO_PUBLIC: Record<string, PublicGogoPlanCode> = {
  free:'free', imported:'free',
  lite:'essential', essential:'essential',
  starter:'plus', plus:'plus',
  pro:'plus', // historical AskGogo Pro maps to the closest new public tier
  gogo_pro:'pro', pro_annual:'pro', power:'pro', founder:'pro', founder_pro:'pro',
}

export function publicPlanForInternalCode(code: string | null | undefined) {
  return GOGO_INDIA_PLANS[LEGACY_PLAN_TO_PUBLIC[String(code || 'free').toLowerCase()] || 'free']
}

export const GOGO_PUBLIC_PRICING_VERSION = 'india-v6-0-249-499-999'
