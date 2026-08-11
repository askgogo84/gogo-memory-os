import { getSession } from '@/lib/dashboard/session'
import { getProfile, getFriendContacts, getUsageSummary } from '@/lib/dashboard/queries'
import { CardError } from '@/components/dashboard/card-error'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { QuotaBar } from '@/components/dashboard/quota-bar'
import { SignOutButton } from '@/components/dashboard/sign-out-button'

export const dynamic = 'force-dynamic'

// The "You" surface (frames 1h + the Friends section from 1g) — deliberately the
// quietest screen. Identity, plan, linked-account status, friends, sign out. Fully
// read-only: no plan change, no connect/disconnect, no add/remove friends this
// phase. The one action is Sign out, which reuses the pre-built DELETE endpoint.

// "+91 88845 01501" from a stored id that may or may not carry punctuation/prefix.
function formatPhone(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`
  return raw
}

// "with Gogo since Jun 2024" from created_at.
function memberSince(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const label = new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d)
  return `with Gogo since ${label}`
}

// "3 Sep" for the renewal date.
function shortDate(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(d)
}

export default async function YouPage() {
  const session = await getSession()
  const [profile, friends, usage] = await Promise.all([
    session ? getProfile(session.telegramId) : Promise.resolve({ ok: false } as const),
    session ? getFriendContacts(session.telegramId) : Promise.resolve({ ok: true as const, contacts: [], count: 0 }),
    session ? getUsageSummary(session.telegramId) : Promise.resolve({ ok: false } as const),
  ])

  if (!profile.ok) {
    return (
      <div className="flex flex-col gap-5">
        <h1 className="font-serif text-[25px] font-semibold tracking-[-0.4px] text-gogo-ink">You</h1>
        <CardError message="Couldn’t load your account right now." />
      </div>
    )
  }

  const subline = [formatPhone(profile.whatsappId), memberSince(profile.createdAt)].filter(Boolean).join(' · ')
  const priceLine = profile.planPriceInr > 0 ? `₹${profile.planPriceInr} / month` : 'Free'
  const renews = shortDate(profile.planExpiresAt)
  const friendsMax = usage.ok ? usage.limits.friendContactsMax : null

  const accounts = [
    { name: 'Google Calendar', connected: profile.connections.googleCalendar },
    { name: 'Gmail', connected: profile.connections.gmail },
    { name: 'CreditIQ', connected: profile.connections.creditiq },
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* Identity */}
      <header className="pt-1 text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/gogo-figure.png" alt="" className="mx-auto mb-3 h-[72px] w-[72px] select-none" />
        <div className="font-serif text-[22px] font-semibold tracking-[-0.3px] text-gogo-ink">
          {profile.name || 'You'}
        </div>
        {subline && <div className="mt-1 text-[13px] font-medium text-gogo-ink-3">{subline}</div>}
      </header>

      {/* Plan */}
      <div className="rounded-[18px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-3.5">
        <div className="text-[15px] font-semibold text-gogo-ink">{profile.planLabel}</div>
        <div className="mt-0.5 text-[12.5px] text-gogo-ink-3">
          {priceLine}
          {renews ? ` · renews ${renews}` : ''}
        </div>
      </div>

      {/* Linked accounts — status only (read-only). Connected = plum dot, never
          green; green is reserved for WhatsAppChip alone. */}
      <div className="overflow-hidden rounded-[18px] border border-gogo-ink/10 bg-gogo-surface">
        {accounts.map((a) => (
          <div
            key={a.name}
            className="flex items-center gap-3 border-b border-gogo-ink/[0.06] px-[14px] py-[13px] last:border-b-0"
          >
            <span className={`h-2 w-2 shrink-0 rounded-full ${a.connected ? 'bg-gogo-plum' : 'bg-gogo-ink/20'}`} />
            <span className="flex-1 text-[14px] font-medium text-gogo-ink">{a.name}</span>
            <span className="text-[12.5px] font-medium text-gogo-ink-3">
              {a.connected ? 'Connected' : 'Not connected'}
            </span>
          </div>
        ))}
      </div>

      {/* Friends — the reminders-for-others contacts (IA §You). Read-only: no add,
          no remove. Each row hands back to WhatsApp to nudge that person. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-[12px] font-semibold uppercase tracking-[0.1em] text-gogo-ink-3">Friends</h2>

        {friendsMax !== null && friends.ok && (
          <QuotaBar label="Friend contacts" used={friends.count} limit={friendsMax} tone="sand" />
        )}

        {!friends.ok ? (
          <p className="text-[13px] text-gogo-ink-3">Couldn’t load your contacts.</p>
        ) : friends.contacts.length === 0 ? (
          <div className="rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[14px] py-4 text-center">
            <p className="text-[13.5px] text-gogo-ink-2">No one on your reminder list yet.</p>
            <div className="mt-3 flex justify-center">
              <WhatsAppChip message="Gogo, remind a friend to…" />
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-[9px]">
            {friends.contacts.map((c) => (
              <li
                key={c.name}
                className="flex items-center gap-3 rounded-[16px] border border-gogo-ink/10 bg-gogo-surface px-[13px] py-3"
              >
                <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-gogo-orange-tint text-[13px] font-bold text-gogo-orange-deep">
                  {c.initials}
                </span>
                <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gogo-ink">{c.name}</span>
                <WhatsAppChip message={`Gogo, remind ${c.name} to…`} label="Nudge" />
              </li>
            ))}
          </ul>
        )}
      </section>

      <SignOutButton />
    </div>
  )
}
