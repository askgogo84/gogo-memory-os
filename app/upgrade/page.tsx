import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSession } from '@/lib/dashboard/session'
import { waLink } from '@/lib/product-urls'

export const dynamic = 'force-dynamic'

const WA_DASHBOARD_LINK = waLink('dashboard')

type PublicPlan = 'lite' | 'pro' | 'power'

const PLANS: Record<PublicPlan, { amount: number; name: string; features: string[] }> = {
  lite: {
    amount: 99,
    name: 'Lite',
    features: ['60 AI actions/month', '5 active reminders', '10 voice notes/month'],
  },
  pro: {
    amount: 299,
    name: 'Pro',
    features: ['250 AI actions/month', '50 active reminders', '100 voice notes/month', 'Calendar + daily briefing', '30 web searches/month'],
  },
  power: {
    amount: 499,
    name: 'Power',
    features: ['600 AI actions/month', '200 active reminders', '300 voice notes/month', '100 web searches/month', 'Calendar + priority access'],
  },
}

function normalizePlan(value?: string): PublicPlan {
  const clean = String(value || 'pro').toLowerCase().trim().replace(/[\s-]+/g, '_')
  if (clean === 'lite') return 'lite'
  if (clean === 'power' || clean === 'founder' || clean === 'founder_pro') return 'power'
  return 'pro'
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
  const selected = PLANS[planKey]

  const session = await getSession()
  const telegramId = session ? parseInt(session.telegramId, 10) : null

  if (!telegramId || Number.isNaN(telegramId)) {
    return (
      <main style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Sign in to upgrade.</h1>
        <p style={{ color: '#666', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
          Message AskGogo on WhatsApp and send <strong>dashboard</strong> to get your private link, then come back here.
        </p>
        <a href={WA_DASHBOARD_LINK} style={{ display: 'inline-block', background: '#25D366', color: '#fff', padding: '12px 24px', borderRadius: 100, fontSize: 15, fontWeight: 600, textDecoration: 'none' }}>
          Open WhatsApp →
        </a>
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
    <main style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Upgrade to AskGogo {selected.name}</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>7-day free trial · then monthly · cancel anytime</p>
      <div style={{ fontSize: 56, fontWeight: 300, marginBottom: 8 }}>
        <span style={{ fontSize: 24, verticalAlign: 'top' }}>₹</span>
        {selected.amount.toLocaleString('en-IN')}
        <span style={{ fontSize: 16, color: '#999' }}>/month</span>
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '32px 0', textAlign: 'left' }}>
        {selected.features.map((feature) => (
          <li key={feature} style={{ padding: '10px 0', borderBottom: '1px solid #eee', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: '#22c55e' }}>✓</span> {feature}
          </li>
        ))}
      </ul>
      {phoneDigits ? (
        <a href={checkoutHref} style={{ display: 'block', background: '#0a0a0f', color: '#fff', padding: 16, borderRadius: 100, fontSize: 16, fontWeight: 500, textDecoration: 'none', marginBottom: 16 }}>
          Start 7-day free trial →
        </a>
      ) : (
        <a href={WA_DASHBOARD_LINK} style={{ display: 'block', background: '#25D366', color: '#fff', padding: 16, borderRadius: 100, fontSize: 16, fontWeight: 500, textDecoration: 'none', marginBottom: 16 }}>
          Open WhatsApp to continue →
        </a>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap', marginTop: 20 }}>
        {(['lite', 'pro', 'power'] as PublicPlan[]).filter((key) => key !== planKey).map((key) => (
          <a key={key} href={`/upgrade?plan=${key}`} style={{ color: '#666', fontSize: 13, textDecoration: 'underline' }}>
            View {PLANS[key].name}
          </a>
        ))}
      </div>
      <p style={{ fontSize: 12, color: '#999', marginTop: 20 }}>Secured by Razorpay. You authorize once; billing begins after the free trial.</p>
    </main>
  )
}
