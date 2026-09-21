import Link from 'next/link'
import { getSession } from '@/lib/dashboard/session'
import { getProfile } from '@/lib/dashboard/queries'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

function ConnRow({name,state,detail,href}:{name:string;state:boolean;detail:string;href?:string}){
  const body=<div className="grid gap-3 border-t border-[#1f1f1f] py-4 first:border-t-0 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-start">
    <div className="text-[13px] font-medium text-[#f2efea]">{name}</div>
    <div><div className={`text-[11px] font-medium ${state?'text-[#7fb069]':'text-[#9a9a9a]'}`}>{state?'Connected':'Not connected'}</div><div className="mt-1 text-[11px] leading-4 text-[#6a6a6a]">{detail}</div></div>
    {href&&<span className="text-[10px] text-[#2fb8a6]">Open →</span>}
  </div>
  return href?<Link href={href} className="block hover:bg-[#141414]">{body}</Link>:body
}

export default async function ConnectionsPage(){
  const session=await getSession()
  const profile=session?await getProfile(session.telegramId):({ok:false} as const)
  const tgNum=parseInt(session?.telegramId||'',10)
  const {count:vaultCount}=Number.isFinite(tgNum)
    ?await supabaseAdmin.from('vault_credentials').select('id',{count:'exact',head:true}).eq('telegram_id',tgNum)
    :{count:0}
  const c=profile.ok?profile.connections:{googleCalendar:false,gmail:false,creditiq:false}
  return <div className="mx-auto w-full max-w-[1100px] pb-10">
    <header className="border-b border-[#1f1f1f] pb-5">
      <div className="final-dark-eyebrow">Reach</div>
      <h1 className="final-dark-title mt-2 text-[34px]">Connections</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#9a9a9a]">What Gogo can reach, and what it may use to help you.</p>
    </header>
    <section className="mt-5 final-dark-panel overflow-hidden">
      <div className="px-4">
        <ConnRow name="Google Calendar" state={c.googleCalendar} detail="Read context and create approved calendar events." href="/dashboard/calendar"/>
        <ConnRow name="Gmail" state={c.gmail} detail="Read connected mail for context, confirmations and approved drafts." href="/dashboard/you"/>
        <ConnRow name="CreditIQ" state={c.creditiq} detail="Connected card/reward intelligence context." href="/dashboard/you"/>
        <ConnRow name="Vault" state={(vaultCount||0)>0} detail={`${vaultCount||0} saved login${vaultCount===1?'':'s'} for sites without a proper connection. Credentials stay sealed and domain-bound.`} href="/dashboard/you/vault"/>
      </div>
    </section>
    <section className="mt-5 final-dark-panel p-4">
      <div className="final-dark-eyebrow">Security boundary</div>
      <p className="mt-3 max-w-3xl text-[12px] leading-5 text-[#9a9a9a]">Passwords, one-time codes, passkeys and payment-auth values never belong in chat or memory. Gogo pauses at those steps and gives control back to you.</p>
    </section>
  </div>
}
