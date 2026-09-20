import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { getVaultProvider } from '@/lib/vault/providers'
import { VaultCredentialForm } from '@/components/dashboard/vault-credential-form'

export const dynamic='force-dynamic'

export default async function AddVaultCredentialPage({params,searchParams}:{params:Promise<{provider:string}>;searchParams:Promise<{label?:string}>}){
  const session=await getSession()
  if(!session)redirect('/dashboard')
  const {provider:providerKey}=await params
  const query=await searchParams
  const provider=getVaultProvider(providerKey)
  if(!provider)notFound()

  return <div className="mx-auto w-full max-w-[620px] pb-12">
    <Link href="/dashboard/you/vault" className="text-[11px] font-bold uppercase tracking-[.12em] text-gogo-ink-3">← Vault</Link>
    <div className="mt-5 rounded-[26px] border border-gogo-ink/10 bg-gogo-surface/82 p-6 shadow-[0_18px_50px_rgba(62,35,18,.05)] sm:p-8">
      <div className="grid h-12 w-12 place-items-center rounded-[15px] bg-gogo-ink text-xl text-white">🔒</div>
      <p className="mt-5 text-[10px] font-bold uppercase tracking-[.14em] text-gogo-ink-3">Secure login</p>
      <h1 className="mt-1 font-serif text-[31px] font-semibold tracking-[-.02em] text-gogo-ink">{provider.label}</h1>
      <p className="mt-2 text-[13px] leading-5 text-gogo-ink-3">Save this once. Gogo can reuse the login only on {provider.domains.join(', ')} and will prefer an existing authenticated browser session whenever possible.</p>
      <div className="mt-7">
        <VaultCredentialForm
          provider={provider.key}
          providerLabel={provider.label}
          usernameLabel={provider.usernameLabel}
          secretLabel={provider.secretLabel}
          note={provider.note}
          accountLabelDefault={String(query?.label||provider.label)}
        />
      </div>
    </div>
  </div>
}
