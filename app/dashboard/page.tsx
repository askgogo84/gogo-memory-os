import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic = 'force-dynamic'

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>
}) {
  const params = await searchParams
  const telegramId = params.id ? parseInt(params.id) : null

  if (!telegramId) {
    return (
      <main style={{ fontFamily: 'system-ui', padding: 40, textAlign: 'center' }}>
        <h1>AskGogo Dashboard</h1>
        <p style={{ color: '#666' }}>Send /dashboard in the bot to open your personal dashboard.</p>
      </main>
    )
  }

  const [{ data: user }, { data: memories }, { data: reminders }] = await Promise.all([
    supabaseAdmin.from('users').select('*').eq('telegram_id', telegramId).single(),
    supabaseAdmin.from('memories').select('*').eq('telegram_id', telegramId).order('created_at', { ascending: false }),
    supabaseAdmin.from('reminders').select('*').eq('telegram_id', telegramId).eq('sent', false).order('remind_at', { ascending: true }),
  ])

  if (!user) return <main style={{ padding: 40 }}>User not found.</main>

  const tierColors: Record<string, string> = {
    free: '#6b7280', starter: '#2563eb', pro: '#7c3aed'
  }
  const tierColor = tierColors[user.tier || 'free'] || '#6b7280'

  return (
    <main style={{ fontFamily: 'system-ui', maxWidth: 640, margin: '0 auto', padding: '40px 20px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <div>
          <h1 style={{ fontSize: 22, margin: 0 }}>👋 {user.name}</h1>
          <p style={{ margin: '4px 0 0', color: '#666', fontSize: 14 }}>
            Messages today: <strong>{user.daily_count || 0}</strong>
          </p>
        </div>
        <span style={{
          background: tierColor, color: '#fff', padding: '4px 12px',
          borderRadius: 20, fontSize: 12, fontWeight: 600, textTransform: 'uppercase'
        }}>
          {user.tier || 'free'}
        </span>
      </div>

      {/* Memories */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>🧠 Memories ({memories?.length || 0})</h2>
        {memories && memories.length > 0 ? memories.map((m: { id: string; content: string; created_at: string }) => (
          <div key={m.id} style={{
            padding: '10px 14px', marginBottom: 8,
            background: '#f8fafc', border: '1px solid #e2e8f0',
            borderRadius: 10, fontSize: 14, display: 'flex',
            justifyContent: 'space-between', alignItems: 'center'
          }}>
            <span>{m.content}</span>
            <span style={{ color: '#94a3b8', fontSize: 11, marginLeft: 12, whiteSpace: 'nowrap' }}>
              {new Date(m.created_at).toLocaleDateString('en-IN')}
            </span>
          </div>
        )) : (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>
            No memories yet. Tell the bot something to remember!
          </p>
        )}
      </section>

      {/* Reminders */}
      <section style={{ marginBottom: 32 }}>
        <h2 style={{ fontSize: 16, marginBottom: 12 }}>⏰ Reminders ({reminders?.length || 0})</h2>
        {reminders && reminders.length > 0 ? reminders.map((r: { id: string; message: string; remind_at: string }) => (
          <div key={r.id} style={{
            padding: '10px 14px', marginBottom: 8,
            background: '#fffbeb', border: '1px solid #fde68a',
            borderRadius: 10, fontSize: 14
          }}>
            <div style={{ fontWeight: 500 }}>{r.message}</div>
            <div style={{ color: '#92400e', fontSize: 12, marginTop: 4 }}>
              {new Date(r.remind_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
            </div>
          </div>
        )) : (
          <p style={{ color: '#94a3b8', fontSize: 14 }}>No upcoming reminders.</p>
        )}
      </section>

      {/* Upgrade CTA */}
      {user.tier === 'free' && (
        <div style={{
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          borderRadius: 16, padding: '24px', color: '#fff', textAlign: 'center'
        }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 18 }}>⚡ Upgrade to Pro</h3>
          <p style={{ margin: '0 0 16px', opacity: 0.9, fontSize: 14 }}>
            Unlimited messages · 500 memories · Priority AI
          </p>
          <a href={`/upgrade?id=${telegramId}`} style={{
            display: 'inline-block', background: '#fff', color: '#764ba2',
            padding: '10px 24px', borderRadius: 8,
            textDecoration: 'none', fontWeight: 600, fontSize: 14
          }}>
            See Plans →
          </a>
        </div>
      )}
    </main>
  )
}