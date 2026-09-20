import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { listVaultCredentials } from '@/lib/vault/credential-store'
import { VAULT_PROVIDERS } from '@/lib/vault/providers'
import { VaultRemoveButton } from '@/components/dashboard/vault-remove-button'

export const dynamic='force-dynamic'

function fmt(value:string|null){
  if(!value)return 'Never'
  const d=new Date(value)
  if(Number.isNaN(d.getTime()))return 'Never'
  return new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(d)
}

export default async function VaultPage(){
  const session=await getSession()
  if(!session)redirect('/dashboard')
  const items=await listVaultCredentials(session.telegramId)

  return <div className="mx-auto w-full max-w-[1080px] pb-10">
    <header className="border-b border-gogo-ink/10 pb-5">
      <Link href="/dashboard/you" className="text-[11px] font-bold uppercase tracking-[.12em] text-gogo-ink-3">← You & connections</Link>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.14em] text-gogo-ink-3">Secure infrastructure</p>
          <h1 className="mt-1 font-serif text-[34px] font-semibold tracking-[-.02em] text-gogo-ink">Vault</h1>
          <p className="mt-2 max-w-2xl text-[13px] leading-5 text-gogo-ink-3">Saved website logins Gogo can use only through the secure browser on explicitly allowed domains. Passwords are never shown again after saving.</p>
        </div>
        <Link href="/dashboard/you/vault/add/instagram" className="inline-flex h-11 items-center justify-center rounded-[12px] bg-gogo-ink px-4 text-[13px] font-semibold text-white">Add login</Link>
      </div>
    </header>

    <section className="mt-6">
      <div className="flex items-center justify-between">
        <h2 className="text-[13px] font-semibold text-gogo-ink">Saved logins</h2>
        <span className="text-[11px] text-gogo-ink-3">{items.length}</span>
      </div>

      {items.length===0?
        <div className="mt-3 rounded-[22px] border border-dashed border-gogo-ink/12 bg-gogo-surface/70 p-7">
          <h3 className="font-serif text-[23px] font-semibold text-gogo-ink">Nothing saved yet.</h3>
          <p className="mt-2 max-w-xl text-[13px] leading-5 text-gogo-ink-3">When a browser task needs a login, Gogo can send you here instead of asking for a password in chat.</p>
        </div>
      :
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {items.map(item=>{
            const provider=VAULT_PROVIDERS[item.provider]
            return <article key={item.id} className="rounded-[20px] border border-gogo-ink/10 bg-gogo-surface/78 p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[10px] font-bold uppercase tracking-[.12em] text-gogo-ink-3">{provider?.label||item.provider}</div>
                  <h3 className="mt-1 truncate text-[15px] font-semibold text-gogo-ink">{item.accountLabel}</h3>
                  <p className="mt-1 text-[12px] text-gogo-ink-3">{item.usernameHint}</p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-gogo-ink/10 px-2.5 py-1 text-[10px] font-semibold text-gogo-ink-2"><span className={`h-2 w-2 rounded-full ${item.status==='active'?'bg-[#2FB8A6]':'bg-amber-500'}`}/>{item.status==='active'?'Saved':'Needs re-auth'}</span>
              </div>
              <div className="mt-4 rounded-[12px] bg-gogo-cream/55 px-3 py-3 text-[11px] leading-5 text-gogo-ink-3">
                Allowed: {item.allowedDomains.join(', ')||'—'}<br/>
                Last used: {fmt(item.lastUsedAt)}
              </div>
              <div className="mt-4 flex items-center justify-between gap-2">
                <Link href={`/dashboard/you/vault/add/${encodeURIComponent(item.provider)}?label=${encodeURIComponent(item.accountLabel)}`} className="rounded-full border border-gogo-ink/12 px-3 py-1.5 text-[11px] font-semibold text-gogo-ink-2">Update</Link>
                <VaultRemoveButton id={item.id}/>
              </div>
            </article>
          })}
        </div>}
    </section>

    <section className="mt-7">
      <p className="text-[10px] font-bold uppercase tracking-[.14em] text-gogo-ink-3">Supported now</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {Object.values(VAULT_PROVIDERS).map(provider=><Link key={provider.key} href={`/dashboard/you/vault/add/${provider.key}`} className="rounded-full border border-gogo-ink/12 bg-gogo-surface/70 px-3 py-2 text-[11px] font-semibold text-gogo-ink-2">{provider.label}</Link>)}
      </div>
    </section>
  </div>
}
