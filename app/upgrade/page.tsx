import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSession } from '@/lib/dashboard/session'
import { waLink } from '@/lib/product-urls'
import { GOGO_INDIA_PLANS } from '@/lib/pricing/gogo-plans'

export const dynamic = 'force-dynamic'

const WA_DASHBOARD_LINK = waLink('dashboard')

type PaidPlan = 'essential' | 'plus' | 'pro'

const PAID: PaidPlan[] = ['essential','plus','pro']

function normalizePlan(value?: string): PaidPlan {
  const clean = String(value || 'plus').toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (clean === 'essential' || clean === 'lite') return 'essential'
  if (clean === 'pro' || clean === 'gogo_pro' || clean === 'power' || clean === 'founder' || clean === 'founder_pro') return 'pro'
  return 'plus'
}

function digitsOnly(value?: string | null) {
  return String(value || '').replace(/\D/g, '')
}

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const params = await searchParams
  const planKey = normalizePlan(params.plan)
  const selected = GOGO_INDIA_PLANS[planKey]

  const session = await getSession()
  const telegramId = session ? parseInt(session.telegramId, 10) : null

  if (!telegramId || Number.isNaN(telegramId)) {
    return (
      <main className="min-h-screen bg-gogo-cream px-6 py-20 text-center text-gogo-ink">
        <div className="mx-auto max-w-md rounded-[32px] border border-gogo-ink/8 bg-gogo-surface p-8 shadow-[0_28px_80px_rgba(22,19,15,.08)]">
          <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-gogo-teal">AskGogo</div>
          <h1 className="mt-3 font-serif text-4xl font-normal">Sign in to upgrade.</h1>
          <p className="mt-4 text-sm leading-6 text-gogo-ink-3">Message Gogo on WhatsApp and send <strong>dashboard</strong> to get your private link, then come back here.</p>
          <a href={WA_DASHBOARD_LINK} className="mt-7 inline-flex rounded-full bg-gogo-ink px-6 py-3 text-sm font-semibold text-gogo-cream">Open WhatsApp →</a>
        </div>
      </main>
    )
  }

  const { data: user } = await supabaseAdmin
    .from('users')
    .select('name, tier, whatsapp_id, phone')
    .eq('telegram_id', telegramId)
    .single()

  const phoneDigits = digitsOnly(user?.whatsapp_id || user?.phone)
  const phoneParam = phoneDigits ? `&phone=${encodeURIComponent(`+${phoneDigits}`)}` : ''
  const checkoutHref = `/pay?plan=${planKey}${phoneParam}`

  return (
    <main className="min-h-screen bg-gogo-cream px-5 py-10 text-gogo-ink sm:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="text-center">
          <div className="text-[10px] font-semibold uppercase tracking-[.18em] text-gogo-teal">Choose how much Gogo carries</div>
          <h1 className="mt-3 font-serif text-5xl font-normal tracking-[-.03em] sm:text-6xl">{selected.name}</h1>
          <p className="mt-3 text-sm text-gogo-ink-3">{selected.positioning}</p>
          <div className="mt-6 font-serif text-6xl font-normal">₹{selected.priceInrMonthly.toLocaleString('en-IN')}<span className="font-sans text-base text-gogo-ink-4">/month</span></div>
          <p className="mt-2 text-xs text-gogo-ink-4">7-day free trial · monthly · cancel anytime</p>
        </div>

        <div className="mx-auto mt-8 max-w-xl rounded-[30px] border border-gogo-ink/8 bg-gogo-surface p-6 shadow-[0_24px_70px_rgba(22,19,15,.07)] sm:p-8">
          <ul className="grid gap-3 text-sm text-gogo-ink-2">
            {selected.highlights.map((feature) => (
              <li key={feature} className="flex gap-3 border-b border-gogo-ink/6 pb-3 last:border-0 last:pb-0"><span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-gogo-teal" />{feature}</li>
            ))}
          </ul>
          {phoneDigits ? (
            <a href={checkoutHref} className="mt-7 flex min-h-13 items-center justify-center rounded-full bg-gogo-ink px-6 text-sm font-semibold text-gogo-cream transition hover:bg-gogo-teal">
              Start 7-day free trial →
            </a>
          ) : (
            <a href={WA_DASHBOARD_LINK} className="mt-7 flex min-h-13 items-center justify-center rounded-full bg-gogo-ink px-6 text-sm font-semibold text-gogo-cream">
              Open WhatsApp to continue →
            </a>
          )}
        </div>

        <div className="mt-7 flex flex-wrap justify-center gap-2">
          {PAID.filter((key) => key !== planKey).map((key) => (
            <a key={key} href={`/upgrade?plan=${key}`} className="rounded-full border border-gogo-ink/10 bg-gogo-surface px-4 py-2 text-xs font-semibold text-gogo-ink-3 hover:border-gogo-teal/30 hover:text-gogo-teal">
              {GOGO_INDIA_PLANS[key].name} · ₹{GOGO_INDIA_PLANS[key].priceInrMonthly}
            </a>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-gogo-ink-4">Secured by Razorpay. New subscriptions use the current Gogo plan and price; existing subscriptions are not changed automatically.</p>
      </div>
    </main>
  )
}
