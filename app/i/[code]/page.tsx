import type { Metadata } from 'next'
import { getInvitePreview } from '@/lib/invites/store'
import { joinMessage, joinWhatsAppLink } from '@/lib/invites/core'
import { waLink } from '@/lib/product-urls'
import { InviteFlow } from './invite-flow'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ code: string }> }

// Link preview in WhatsApp: "You're invited to AskGogo · A private invite from Goverdhan". No phone numbers, ever.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params
  const invite = await getInvitePreview(code).catch(() => null)
  const description = invite?.inviterFirstName ? `A private invite from ${invite.inviterFirstName}` : 'A private invite to AskGogo'
  return {
    title: "You're invited to AskGogo",
    description,
    robots: { index: false, follow: false },
    openGraph: { title: "You're invited to AskGogo", description, siteName: 'AskGogo', images: [{ url: '/askgogo-og.png?v=2', width: 1200, height: 630, alt: 'AskGogo' }] },
  }
}

// app.askgogo.in/i/<code>: the page a friend opens from an invite link (mock approved 23 Oct).
export default async function InvitePage({ params }: Props) {
  const { code } = await params
  const invite = await getInvitePreview(code).catch(() => null)
  const usable = !!invite && invite.active && invite.remaining > 0
  return (
    <main className="min-h-dvh bg-[#f6f1ea] text-[#1d1b20]" style={{ fontFamily: 'var(--font-onest), system-ui, sans-serif' }}>
      {usable
        ? <InviteFlow inviterFirstName={invite!.inviterFirstName} code={invite!.code} remaining={invite!.remaining}
            joinHref={joinWhatsAppLink(invite!.code)} joinText={joinMessage(invite!.code)} />
        : <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-5 px-6 py-10 text-center">
            <div className="text-[34px] font-semibold tracking-tight">AskGogo</div>
            <p className="text-[18px] leading-relaxed text-[#4a4650]">
              {invite ? `${invite.inviterFirstName || 'Your friend'}'s invites have all been used.` : "This invite link isn't valid."}
              {' '}You can still join the waitlist on WhatsApp, and we'll message you when your access is ready.
            </p>
            <a href={waLink('Hi Gogo')} className="flex min-h-14 items-center justify-center rounded-2xl bg-[#1d1b20] text-[18px] font-semibold text-white">Join the waitlist</a>
          </div>}
    </main>
  )
}
