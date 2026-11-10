// app.askgogo.in/rsvp/<private link>: the invitation a guest opens. No account. The server resolves the link and
// passes down only what this guest may see; the page is never indexed and sends no referrer (the link is the key).
import type { Metadata } from 'next'
import { invitationFor, isEventToken } from '@/lib/events/store'
import RsvpClient from './rsvp-client'

export const dynamic = 'force-dynamic'
type Props = { params: Promise<{ token: string }> }

export const metadata: Metadata = { title: "You're invited · AskGogo", robots: { index: false, follow: false }, referrer: 'no-referrer' }

function Message({ title, body }: { title: string; body: string }) {
  return (
    <main className="min-h-dvh bg-[#f6f1e8] text-[#16130f]" style={{ fontFamily: 'var(--font-onest), system-ui, sans-serif' }}>
      <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-3 px-4 py-10 text-center">
        <h1 className="text-[26px] font-extrabold tracking-tight">{title}</h1>
        <p className="text-[16px] leading-relaxed text-[#3a342d]">{body}</p>
      </div>
    </main>
  )
}

export default async function RsvpPage({ params }: Props) {
  const { token } = await params
  let found: Awaited<ReturnType<typeof invitationFor>> = null
  let failed = false
  if (isEventToken(token)) { try { found = await invitationFor(token) } catch { failed = true } }
  if (failed) return <Message title="Invitations are not available right now" body="Please try again in a little while." />
  if (!found) return <Message title="This invitation link is not valid" body="Please ask the host to send it again." />
  if (found.mode === 'revoked' || !found.view) return <Message title="This invitation is no longer active" body="Please ask the host for a new link." />
  return <RsvpClient token={token} mode={found.mode} initial={found.view} />
}
