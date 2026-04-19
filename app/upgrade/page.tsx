import { supabaseAdmin } from '@/lib/supabase-admin'
import { createPaymentLink } from '@/lib/razorpay'

export const dynamic = 'force-dynamic'

export default async function UpgradePage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string; plan?: string }>
}) {
  const params = await searchParams
  const telegramId = params.id ? parseInt(params.id) : null
  const plan = params.plan || 'pro'

  if (!telegramId) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: 40, textAlign: 'center' }}>
        <h1>AskGogo Upgrade</h1>
        <p>Open this from your Telegram bot using /upgrade</p>
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