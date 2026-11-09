import type { Metadata } from 'next'
import { getSharedCard } from '@/lib/agent/invite-card-store'
import { inviteUrl } from '@/lib/invites/core'
import { waLink } from '@/lib/product-urls'

export const dynamic = 'force-dynamic'

type Props = { params: Promise<{ id: string }> }

const APP = (process.env.NEXT_PUBLIC_APP_URL || 'https://app.askgogo.in').replace(/\/$/, '')

function headline(spec: { kind: string; title: string; kicker: string }) {
  if (spec.kind === 'birthday') return spec.title
  if (spec.kind === 'anniversary') return `${spec.title} · ${spec.kicker}`
  return spec.title
}

// Link preview in WhatsApp: the card itself, wide, with the names and the date. No phone numbers, ever.
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  const card = await getSharedCard(id)
  if (!card) return { title: 'Invite · AskGogo', robots: { index: false, follow: false } }
  const title = headline(card.spec)
  const description = `${card.spec.when} · ${card.spec.venue}`
  const image = `${APP}/api/invite-card?c=${card.id}&f=og`
  return {
    title,
    description,
    robots: { index: false, follow: false },
    openGraph: { title, description, siteName: 'AskGogo', type: 'website', images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [image] },
  }
}

// app.askgogo.in/e/<id>: the page a friend opens from a shared occasion invite.
export default async function SharedInvitePage({ params }: Props) {
  const { id } = await params
  const card = await getSharedCard(id)
  const font = { fontFamily: 'var(--font-onest), system-ui, sans-serif' }
  if (!card) {
    return (
      <main className="min-h-dvh bg-[#f6f1ea] text-[#1d1b20]" style={font}>
        <div className="mx-auto flex min-h-dvh w-full max-w-[440px] flex-col justify-center gap-4 px-4 py-10 text-center">
          <div className="text-[28px] font-semibold tracking-tight">This invite has expired</div>
          <p className="text-[17px] leading-relaxed text-[#4a4650]">Ask whoever sent it for the details.</p>
        </div>
      </main>
    )
  }
  const map = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${card.map} Bengaluru`)}`
  const join = card.invite ? inviteUrl(card.invite) : waLink('Hi Gogo')
  return (
    <main className="min-h-dvh bg-[#f6f1ea] text-[#1d1b20]" style={font}>
      <div className="mx-auto flex w-full max-w-[440px] flex-col gap-4 px-4 pb-10 pt-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/api/invite-card?c=${card.id}`} alt={`${card.spec.title}, ${card.spec.when}, ${card.spec.venue}`} width={1080} height={1350}
          className="h-auto w-full rounded-2xl border border-[#e6ddd2] bg-white" />
        <a href={map} className="flex min-h-12 items-center justify-center rounded-2xl bg-[#1d1b20] text-[17px] font-semibold text-white">Open in Google Maps</a>
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[#e6ddd2] bg-white p-4">
          <div className="text-[16px] font-semibold">Planned with AskGogo</div>
          <p className="text-[15px] leading-relaxed text-[#4a4650]">Your assistant on WhatsApp. It reads your bookings, reminds you on time and makes invites like this one.</p>
          <a href={join} className="flex min-h-12 items-center justify-center rounded-2xl border border-[#1d1b20] text-[16px] font-semibold">{card.invite ? 'Join with this invite' : 'Try AskGogo on WhatsApp'}</a>
        </div>
      </div>
    </main>
  )
}
