import { getSession } from '@/lib/dashboard/session'
import { getProfile, getFriendContacts, getUsageSummary } from '@/lib/dashboard/queries'
import { CardError } from '@/components/dashboard/card-error'
import { WhatsAppChip } from '@/components/dashboard/whatsapp-chip'
import { QuotaBar } from '@/components/dashboard/quota-bar'
import { SignOutButton } from '@/components/dashboard/sign-out-button'
import { EmailPreferences } from '@/components/dashboard/email-preferences'

export const dynamic = 'force-dynamic'

function formatPhone(raw: string | null): string | null {
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) return `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
  if (digits.length === 10) return `${digits.slice(0, 5)} ${digits.slice(5)}`
  return raw
}

function memberSince(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d)
}

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
      <div className="w-full">
        <header className="rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-6 shadow-[0_18px_55px_rgba(62,35,18,0.05)]">
          <h1 className="font-serif text-[36px] font-semibold tracking-[-0.8px] text-gogo-ink">You</h1>
        </header>
        <div className="mt-5"><CardError message="Couldn’t load your account right now." /></div>
      </div>
    )
  }

  const phone = formatPhone(profile.whatsappId)
  const since = memberSince(profile.createdAt)
  const priceLine = profile.planPriceInr > 0 ? `₹${profile.planPriceInr} / month` : 'Free'
  const renews = shortDate(profile.planExpiresAt)
  const friendsMax = usage.ok ? usage.limits.friendContactsMax : null
  const accounts = [
    { name: 'Google Calendar', connected: profile.connections.googleCalendar },
    { name: 'Gmail', connected: profile.connections.gmail },
    { name: 'CreditIQ', connected: profile.connections.creditiq },
  ]
  const connectedCount = accounts.filter((a) => a.connected).length

  return (
    <div className="w-full">
      <header className="relative overflow-hidden rounded-[30px] border border-gogo-ink/8 bg-gogo-surface/78 px-7 py-7 shadow-[0_18px_55px_rgba(62,35,18,0.05)] backdrop-blur-xl">
        <div className="pointer-events-none absolute -right-16 -top-24 h-72 w-72 rounded-full bg-gogo-orange/10 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-5">
            <div className="relative">
              <div className="absolute inset-0 rounded-full bg-gogo-orange/18 blur-2xl" />
              <img src="/gogo-figure.png" alt="" className="relative h-[86px] w-[86px] animate-[gogo-float_6s_ease-in-out_infinite]" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gogo-orange">Your space</p>
              <h1 className="mt-1 font-serif text-[36px] font-semibold tracking-[-0.8px] text-gogo-ink">{profile.name || 'You'}</h1>
              <p className="mt-1 text-[13px] text-gogo-ink-3">{phone || 'WhatsApp connected'}{since ? ` · with Gogo since ${since}` : ''}</p>
            </div>
          </div>
          <div className="rounded-[22px] border border-gogo-ink/8 bg-gogo-cream/50 px-5 py-4 text-right">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gogo-ink-3">Current plan</div>
            <div className="mt-1 font-serif text-[25px] font-semibold text-gogo-ink">{profile.planLabel}</div>
            <div className="mt-1 text-[12px] text-gogo-ink-3">{priceLine}{renews ? ` · renews ${renews}` : ''}</div>
          </div>
        </div>
      </header>

      <div className="mt-5 grid gap-4 xl:grid-cols-12">
        <section className="xl:col-span-7 rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/80 p-6 shadow-[0_18px_50px_rgba(62,35,18,0.04)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-ink-3">Connected apps</p>
              <h2 className="mt-1 font-serif text-[26px] font-semibold text-gogo-ink">Your integrations</h2>
            </div>
            <div className="font-serif text-[26px] font-semibold text-gogo-plum">{connectedCount}</div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {accounts.map((a) => (
              <div key={a.name} className="rounded-[20px] border border-gogo-ink/8 bg-gogo-cream/45 px-4 py-4">
                <div className={`h-2.5 w-2.5 rounded-full ${a.connected ? 'bg-emerald-500' : 'bg-gogo-ink/15'}`} />
                <div className="mt-3 text-[14px] font-semibold text-gogo-ink">{a.name}</div>
                <div className={`mt-1 text-[11.5px] ${a.connected ? 'font-semibold text-emerald-600' : 'text-gogo-ink-3'}`}>{a.connected ? 'Connected' : 'Not connected'}</div>
              </div>
            ))}
          </div>

          <div className="mt-5 rounded-[22px] border border-gogo-orange/18 bg-gogo-orange-tint/70 p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[14px] font-semibold text-gogo-ink">Make future sign-ins even faster</div>
                <p className="mt-1 max-w-xl text-[12.5px] leading-5 text-gogo-ink-2">Your WhatsApp OTP already keeps this browser signed in for up to 30 days. You can also link Google as a backup way to enter.</p>
              </div>
              <a href="/api/dashboard/google/start?mode=link" className="shrink-0 rounded-full bg-gogo-ink px-4 py-2.5 text-[12.5px] font-semibold text-white no-underline">Link Google sign-in</a>
            </div>
          </div>
        </section>

        <section className="xl:col-span-5 rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/80 p-6 shadow-[0_18px_50px_rgba(62,35,18,0.04)] backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-gogo-ink-3">People</p>
              <h2 className="mt-1 font-serif text-[26px] font-semibold text-gogo-ink">People you remind</h2>
            </div>
            <div className="font-serif text-[26px] font-semibold text-gogo-orange">{friends.ok ? friends.count : '—'}</div>
          </div>

          {friendsMax !== null && friends.ok && <div className="mt-4"><QuotaBar label="Friend contacts" used={friends.count} limit={friendsMax} tone="sand" /></div>}

          {!friends.ok ? (
            <p className="mt-5 text-[13px] text-gogo-ink-3">Couldn’t load your contacts.</p>
          ) : friends.contacts.length === 0 ? (
            <div className="mt-5 rounded-[20px] border border-dashed border-gogo-ink/10 bg-gogo-cream/30 px-5 py-8 text-center">
              <p className="text-[13.5px] text-gogo-ink-2">No one on your reminder list yet.</p>
              <div className="mt-3 flex justify-center"><WhatsAppChip message="Gogo, remind a friend to…" /></div>
            </div>
          ) : (
            <ul className="mt-5 grid gap-2">
              {friends.contacts.slice(0, 8).map((c) => (
                <li key={c.name} className="flex items-center gap-3 rounded-[17px] border border-gogo-ink/8 bg-gogo-cream/42 px-3.5 py-3">
                  <span className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full bg-gogo-orange-tint text-[13px] font-bold text-gogo-orange-deep">{c.initials}</span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-gogo-ink">{c.name}</span>
                  <WhatsAppChip message={`Gogo, remind ${c.name} to…`} label="Nudge" />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="mt-4"><EmailPreferences /></div>

      <section className="mt-4 flex flex-col gap-4 rounded-[28px] border border-gogo-ink/8 bg-gogo-surface/70 p-5 shadow-[0_18px_50px_rgba(62,35,18,0.035)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="text-[13px] font-semibold text-gogo-ink">Your session is private to this browser.</div>
          <div className="mt-1 text-[12px] text-gogo-ink-3">Sign out whenever you want to remove this device’s access.</div>
        </div>
        <div className="sm:min-w-[180px]"><SignOutButton /></div>
      </section>
    </div>
  )
}
