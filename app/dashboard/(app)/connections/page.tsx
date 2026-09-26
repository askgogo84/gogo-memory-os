import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { getProfile } from '@/lib/dashboard/queries'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

type ConnectionRowProps={
  name:string
  state:string
  available:boolean
  operations:string
  approval:string
  verification:string
  detail?:string
  href?:string
}

function ConnRow({name,state,available,operations,approval,verification,detail,href}:ConnectionRowProps){
  const body=<div className="border-t border-[#1f1f1f] py-5 first:border-t-0">
    <div className="grid gap-4 lg:grid-cols-[170px_130px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-start">
      <div className="text-[13px] font-medium text-[#f2efea]">{name}</div>
      <div>
        <div className={`text-[11px] font-medium ${available?'text-[#7fb069]':'text-[#9a9a9a]'}`}>{state}</div>
        {detail&&<div className="mt-1 text-[10px] leading-4 text-[#666]">{detail}</div>}
      </div>
      <div><div className="text-[9px] uppercase tracking-[.14em] text-[#555]">Supported operations</div><div className="mt-1 text-[11px] leading-4 text-[#9a9a9a]">{operations}</div></div>
      <div><div className="text-[9px] uppercase tracking-[.14em] text-[#555]">Approval boundary</div><div className="mt-1 text-[11px] leading-4 text-[#9a9a9a]">{approval}</div></div>
      <div><div className="text-[9px] uppercase tracking-[.14em] text-[#555]">Verification</div><div className="mt-1 text-[11px] leading-4 text-[#9a9a9a]">{verification}</div></div>
      {href&&<span className="text-[10px] text-[#2fb8a6]">Open →</span>}
    </div>
  </div>
  return href?<Link href={href} className="block hover:bg-[#141414]">{body}</Link>:body
}

export default async function ConnectionsPage(){
  const session=await getSession()
  const profile=session?await getProfile(session.telegramId):({ok:false} as const)
  const tgNum=parseInt(session?.telegramId||'',10)
  const tg=String(session?.telegramId||'')
  const [vaultResult,userResult,travelResult,browserPermission]=Number.isFinite(tgNum)
    ?await Promise.all([
      supabaseAdmin.from('vault_credentials').select('id',{count:'exact',head:true}).eq('telegram_id',tgNum),
      supabaseAdmin.from('users').select('gmail_connected,gmail_send_connected,gmail_connected_at,google_calendar_connected,google_calendar_connected_at').eq('telegram_id',tgNum).maybeSingle(),
      supabaseAdmin.from('travel_tickets').select('id',{count:'exact',head:true}).eq('telegram_id',tgNum).gte('depart_at',new Date().toISOString()),
      supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',tg).eq('capability','browser').maybeSingle(),
    ])
    :[{count:0},{data:null},{count:0},{data:null}] as any
  const vaultCount=Number((vaultResult as any)?.count||0)
  const travelCount=Number((travelResult as any)?.count||0)
  const u:any=(userResult as any)?.data||{}
  const c=profile.ok?profile.connections:{googleCalendar:false,gmail:false,creditiq:false}
  const browserLevel=String((browserPermission as any)?.data?.level||'draft')
  const browserAvailable=browserLevel!=='off'
  const gmailSend=Boolean(u.gmail_send_connected)

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="border-b border-[#1f1f1f] pb-5">
      <div className="final-dark-eyebrow">Reach · authority · evidence</div>
      <h1 className="final-dark-title mt-2 text-[34px]">Connections</h1>
      <p className="mt-2 max-w-3xl text-[13px] leading-5 text-[#9a9a9a]">What Gogo can reach, what it is allowed to do there, and what evidence is required before it claims success.</p>
    </header>

    <section className="mt-5 final-dark-panel overflow-hidden">
      <div className="hidden border-b border-[#1f1f1f] px-4 py-3 text-[9px] uppercase tracking-[.14em] text-[#555] lg:grid lg:grid-cols-[170px_130px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div>Connection</div><div>Availability</div><div>Operations</div><div>Approval</div><div>Evidence</div><div />
      </div>
      <div className="px-4">
        <ConnRow name="Google Calendar" state={c.googleCalendar?'Connected':'Not connected'} available={c.googleCalendar}
          operations="Read schedules and exact events; prepare/create/update calendar events."
          approval="Reads are safe. Create/update/delete remains behind the calendar approval boundary."
          verification="Google Calendar read-back of the exact event/object after mutation."
          detail={u.google_calendar_connected_at?'Connection recorded on this account.':undefined} href="/dashboard/calendar"/>
        <ConnRow name="Gmail" state={c.gmail?(gmailSend?'Connected · Send enabled':'Connected · Read only'):'Not connected'} available={c.gmail}
          operations={gmailSend?'Read/search mail, inspect attachments, draft and approved send.':'Read/search mail and attachments; drafts are safe. Gmail Send has not been granted.'}
          approval="Reading never authorizes sending. Every consequential send requires the existing bounded approval."
          verification="Gmail provider message/thread evidence; send success requires provider read-back."
          detail={u.gmail_connected_at?'Workspace identity is owner-bound.':undefined} href="/dashboard/you"/>
        <ConnRow name="Google Drive" state={c.gmail?'Connected via Workspace':'Not connected'} available={c.gmail}
          operations="Read/search Drive context and fetch supported files for bounded analysis."
          approval="Read-only Workspace scope. File mutation is not granted by this connection."
          verification="Drive file ID + bounded provider content; no substitute document on ambiguity." href="/dashboard/you"/>
        <ConnRow name="Secure Browser" state={browserAvailable?`Available · ${browserLevel}`:'Off'} available={browserAvailable}
          operations="Read websites, prepare forms, monitor pages and execute explicitly approved browser actions."
          approval="Consequential submit/book/buy actions require approval; passwords, OTPs, passkeys and payment auth stay human-only."
          verification="Provider page / terminal evidence; uncertain submits become outcome-unknown and are never blindly retried." href="/dashboard/agent"/>
        <ConnRow name="Vault" state={vaultCount>0?`${vaultCount} saved login${vaultCount===1?'':'s'}`:'No saved logins'} available={vaultCount>0}
          operations="Domain-bound credential injection for providers without a proper connection; authenticated session reuse where available."
          approval="Secrets never enter chat/model context. Secondary auth stays human-only."
          verification="Vault audit + provider session state; credentials themselves are never exposed." href="/dashboard/you/vault"/>
        <ConnRow name="Travel context" state={travelCount>0?`${travelCount} upcoming leg${travelCount===1?'':'s'}`:'No upcoming saved travel'} available={travelCount>0}
          operations="Use saved itinerary context, prepare check-in, bounded monitoring and contextual planning."
          approval="Research/monitoring is read-only. Check-in submit, booking or payment keeps the normal consequential-action gate."
          verification="Saved ticket/life-event source refs plus provider evidence; inferred presence is labelled as inference." href="/dashboard/agent"/>
        <ConnRow name="CreditIQ" state={c.creditiq?'Connected':'Not connected'} available={c.creditiq}
          operations="Use linked card/reward intelligence as contextual decision support."
          approval="CreditIQ context is evidence, not authority to redeem, pay or spend."
          verification="Connected-account data where available; user-entered balances remain labelled as unverified." href="/dashboard/you"/>
      </div>
    </section>

    <section className="mt-5 grid gap-4 md:grid-cols-2">
      <div className="final-dark-panel p-4">
        <div className="final-dark-eyebrow">Security boundary</div>
        <p className="mt-3 text-[12px] leading-5 text-[#9a9a9a]">Passwords, one-time codes, passkeys and payment-auth values never belong in chat or memory. Connections provide reach; they do not silently grant execution authority.</p>
      </div>
      <div className="final-dark-panel p-4">
        <div className="final-dark-eyebrow">Evidence boundary</div>
        <p className="mt-3 text-[12px] leading-5 text-[#9a9a9a]">Gogo should only claim a mutation succeeded after provider-grounded read-back. If the provider cannot confirm the outcome, the run remains blocked or outcome-unknown rather than guessed.</p>
      </div>
    </section>
  </div>
}
