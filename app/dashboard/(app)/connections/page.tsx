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
      <div className="text-[16px] font-medium text-[#f2efea]">{name}</div>
      <div>
        <div className={`text-[14px] font-medium ${available?'text-[#7fb069]':'text-[#9a9a9a]'}`}>{state}</div>
        {detail&&<div className="mt-1 text-[13px] leading-4 text-[#666]">{detail}</div>}
      </div>
      <div><div className="text-[12px] uppercase tracking-[.14em] text-[#555]">Supported operations</div><div className="mt-1 text-[14px] leading-4 text-[#9a9a9a]">{operations}</div></div>
      <div><div className="text-[12px] uppercase tracking-[.14em] text-[#555]">Approval boundary</div><div className="mt-1 text-[14px] leading-4 text-[#9a9a9a]">{approval}</div></div>
      <div><div className="text-[12px] uppercase tracking-[.14em] text-[#555]">Verification</div><div className="mt-1 text-[14px] leading-4 text-[#9a9a9a]">{verification}</div></div>
      {href&&<span className="text-[13px] text-[#2fb8a6]">Open →</span>}
    </div>
  </div>
  // A connect route redirects off-site (Google consent), so it needs a full page load, not client navigation.
  if(href?.startsWith('/api/'))return <a href={href} className="block hover:bg-[#141414]">{body}</a>
  return href?<Link href={href} className="block hover:bg-[#141414]">{body}</Link>:body
}

function ConnectionCard({name,state,detail,available,href}:{name:string;state:string;detail:string;available:boolean;href:string}){
  return <Link href={href} className="final-dark-panel block min-h-[132px] p-4 transition-colors hover:border-[#2fb8a6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#77d2c4]">
    <div className="text-[16px] font-semibold text-[#f2efea]">{name}</div>
    <div className={`mt-3 flex items-center gap-2 text-[15px] font-medium ${available?'text-[#83c3b8]':'text-[#e4c17b]'}`}>
      <span className={`h-2 w-2 rounded-full ${available?'bg-[#7fb069]':'bg-[#d9a441]'}`} aria-hidden="true"/>{state}
    </div>
    <p className="mt-2 text-[14px] leading-4 text-[#a8a8a8]">{detail}</p>
  </Link>
}

async function readConnection<T>(read:()=>PromiseLike<T>){
  try{return await read()}catch{return {data:null,count:null,error:true} as const}
}

export default async function ConnectionsPage(){
  const session=await getSession()
  const tgNum=Number(session?.telegramId)
  if(!session||!Number.isSafeInteger(tgNum)||tgNum===0)return <p>Sign in to view your connections.</p>
  const profile=await getProfile(session.telegramId)
  const tg=String(session?.telegramId||'')
  const [vaultResult,userResult,travelResult,browserPermission,gmailConsent]=await Promise.all([
      readConnection(()=>supabaseAdmin.from('vault_credentials').select('id',{count:'exact',head:true}).eq('telegram_id',tgNum)),
      readConnection(()=>supabaseAdmin.from('users').select('gmail_connected,gmail_send_connected,gmail_connected_at,google_calendar_connected').eq('telegram_id',tgNum).maybeSingle()),
      readConnection(()=>supabaseAdmin.from('travel_tickets').select('id',{count:'exact',head:true}).eq('telegram_id',tgNum).gte('depart_at',new Date().toISOString())),
      readConnection(()=>supabaseAdmin.from('agent_permissions').select('level').eq('telegram_id',tg).eq('capability','browser').maybeSingle()),
      readConnection(()=>supabaseAdmin.from('user_consent_settings').select('gmail_enabled').eq('telegram_id',tgNum).maybeSingle()),
    ])
  const vaultKnown=!vaultResult.error&&Number.isInteger(vaultResult.count)&&Number(vaultResult.count)>=0
  const travelKnown=!travelResult.error&&Number.isInteger(travelResult.count)&&Number(travelResult.count)>=0
  const vaultCount=vaultKnown?Number(vaultResult.count):0
  const travelCount=travelKnown?Number(travelResult.count):0
  const u=userResult.data
  const authKnown=!userResult.error&&!!u
  const creditiqKnown=profile.ok&&profile.connectionStateKnown?.creditiq===true
  const c={googleCalendar:authKnown&&!!u?.google_calendar_connected,gmail:authKnown&&!!u?.gmail_connected,creditiq:profile.ok&&profile.connections.creditiq}
  // Drive via Composio (stopgap while AskGogo's own Google verification is pending, 24 Oct).
  let driveComposio=false
  try{const cg:any=await import('@/lib/connectors/composio-gmail');if(cg?.composioConfigured?.())driveComposio=!!(await cg.activeDriveAccount([tg]).catch(()=>null))}catch{}
  const browserLevel=String(browserPermission.data?.level||'draft')
  const browserKnown=!browserPermission.error&&['off','read','draft','ask','auto'].includes(browserLevel)
  const browserAvailable=browserKnown&&browserLevel!=='off'
  const browserState=!browserKnown?'Permission status unavailable':browserAvailable?`Permission · ${browserLevel}`:'Off'
  const gmailSend=authKnown&&Boolean(u?.gmail_send_connected)
  const gmailReadOff=gmailConsent?.data?.gmail_enabled===false
  const gmailReadUnknown=Boolean(gmailConsent?.error)
  // Duet parity step 5: one tap to let Gogo send email for you. Every send still waits for your approval and is
  // confirmed from your Sent folder. The signed link only grants the Gmail Send scope.
  const sendUpgradeUrl=authKnown&&c.gmail&&!gmailSend&&!gmailReadOff
    ?await import('@/lib/services/google-gmail').then(m=>m.buildGmailSendConnectUrl(tgNum)).catch(()=>null)
    :null

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="border-b border-[#1f1f1f] pb-5">
      <div className="final-dark-eyebrow">Reach · authority · evidence</div>
      <h1 className="final-dark-title mt-2 text-[34px]">Connections</h1>
      <Link href="/dashboard/commerce" className="mt-3 inline-block text-[16px] text-[#2fb8a6]">Connect food and grocery accounts →</Link>
      <p className="mt-2 max-w-3xl text-[16px] leading-5 text-[#9a9a9a]">What Gogo can reach, what it is allowed to do there, and what evidence is required before it claims success.</p>
    </header>

    <section className="mt-5" aria-labelledby="connection-overview">
      <h2 id="connection-overview" className="final-dark-eyebrow">At a glance</h2>
      <p className="mt-1 text-[15px] leading-5 text-[#a8a8a8]">Saved connection and permission state for this account. Open a card for what Gogo can do and how it verifies results.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ConnectionCard name="Gmail" state={!authKnown?'Connection status unavailable':!c.gmail?'Not connected':gmailReadUnknown?'Reading status unavailable':gmailReadOff?'Reading off':gmailSend?'Read and send connected':'Read only'}
          detail={!authKnown?'Your saved connection could not be checked.':!c.gmail?'Connect Gmail in You.':gmailReadUnknown?'Your reading preference could not be checked.':gmailReadOff?'Your saved preference disables reading.':'Reading does not authorize a send.'}
          available={c.gmail&&!gmailReadOff&&!gmailReadUnknown} href="/dashboard/you"/>
        <ConnectionCard name="Google Calendar" state={!authKnown?'Connection status unavailable':c.googleCalendar?'Connected':'Not connected'}
          detail={!authKnown?'Your saved connection could not be checked.':c.googleCalendar?'Events can be read; changes keep their approval boundary.':'Connect Calendar in You.'}
          available={c.googleCalendar} href="/dashboard/calendar"/>
        <ConnectionCard name="Secure Browser" state={browserState}
          detail={!browserKnown?'Your saved permission could not be checked.':browserAvailable?'Provider results still need page evidence.':'Browser access is disabled in your permissions.'}
          available={browserAvailable} href="/dashboard/agent"/>
        <ConnectionCard name="Vault" state={!vaultKnown?'Saved login status unavailable':vaultCount>0?`${vaultCount} saved login${vaultCount===1?'':'s'}`:'No saved logins'}
          detail={!vaultKnown?'Your saved login count could not be checked.':vaultCount>0?'Logins stay bound to their provider domains.':'Add a provider login only when you need one.'}
          available={vaultCount>0} href="/dashboard/you/vault"/>
      </div>
    </section>

    {sendUpgradeUrl&&<section className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-[#24433e] bg-[#101f1d] px-4 py-4" aria-labelledby="gmail-send-upgrade">
      <div className="min-w-0">
        <h2 id="gmail-send-upgrade" className="text-[16px] font-semibold text-[#f2efea]">Let Gogo send email for you</h2>
        <p className="mt-1 text-[14px] leading-5 text-[#a8a8a8]">Gmail is connected read-only. Allow sending once; every email still waits for your OK and is checked in your Sent folder.</p>
      </div>
      <a href={sendUpgradeUrl} className="flex min-h-11 shrink-0 items-center rounded-full bg-[#2fb8a6] px-5 text-[15px] font-semibold text-[#04201c]">Allow sending</a>
    </section>}

    <section className="mt-5 final-dark-panel overflow-hidden">
      <div className="hidden border-b border-[#1f1f1f] px-4 py-3 text-[12px] uppercase tracking-[.14em] text-[#555] lg:grid lg:grid-cols-[170px_130px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div>Connection</div><div>Availability</div><div>Operations</div><div>Approval</div><div>Evidence</div><div />
      </div>
      <div className="px-4">
        <ConnRow name="Google Calendar" state={!authKnown?'Connection status unavailable':c.googleCalendar?'Connected':'Not connected'} available={c.googleCalendar}
          operations="Read schedules and exact events; prepare/create/update calendar events."
          approval="Reads are safe. Create/update/delete remains behind the calendar approval boundary."
          verification="Google Calendar read-back of the exact event/object after mutation."
          detail={c.googleCalendar?'Connection recorded on this account.':undefined} href="/dashboard/calendar"/>
        <ConnRow name="Gmail" state={!authKnown?'Connection status unavailable':c.gmail?(gmailReadUnknown?'Connected · Reading status unavailable':gmailReadOff?'Connected · Reading off':gmailSend?'Connected · Send enabled':'Connected · Read only'):'Not connected'} available={c.gmail&&!gmailReadOff&&!gmailReadUnknown}
          operations={!authKnown?'Gmail connection and send permission could not be checked.':gmailSend?'Read/search mail, inspect attachments, draft and approved send.':'Read/search mail and attachments; drafts are safe. Gmail Send has not been granted.'}
          approval="Reading never authorizes sending. Every consequential send requires the existing bounded approval."
          verification="Gmail provider message/thread evidence; send success requires provider read-back."
          detail={gmailReadUnknown?'Could not verify your reading preference.':gmailReadOff?'Email reading is disabled in your saved privacy preference.':'Connecting Gmail alone does not start an inbox watch.'} href="/dashboard/you"/>
        <ConnRow name="Google Drive" state={driveComposio?'Connected via Google (Composio)':!authKnown?'Connection status unavailable':c.gmail?'Connected via Workspace':'Not connected'} available={c.gmail||driveComposio}
          detail={driveComposio||c.gmail?undefined:'Tap to connect with Google. The consent screen says Composio while our own Google review is pending.'}
          operations="Read/search Drive context and fetch supported files for bounded analysis."
          approval="Read-only Workspace scope. File mutation is not granted by this connection."
          verification="Drive file ID + bounded provider content; no substitute document on ambiguity." href={c.gmail||driveComposio?'/dashboard/you':'/api/connect/google-drive'}/>
        <ConnRow name="Secure Browser" state={browserState} available={browserAvailable}
          operations="Read websites, prepare forms, monitor pages and execute explicitly approved browser actions."
          approval="Consequential submit/book/buy actions require approval; passwords, OTPs, passkeys and payment auth stay human-only."
          verification="Provider page / terminal evidence; uncertain submits become outcome-unknown and are never blindly retried." href="/dashboard/agent"/>
        <ConnRow name="Vault" state={!vaultKnown?'Saved login status unavailable':vaultCount>0?`${vaultCount} saved login${vaultCount===1?'':'s'}`:'No saved logins'} available={vaultCount>0}
          operations="Domain-bound credential injection for providers without a proper connection; authenticated session reuse where available."
          approval="Secrets never enter chat/model context. Secondary auth stays human-only."
          verification="Vault audit + provider session state; credentials themselves are never exposed." href="/dashboard/you/vault"/>
        <ConnRow name="Travel context" state={!travelKnown?'Travel status unavailable':travelCount>0?`${travelCount} upcoming leg${travelCount===1?'':'s'}`:'No upcoming saved travel'} available={travelCount>0}
          operations="Use saved itinerary context, prepare check-in, bounded monitoring and contextual planning."
          approval="Research/monitoring is read-only. Check-in submit, booking or payment keeps the normal consequential-action gate."
          verification="Saved ticket/life-event source refs plus provider evidence; inferred presence is labelled as inference." href="/dashboard/agent"/>
        <ConnRow name="CreditIQ" state={!creditiqKnown?'Connection status unavailable':c.creditiq?'Connected':'Not connected'} available={creditiqKnown&&c.creditiq}
          operations="Use linked card/reward intelligence as contextual decision support."
          approval="CreditIQ context is evidence, not authority to redeem, pay or spend."
          verification="Connected-account data where available; user-entered balances remain labelled as unverified." href="/dashboard/you"/>
      </div>
    </section>

    <section className="mt-5 grid gap-4 md:grid-cols-2">
      <div className="final-dark-panel p-4">
        <div className="final-dark-eyebrow">Security boundary</div>
        <p className="mt-3 text-[15px] leading-5 text-[#9a9a9a]">Passwords, one-time codes, passkeys and payment-auth values never belong in chat or memory. Connections provide reach; they do not silently grant execution authority.</p>
      </div>
      <div className="final-dark-panel p-4">
        <div className="final-dark-eyebrow">Evidence boundary</div>
        <p className="mt-3 text-[15px] leading-5 text-[#9a9a9a]">Gogo should only claim a mutation succeeded after provider-grounded read-back. If the provider cannot confirm the outcome, the run remains blocked or outcome-unknown rather than guessed.</p>
      </div>
    </section>
  </div>
}
