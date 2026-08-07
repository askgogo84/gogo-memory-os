// Phase-2 note: this file will be rewritten as the magic-link token redeemer
// (reads ?t=, exchanges for a session cookie, redirects to /dashboard/reminders).
// For now it is a STATIC stop-the-leak screen: no searchParams, no Supabase,
// no data fetching of any kind. The previous version read ?id=<telegramId> with
// no auth and rendered that user's memories and reminders — an open IDOR.

const WA_DASHBOARD_LINK = 'https://wa.me/15797006612?text=dashboard'

export default function Dashboard() {
  return (
    <main
      style={{
        fontFamily: 'system-ui',
        maxWidth: 480,
        margin: '0 auto',
        padding: '64px 24px',
        textAlign: 'center',
      }}
    >
      <h1 style={{ fontSize: 24, margin: '0 0 12px' }}>Your dashboard is moving.</h1>
      <p style={{ color: '#666', fontSize: 15, lineHeight: 1.6, margin: '0 0 28px' }}>
        Message AskGogo on WhatsApp and send <strong>dashboard</strong> to get your link.
      </p>
      <a
        href={WA_DASHBOARD_LINK}
        style={{
          display: 'inline-block',
          background: '#25D366',
          color: '#fff',
          padding: '12px 24px',
          borderRadius: 100,
          fontSize: 15,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Open WhatsApp →
      </a>
    </main>
  )
}
