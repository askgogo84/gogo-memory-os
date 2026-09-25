import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { getProfile, getFriendContacts, getUsageSummary } from '@/lib/dashboard/queries'
import { CardError } from '@/components/dashboard/card-error'
import { SignOutButton } from '@/components/dashboard/sign-out-button'
import { EmailPreferences } from '@/components/dashboard/email-preferences'
import { DailyBriefEmail } from '@/components/dashboard/daily-brief-email'
import { GogoCharacter } from '@/components/gogo/gogo-character'

export const dynamic='force-dynamic'

function fmtPhone(raw:string|null){
  if(!raw)return null
  const d=raw.replace(/\D/g,'')
  if(d.length===12&&d.startsWith('91'))return `+91 ${d.slice(2,7)} ${d.slice(7)}`
  return raw
}
function Setting({title,detail,children}:{title:string;detail:string;children:React.ReactNode}){
  return <div className="grid gap-3 border-t border-[#1f1f1f] py-4 first:border-t-0 sm:grid-cols-[210px_minmax(0,1fr)_auto] sm:items-start">
    <div className="text-[13px] font-medium text-[#f2efea]">{title}</div>
    <div className="text-[11px] leading-5 text-[#9a9a9a]">{detail}</div>
    <div className="sm:text-right">{children}</div>
  </div>
}

export default async function YouPage(){
  const session=await getSession()
  const [profile,friends,usage]=await Promise.all([
    session?getProfile(session.telegramId):Promise.resolve({ok:false} as const),
    session?getFriendContacts(session.telegramId):Promise.resolve({ok:true as const,contacts:[],count:0}),
    session?getUsageSummary(session.telegramId):Promise.resolve({ok:false} as const),
  ])

  if(!profile.ok)return <div className="mx-auto max-w-[1100px]"><CardError message="Couldn’t load your account right now."/></div>

  const phone=fmtPhone(profile.whatsappId)
  const connections=[
    ['Google Calendar',profile.connections.googleCalendar],
    ['Gmail',profile.connections.gmail],
    ['CreditIQ',profile.connections.creditiq],
  ] as const

  return <div className="mx-auto w-full max-w-[1100px] pb-10">
    <header className="flex items-end justify-between gap-5 border-b border-[#1f1f1f] pb-5">
      <div className="flex items-center gap-4">
        <div className="grid h-14 w-14 place-items-center rounded-full bg-[#f2efea]"><GogoCharacter state="calm" size={52} showStatus={false}/></div>
        <div>
          <div className="final-dark-eyebrow">Account</div>
          <h1 className="final-dark-title mt-1 text-[32px]">{profile.name||'You'}</h1>
          <p className="mt-1 text-[11px] text-[#6a6a6a]">{phone||'WhatsApp connected'} · {profile.planLabel}</p>
        </div>
      </div>
      <Link href="/dashboard/connections" className="hidden rounded-[8px] border border-[#2a2a2a] px-3 py-2 text-[10px] text-[#c9c9c4] hover:border-[#2fb8a6] hover:text-[#2fb8a6] sm:inline-flex">Connections</Link>
    </header>

    <section className="mt-5 final-dark-panel overflow-hidden px-4">
      <Setting title="Safe mode" detail="Gogo asks before anything that sends, spends, books or submits."><span className="inline-flex items-center gap-2 text-[11px] text-[#7fb069]"><span className="h-2 w-2 rounded-full bg-[#7fb069]"/>On</span></Setting>
      <Setting title="Background checks" detail="Let watchers keep checking while you’re away."><Link href="/dashboard/agent?section=background" className="text-[11px] text-[#2fb8a6]">Manage →</Link></Setting>
      <Setting title="Brain & Autonomy" detail="Measured learning, routing confidence and model usage from your outcomes."><Link href="/dashboard/brain" className="text-[11px] text-[#2fb8a6]">Open Brain →</Link></Setting>
      <Setting title="Memory" detail="Review what Gogo knows and what it may reuse later."><Link href="/dashboard/memory" className="text-[11px] text-[#2fb8a6]">Review memory →</Link></Setting>
      <Setting title="Personality" detail="Choose how direct, calm or playful Gogo feels."><Link href="/dashboard/personalize" className="text-[11px] text-[#2fb8a6]">Personalize →</Link></Setting>
      <Setting title="Vault" detail="Saved logins are sealed, domain-bound and never shown to the model."><Link href="/dashboard/you/vault" className="text-[11px] text-[#2fb8a6]">Manage Vault →</Link></Setting>
    </section>

    <section className="mt-5 final-dark-panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3.5"><span className="final-dark-eyebrow">Connections</span><Link href="/dashboard/connections" className="text-[10px] text-[#2fb8a6]">Open all</Link></div>
      <div className="border-t border-[#1f1f1f] px-4">
        {connections.map(([name,on])=><div key={name} className="flex items-center justify-between border-t border-[#1f1f1f] py-3.5 first:border-t-0"><span className="text-[12px] text-[#c9c9c4]">{name}</span><span className={`text-[10px] ${on?'text-[#7fb069]':'text-[#6a6a6a]'}`}>{on?'Connected':'Not connected'}</span></div>)}
      </div>
    </section>

    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="final-dark-panel p-4">
        <div className="flex items-center justify-between"><span className="final-dark-eyebrow">People you remind</span><span className="text-[12px] text-[#f2efea]">{friends.ok?friends.count:'—'}</span></div>
        <div className="mt-3 space-y-2">
          {friends.ok&&friends.contacts.length?friends.contacts.slice(0,6).map(c=><div key={c.name} className="final-dark-card flex items-center gap-3 px-3 py-2.5"><span className="grid h-8 w-8 place-items-center rounded-full bg-[#1f1f1f] text-[10px] text-[#c9c9c4]">{c.initials}</span><span className="text-[12px] text-[#c9c9c4]">{c.name}</span></div>):<p className="text-[11px] text-[#6a6a6a]">No reminder contacts yet.</p>}
        </div>
      </section>
      <section className="final-dark-panel p-4">
        <div className="final-dark-eyebrow">Plan & usage</div>
        <div className="mt-2 text-[24px] font-semibold text-[#f2efea]">{profile.planLabel}</div>
        <p className="mt-2 text-[11px] leading-5 text-[#9a9a9a]">{usage.ok?`${usage.usage.aiToday} AI actions today · ${usage.usage.docsThisMonth} documents this month`:'Usage details are temporarily unavailable.'}</p>
        <Link href="/dashboard/usage" className="mt-4 inline-flex text-[11px] text-[#2fb8a6]">Open plan & usage →</Link>
      </section>
    </div>

    <div className="mt-5"><DailyBriefEmail/></div>
    <div className="mt-5"><EmailPreferences/></div>
    <section className="mt-5 final-dark-panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="text-[12px] text-[#c9c9c4]">This browser session is private to this device.</div><div className="mt-1 text-[10px] text-[#6a6a6a]">Sign out whenever you want to remove access.</div></div>
      <div className="sm:min-w-[170px]"><SignOutButton/></div>
    </section>
  </div>
}

