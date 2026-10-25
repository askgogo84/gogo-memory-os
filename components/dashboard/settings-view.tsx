'use client'

// Settings, one page with a section picker (approved mock, 15 Oct): General, Connections, Permissions, Payments and
// spending, Addresses, Notifications, Voice and keyboard, Invites. Phone-first: one column, 44px tap targets.
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import { SignOutButton } from './sign-out-button'
import { DailyBriefEmail } from './daily-brief-email'
import { EmailPreferences } from './email-preferences'
import { CONNECTION_CATALOGUE, CONNECTION_CATEGORIES, VAULT_CONNECT_SITES, connectPath, type CatalogueSite, type ConnectionCategory } from '@/lib/dashboard/connection-catalogue'
import { LOCATION_STORAGE_KEY, parseLocationPreference, type LocationPreference } from '@/lib/dashboard/approx-location'
import { waLink } from '@/lib/product-urls'
import type { SiteConnection } from '@/lib/dashboard/site-sessions'

export type SettingsSection = 'general' | 'connections' | 'permissions' | 'payments' | 'addresses' | 'notifications' | 'voice' | 'invites'

export const SETTINGS_SECTIONS: Array<[SettingsSection, string]> = [
  ['general', 'General'], ['connections', 'Connections'], ['permissions', 'Permissions'], ['payments', 'Payments and spending'],
  ['addresses', 'Addresses'], ['notifications', 'Notifications'], ['voice', 'Voice and keyboard'], ['invites', 'Invites'],
]

// The site a sign-in was started for, so Settings can ask "Finished signing in?" when the person comes back.
const PENDING_SIGN_IN_KEY = 'askgogo-pending-sign-in'

type Props = {
  initialSection: SettingsSection
  name: string
  phone: string
  timezone: string
  planLabel: string
  usageLine: string
  google: { calendar: boolean; gmail: boolean }
  creditiq: boolean
  levels: Record<string, string>
  sites: SiteConnection[]
}

const heading = 'text-[18px] font-semibold text-[#ecebe8]'
const muted = 'text-[14px] leading-5 text-[#a8a8a4]'
const row = 'flex items-center justify-between gap-4 border-t border-[#1f1f1f] py-4 first:border-t-0'
const pill = 'inline-flex min-h-11 items-center justify-center rounded-full px-4 text-[14px] font-semibold'

export function SettingsView(props: Props) {
  const [section, setSection] = useState<SettingsSection>(props.initialSection)
  const [open, setOpen] = useState(false)
  function pick(next: SettingsSection) {
    setSection(next); setOpen(false)
    try { window.history.replaceState(null, '', `/dashboard/settings?section=${next}`) } catch {}
  }
  const label = Object.fromEntries(SETTINGS_SECTIONS)[section]

  return <div className="mx-auto w-full max-w-[760px] pb-10">
    <h1 className="final-dark-title hidden text-[32px] lg:block">Settings</h1>
    <div className="relative mt-1 lg:mt-5">
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-haspopup="menu"
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[#1c1c1c] px-4 text-[16px] font-semibold text-[#ecebe8]">
        {label}
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>
      {open && <div role="menu" className="absolute left-0 top-[52px] z-20 w-[250px] rounded-[14px] border border-[#262626] bg-[#141414] p-1.5">
        {SETTINGS_SECTIONS.map(([id, text]) => <button key={id} type="button" role="menuitem" onClick={() => pick(id)}
          className={`block min-h-11 w-full rounded-[10px] px-3 text-left text-[15px] ${section === id ? 'bg-[#1c1c1c] font-semibold text-[#ecebe8]' : 'text-[#c4c4c0]'}`}>{text}</button>)}
      </div>}
    </div>

    <div className="mt-5">
      {section === 'general' && <General {...props} />}
      {section === 'connections' && <Connections {...props} />}
      {section === 'permissions' && <Permissions levels={props.levels} />}
      {section === 'payments' && <Payments levels={props.levels} />}
      {section === 'addresses' && <Addresses />}
      {section === 'notifications' && <Notifications />}
      {section === 'voice' && <Voice />}
      {section === 'invites' && <Invites />}
    </div>
  </div>
}

function General(props: Props) {
  const [location, setLocation] = useState<LocationPreference>({ status: 'ask' })
  useEffect(() => { try { setLocation(parseLocationPreference(window.localStorage.getItem(LOCATION_STORAGE_KEY))) } catch {} }, [])
  function locationOff() {
    const next: LocationPreference = { status: 'off' }
    try { window.localStorage.setItem(LOCATION_STORAGE_KEY, JSON.stringify(next)) } catch {}
    setLocation(next)
  }
  return <div className="space-y-6">
    <section>
      <h2 className={heading}>Your details</h2>
      <p className={`mt-1 ${muted}`}>How Gogo addresses you and reaches you. To change your name, tell Gogo on WhatsApp.</p>
      <div className="final-dark-panel mt-3 px-4">
        <div className={row}><span className="text-[15px] text-[#c4c4c0]">Name</span><span className="text-[15px] text-[#ecebe8]">{props.name || 'Not set'}</span></div>
        <div className={row}><span className="text-[15px] text-[#c4c4c0]">WhatsApp</span><span className="text-[15px] text-[#ecebe8]">{props.phone || 'Connected'}</span></div>
        <div className={row}><span className="text-[15px] text-[#c4c4c0]">Timezone</span><span className="text-[15px] text-[#ecebe8]">{props.timezone}</span></div>
      </div>
    </section>
    <section>
      <h2 className={heading}>Theme</h2>
      <div className="mt-3"><ThemeToggle /></div>
    </section>
    <section>
      <div className="flex items-center justify-between gap-3">
        <h2 className={heading}>Location</h2>
        <span className={`rounded-full px-2.5 py-0.5 text-[13px] ${location.status === 'on' ? 'bg-[#123d38] text-[#2fb8a6]' : 'bg-[#1f1f1f] text-[#a8a8a4]'}`}>{location.status === 'on' ? 'On' : location.status === 'off' ? 'Off' : 'Not set'}</span>
      </div>
      <p className={`mt-1 ${muted}`}>Approximate area{location.status === 'on' && location.label ? ` (${location.label})` : ''}, kept in this browser and sent only with a message. Used for weather and nearby results.</p>
      {location.status === 'on'
        ? <button type="button" onClick={locationOff} className={`${pill} mt-3 border border-[#2a2a2a] text-[#c4c4c0]`}>Turn off</button>
        : <Link href="/dashboard/chat" className={`${pill} mt-3 border border-[#2a2a2a] text-[#c4c4c0]`}>Turn on in Gogo chat</Link>}
    </section>
    <section>
      <h2 className={heading}>Plan</h2>
      <div className="final-dark-panel mt-3 p-4">
        <div className="text-[16px] font-semibold text-[#ecebe8]">{props.planLabel}</div>
        {props.usageLine && <div className={`mt-1 ${muted}`}>{props.usageLine}</div>}
        <Link href="/dashboard/usage" className="mt-3 inline-block text-[14px] text-[#2fb8a6]">Plan and usage →</Link>
      </div>
    </section>
    <section className="final-dark-panel flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="text-[15px] text-[#c4c4c0]">Signed in on this browser.</div><div className={muted}>Sign out to remove access from this device.</div></div>
      <div className="sm:min-w-[170px]"><SignOutButton /></div>
    </section>
  </div>
}

type Provider = { provider: string; label: string; state: string }

function Connections(props: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ConnectionCategory>('shopping')
  const [sites, setSites] = useState<SiteConnection[]>(props.sites)
  const [providers, setProviders] = useState<Provider[]>([])
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<CatalogueSite | null>(null)

  useEffect(() => {
    fetch('/api/commerce', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => { if (Array.isArray(d?.providers)) setProviders(d.providers) }).catch(() => {})
    try {
      const id = window.localStorage.getItem(PENDING_SIGN_IN_KEY)
      const site = CONNECTION_CATALOGUE.find(item => item.id === id)
      if (site && !props.sites.some(s => s.siteId === site.id)) setPending(site)
    } catch {}
  }, [props.sites])

  // One tap from chat (20 Oct booking engine): "?section=connections&signin=zomato" opens that site's sign-in straight
  // away, so the person does not have to find it in the list. Only a known, sign-in-able site that is not connected.
  useEffect(() => {
    let id = ''
    try { id = new URLSearchParams(window.location.search).get('signin') || '' } catch {}
    const site = CONNECTION_CATALOGUE.find(item => item.id === id)
    if (!site || site.kind !== 'signin' || props.sites.some(s => s.siteId === site.id && s.via !== 'vault')) return
    setCategory(site.category)
    try { window.history.replaceState(null, '', '/dashboard/settings?section=connections') } catch {}
    void post('sign_in', site)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function post(action: 'sign_in' | 'confirm' | 'remove', site: CatalogueSite) {
    setBusy(site.id + action)
    // Starting the secure browser takes up to a minute; say so instead of a silent button.
    setMessage(action === 'sign_in' ? `Opening ${site.name} in your secure browser. This can take up to a minute…` : '')
    try {
      const response = await fetch('/api/dashboard/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, site: site.id }) })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(String(data?.error || 'failed'))
      if (action === 'sign_in') {
        try { window.localStorage.setItem(PENDING_SIGN_IN_KEY, site.id) } catch {}
        window.location.assign(String(data.browserPath))
        return
      }
      try { window.localStorage.removeItem(PENDING_SIGN_IN_KEY) } catch {}
      setPending(null)
      if (Array.isArray(data.sites)) setSites(data.sites)
      setMessage(action === 'confirm' ? `${site.name} is connected. Gogo will use your signed-in session and ask before anything that buys, books or submits.` : `Gogo will no longer use your ${site.name} session. To end it on ${site.name} too, sign out there.`)
    } catch (error: any) {
      setMessage(action !== 'sign_in' ? 'That did not save. Try again.' : error?.message === 'browser_busy' ? `Your secure browser is busy with another task that is waiting for you. Finish or close it in Needs you, then try ${site.name} again.` : `The secure browser could not open ${site.name} right now. Try again in a minute.`)
    } finally { setBusy('') }
  }

  const q = query.trim().toLowerCase()
  const connectedIds = new Set(sites.map(s => s.siteId))
  // Swiggy and Instamart share the Swiggy connection. When the provider connection is not open to us yet, the site
  // still works through a sign-in in the secure browser.
  const oauthState = (site: CatalogueSite) => providers.find(p => p.provider === (site.id === 'instamart' ? 'swiggy' : site.id))?.state || ''
  const useOauth = (site: CatalogueSite) => site.kind === 'oauth' && ['authorized', 'not_connected'].includes(oauthState(site))
  const list = useMemo(() => CONNECTION_CATALOGUE.filter(site => q ? `${site.name} ${site.what}`.toLowerCase().includes(q) : site.category === category), [q, category])
  const categoryTitle = q ? `Results for "${query.trim()}"` : CONNECTION_CATEGORIES.find(c => c.id === category)?.title

  const builtIn = [
    { name: 'Google', what: props.google.gmail || props.google.calendar ? [props.google.gmail && 'Gmail', props.google.calendar && 'Calendar', props.google.gmail && 'Drive'].filter(Boolean).join(', ') : 'Not connected', on: props.google.gmail || props.google.calendar, href: '/dashboard/you' },
    { name: 'Email inbox', what: 'Forward your mail or sign in with Google', on: false, href: '/dashboard/settings/email' },
    { name: 'WhatsApp', what: props.phone || 'Connected', on: true, href: '' },
    { name: 'CreditIQ', what: props.creditiq ? 'Cards and reward points' : 'Not connected', on: props.creditiq, href: '/dashboard/you' },
  ]

  return <div>
    {pending && <div className="mb-4 rounded-[14px] border border-[#2fb8a6] p-4">
      <div className="text-[16px] font-semibold text-[#ecebe8]">Finished signing in to {pending.name}?</div>
      <p className={`mt-1 ${muted}`}>Tap this once you can see your account on {pending.name} in the secure browser.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={() => post('confirm', pending)} className={`${pill} bg-[#2fb8a6] text-[#0b0b0b]`}>{busy === pending.id + 'confirm' ? 'Saving…' : "I'm signed in"}</button>
        <button type="button" onClick={() => { try { window.localStorage.removeItem(PENDING_SIGN_IN_KEY) } catch {}; setPending(null) }} className={`${pill} border border-[#2a2a2a] text-[#c4c4c0]`}>Not yet</button>
      </div>
    </div>}

    <label htmlFor="connection-search" className="sr-only">Search apps and sites</label>
    <input id="connection-search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${CONNECTION_CATALOGUE.length} apps and sites`}
      className="min-h-11 w-full rounded-full bg-[#1c1c1c] px-4 text-[16px] text-[#ecebe8] placeholder:text-[#8a8a86]" />
    {!q && <div className="-mx-1 mt-3 flex gap-2 overflow-x-auto px-1 pb-1">
      {CONNECTION_CATEGORIES.map(c => <button key={c.id} type="button" onClick={() => setCategory(c.id)}
        className={`min-h-10 shrink-0 rounded-full px-4 text-[14px] ${category === c.id ? 'bg-[#2fb8a6] font-semibold text-[#0b0b0b]' : 'border border-[#262626] text-[#c4c4c0]'}`}>{c.label}</button>)}
    </div>}

    {message && <p role="status" className="mt-4 rounded-[12px] bg-[#141414] p-3 text-[14px] leading-5 text-[#dcdad5]">{message}</p>}

    <h2 className="final-dark-eyebrow mt-6">Connected</h2>
    <div className="mt-1">
      {builtIn.filter(b => b.on).map(b => <AppRow key={b.name} name={b.name} what={b.what} action={b.href ? <Link href={b.href} className={`${pill} border border-[#262626] text-[#c4c4c0]`}>Manage</Link> : null} />)}
      {providers.filter(p => p.state === 'authorized').map(p => <AppRow key={p.provider} name={p.label} what="Connected through the provider" action={<Link href="/dashboard/commerce" className={`${pill} border border-[#262626] text-[#c4c4c0]`}>Manage</Link>} />)}
      {sites.map(conn => {
        const site = CONNECTION_CATALOGUE.find(item => item.id === conn.siteId)!
        return <AppRow key={conn.siteId} name={conn.name} what={conn.status !== 'active' ? 'Needs you to sign in again' : conn.via === 'vault' ? `Login saved in your vault · ${site.what}` : `Signed in · ${site.what}`}
          action={<button type="button" disabled={!!busy} onClick={() => post('remove', site)} className={`${pill} border border-[#262626] text-[#c4c4c0]`}>{busy === site.id + 'remove' ? 'Removing…' : 'Remove'}</button>} />
      })}
    </div>

    <h2 className="final-dark-eyebrow mt-6">{categoryTitle}</h2>
    <div className="mt-1">
      {list.length === 0 && <p className={`py-4 ${muted}`}>Nothing matches. Ask Gogo in chat; it can still open most sites in the secure browser.</p>}
      {list.map(site => {
        const done = connectedIds.has(site.id) || (site.kind === 'oauth' && oauthState(site) === 'authorized')
        const action = done ? <span className="text-[14px] text-[#7fb069]">Connected</span>
                    : VAULT_CONNECT_SITES[site.id] ? <Link href={connectPath(site)} className={`${pill} bg-[#1c1c1c] text-[#ecebe8]`}>Connect</Link>
                    : site.kind !== 'soon' && !useOauth(site) ? <button type="button" disabled={!!busy} onClick={() => post('sign_in', site)} className={`${pill} bg-[#1c1c1c] text-[#ecebe8]`}>{busy === site.id + 'sign_in' ? 'Opening…' : 'Sign in'}</button>
            : useOauth(site) ? <Link href="/dashboard/commerce" className={`${pill} bg-[#1c1c1c] text-[#ecebe8]`}>Connect</Link>
              : <span className="text-[14px] text-[#8a8a86]">Coming soon</span>
        return <AppRow key={site.id} name={site.name} what={site.what} action={action} />
      })}
    </div>

    <p className="mt-5 rounded-[14px] border border-[#262626] p-4 text-[14px] leading-5 text-[#a8a8a4]">Sign in opens the site in a private secure browser only you control. You type the password or OTP yourself; Gogo keeps the signed-in session, never the password. Gogo still asks before anything that buys, books or submits.</p>
  </div>
}

function AppRow({ name, what, action }: { name: string; what: string; action: React.ReactNode }) {
  return <div className="flex items-center gap-3 py-2.5">
    <div className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded-[12px] bg-[#1c1c1c] text-[16px] font-bold text-[#ecebe8]" aria-hidden="true">{name[0]}</div>
    <div className="min-w-0 flex-1"><div className="truncate text-[16px] text-[#ecebe8]">{name}</div><div className="truncate text-[14px] text-[#a8a8a4]">{what}</div></div>
    <div className="shrink-0">{action}</div>
  </div>
}

const PERMISSION_ROWS: Array<{ capability: string; title: string; detail: string; options: string[]; fallback: string }> = [
  { capability: 'email', title: 'Email from Gmail', detail: 'Read your mail and draft replies. Every send still needs your go-ahead.', options: ['off', 'read', 'draft', 'ask'], fallback: 'ask' },
  { capability: 'calendar', title: 'Google Calendar', detail: 'Read your schedule; creating or moving events asks first.', options: ['off', 'read', 'draft', 'ask'], fallback: 'ask' },
  { capability: 'reminders', title: 'Reminders', detail: 'Create and change your reminders.', options: ['off', 'ask', 'auto'], fallback: 'auto' },
  { capability: 'browser', title: 'Websites', detail: 'Read sites and prepare bookings; never submits or pays without you.', options: ['off', 'read', 'draft', 'ask'], fallback: 'draft' },
  { capability: 'travel', title: 'Travel', detail: 'Use your saved tickets, check-in prep and trip watches.', options: ['off', 'read', 'ask'], fallback: 'ask' },
]
const LEVEL_LABEL: Record<string, string> = { off: 'Off', read: 'Read only', draft: 'Prepare only', ask: 'Ask me', auto: 'Automatic' }

async function savePermission(capability: string, level: string) {
  const response = await fetch('/api/agent/permissions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ capability, level }) })
  if (!response.ok) throw new Error('permission_save_failed')
}

function Permissions({ levels }: { levels: Record<string, string> }) {
  const [state, setState] = useState(levels)
  const [status, setStatus] = useState('')
  async function change(capability: string, level: string) {
    const before = state[capability]
    setState(s => ({ ...s, [capability]: level })); setStatus('')
    try { await savePermission(capability, level); setStatus('Saved.') } catch { setState(s => ({ ...s, [capability]: before })); setStatus('That did not save. Try again.') }
  }
  return <div>
    <p className={muted}>What Gogo may do on its own. Anything that sends, spends, books or submits always asks you, whatever you choose here.</p>
    <div className="final-dark-panel mt-3 px-4">
      {PERMISSION_ROWS.map(p => <div key={p.capability} className={row}>
        <div className="min-w-0"><div className="text-[16px] text-[#ecebe8]">{p.title}</div><div className={muted}>{p.detail}</div></div>
        <label className="shrink-0"><span className="sr-only">{p.title}</span>
          <select value={state[p.capability] || p.fallback} onChange={e => change(p.capability, e.target.value)}
            className="min-h-11 rounded-full border border-[#2a2a2a] bg-[#141414] px-3 text-[14px] text-[#ecebe8]">
            {p.options.map(o => <option key={o} value={o}>{LEVEL_LABEL[o]}</option>)}
          </select>
        </label>
      </div>)}
      <div className={row}><div><div className="text-[16px] text-[#ecebe8]">Background checks</div><div className={muted}>Watches keep checking while you are away.</div></div><Link href="/dashboard/agent?section=background" className="shrink-0 text-[14px] text-[#2fb8a6]">Manage →</Link></div>
    </div>
    {status && <p role="status" className="mt-3 text-[14px] text-[#a8a8a4]">{status}</p>}
  </div>
}

function Payments({ levels }: { levels: Record<string, string> }) {
  const [paused, setPaused] = useState(levels.payments === 'off')
  const [status, setStatus] = useState('')
  async function toggle() {
    const next = !paused
    setPaused(next); setStatus('')
    try { await savePermission('payments', next ? 'off' : 'ask'); setStatus(next ? 'Spending paused. Gogo will not prepare any checkout.' : 'Spending on. Every purchase still waits for your Approve.') }
    catch { setPaused(!next); setStatus('That did not save. Try again.') }
  }
  return <div className="space-y-5">
    <div>
      <h2 className={heading}>Spending</h2>
      <p className={`mt-1 ${muted}`}>Gogo shows you the item, price and shop, and pays only after you tap Approve.</p>
    </div>
    <div className="final-dark-panel px-4">
      <div className={row}>
        <div><div className="text-[16px] text-[#ecebe8]">Pause all spending</div><div className={muted}>Gogo will not even prepare a checkout.</div></div>
        <button type="button" role="switch" aria-checked={paused} aria-label="Pause all spending" onClick={toggle}
          className={`relative h-[28px] w-[48px] shrink-0 rounded-full ${paused ? 'bg-[#2fb8a6]' : 'bg-[#2a2a2a]'}`}>
          <span className={`absolute top-[4px] h-5 w-5 rounded-full bg-[#ecebe8] transition-[left] ${paused ? 'left-[24px]' : 'left-[4px]'}`} />
        </button>
      </div>
      <div className="border-t border-[#1f1f1f] py-4">
        <div className="text-[16px] text-[#ecebe8]">Payment methods</div>
        <p className={`mt-1 ${muted}`}>When this opens, a card is saved as a card-network token in Razorpay&apos;s vault, or as a UPI spending limit you set in your UPI app. Gogo would see only the bank name and last 4 digits, never the card number, CVV, UPI PIN or OTP.</p>
        <p className="mt-2 text-[14px] text-[#d9a441]">Not available yet: we are waiting on Razorpay&apos;s approval for saved cards. Until then Gogo stops at checkout and you pay yourself.</p>
      </div>
      <div className="border-t border-[#1f1f1f] py-4"><div className="text-[16px] text-[#ecebe8]">Ask me above</div><p className={`mt-1 ${muted}`}>₹0, so every purchase asks you first.</p></div>
      <div className="border-t border-[#1f1f1f] py-4"><div className="text-[16px] text-[#ecebe8]">Purchases</div><p className={`mt-1 ${muted}`}>No purchases yet.</p></div>
    </div>
    {status && <p role="status" className="text-[14px] text-[#a8a8a4]">{status}</p>}
  </div>
}

function Addresses() {
  return <div className="space-y-3">
    <h2 className={heading}>Addresses</h2>
    <p className={muted}>Used to fill delivery and booking forms. For now Gogo uses the addresses saved in your connected delivery apps (Swiggy, Zepto). Your own address book here is next.</p>
    <Link href="/dashboard/commerce" className={`${pill} border border-[#2a2a2a] text-[#c4c4c0]`}>Delivery apps and addresses →</Link>
  </div>
}

function Notifications() {
  return <div className="space-y-5">
    <div className="final-dark-panel px-4">
      <div className={row}><div><div className="text-[16px] text-[#ecebe8]">WhatsApp updates</div><div className={muted}>Results and alerts reach you on WhatsApp. This is how Gogo talks to you, so it stays on.</div></div><span className="shrink-0 text-[14px] text-[#7fb069]">On</span></div>
    </div>
    <DailyBriefEmail />
    <EmailPreferences />
  </div>
}

function Voice() {
  return <div className="final-dark-panel p-4">
    <h2 className={heading}>Talk to Gogo</h2>
    <p className={`mt-1 ${muted}`}>In Gogo chat, tap the mic to dictate instead of typing. It works in Chrome, Edge and Safari. On WhatsApp, send a voice note.</p>
    <Link href="/dashboard/chat" className="mt-3 inline-block text-[14px] text-[#2fb8a6]">Open Gogo chat →</Link>
  </div>
}

function Invites() {
  const link = waLink('Hi Gogo')
  const [copied, setCopied] = useState(false)
  async function copy() { try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch {} }
  const share = `https://wa.me/?text=${encodeURIComponent(`I use Gogo on WhatsApp for reminders, travel and errands. Say hi: ${link}`)}`
  return <div className="space-y-3">
    <h2 className={heading}>Invite friends</h2>
    <div className="rounded-[18px] bg-[#efe6d7] p-5 text-[#1c1915]">
      <div className="text-[14px]">Link to start Gogo on WhatsApp</div>
      <div className="mt-1 break-all text-[17px] font-bold">{link}</div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={copy} className="min-h-11 rounded-full bg-[#0b0b0b] px-4 text-[14px] font-semibold text-[#f2efea]">{copied ? 'Copied' : 'Copy link'}</button>
        <a href={share} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center rounded-full border-2 border-current px-4 text-[14px] font-semibold text-[#1c1915]">Share on WhatsApp</a>
      </div>
    </div>
    <p className={muted}>Joining is free for them. Seeing who joined from your link is not built yet.</p>
  </div>
}
