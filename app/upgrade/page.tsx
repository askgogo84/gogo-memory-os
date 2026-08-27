import { supabaseAdmin } from '@/lib/supabase-admin'
import { createPaymentLink } from '@/lib/razorpay'
import { getSession } from '@/lib/dashboard/session'
import { waLink } from '@/lib/product-urls'

export const dynamic = 'force-dynamic'

const WA_DASHBOARD_LINK = waLink('dashboard')

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>
}) {
  const params = await searchParams
  const plan = params.plan || 'pro'

  // Identity comes from the dashboard session cookie, never from the URL. This
  // closes the old ?id=<telegramId> IDOR: previously anyone could open anyone's
  // checkout (and leak that user's name into Razorpay / mis-attribute a payment)
  // just by editing the query string. `plan` stays in the URL — it selects copy,
  // not a user — and no plan/limits tables are touched here.
  const session = await getSession()
  const telegramId = session ? parseInt(session.telegramId, 10) : null

  if (!telegramId || Number.isNaN(telegramId)) {
    return (
      <main style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
        <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Sign in to upgrade.</h1>
        <p style={{ color: '#666', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
          Message AskGogo on WhatsApp and send <strong>dashboard</strong> to get your private link, then come back here.
        </p>
        <a
          href={WA_DASHBOARD_LINK}
          style={{
            display: 'inline-block', background: '#25D366', color: '#fff',
            padding: '12px 24px', borderRadius: 100, fontSize: 15, fontWeight: 600, textDecoration: 'none',
          }}
        >
          Open WhatsApp →
        </a>
      </main>
    )
  }

  const plans: Record<string, { amount: number; name: string; features: string[] }> = {
    starter: {
      amount: 149, name: 'Starter',
      features: ['150 messages/day', '50 memories', 'Voice notes', 'Smart reminders'],
    },
    pro: {
      amount: 299, name: 'Pro',
      features: ['Unlimited messages', '500 memories', 'Voice notes', 'Lists', 'Daily briefings', 'Priority AI'],
    },
    lifetime: {
      amount: 9999, name: 'Lifetime',
      features: ['Everything in Pro', 'Never pay again', 'All future features', 'Priority support'],
    },
  }

  const selected = plans[plan] || plans.pro

  const { data: user } = await supabaseAdmin
    .from('users').select('name, tier')
    .eq('telegram_id', telegramId).single()

  const payUrl = await createPaymentLink({
    amount: selected.amount,
    description: `AskGogo ${selected.name} Plan`,
    customerName: user?.name || 'AskGogo User',
    telegramId,
    plan,
  })

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 480, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>Upgrade to {selected.name}</h1>
      <p style={{ color: '#666', marginBottom: 32 }}>
        {plan === 'lifetime' ? 'One-time payment' : 'Monthly subscription'}
      </p>
      <div style={{ fontSize: 56, fontWeight: 300, marginBottom: 8 }}>
        <span style={{ fontSize: 24, verticalAlign: 'top' }}>Rs </span>
        {selected.amount.toLocaleString('en-IN')}
        {plan !== 'lifetime' && <span style={{ fontSize: 16, color: '#999' }}>/month</span>}
      </div>
      <ul style={{ listStyle: 'none', padding: 0, margin: '32px 0', textAlign: 'left' }}>
        {selected.features.map((f, i) => (
          <li key={i} style={{ padding: '10px 0', borderBottom: '1px solid #eee', fontSize: 14, display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ color: '#22c55e' }}>✓</span> {f}
          </li>
        ))}
      </ul>
      {payUrl ? (
        <a href={payUrl} style={{
          display: 'block', background: '#0a0a0f', color: '#fff',
          padding: 16, borderRadius: 100, fontSize: 16, fontWeight: 500, textDecoration: 'none', marginBottom: 16,
        }}>
          Pay Rs {selected.amount.toLocaleString('en-IN')} securely
        </a>
      ) : (
        <p style={{ color: 'red' }}>Payment link failed. Please try again.</p>
      )}
      <p style={{ fontSize: 12, color: '#999', marginTop: 16 }}>
        Powered by Razorpay. Cancel anytime. 30-day money-back guarantee.
      </p>
    </main>
  )
}