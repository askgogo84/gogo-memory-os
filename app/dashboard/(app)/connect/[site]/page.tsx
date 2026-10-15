import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { findCatalogueSite, VAULT_CONNECT_SITES } from '@/lib/dashboard/connection-catalogue'
import { getVaultProvider } from '@/lib/vault/providers'
import { ConnectSiteForm } from '@/components/dashboard/connect-site-form'

export const dynamic = 'force-dynamic'

// Connect a site from chat (approved mock, 15 Oct): Gogo's reply links here, the person saves a phone number or a
// password to the vault, and the original question runs again in Gogo chat.
export default async function ConnectSitePage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ ask?: string }> }) {
  const session = await getSession()
  if (!session) notFound()
  const site = findCatalogueSite((await params).site)
  const provider = site && VAULT_CONNECT_SITES[site.id] ? getVaultProvider(VAULT_CONNECT_SITES[site.id]) : null
  if (!site || !provider) notFound()
  const ask = String((await searchParams)?.ask || '').slice(0, 300)
  return <div className="mx-auto w-full max-w-[520px] pb-10">
    <ConnectSiteForm siteName={site.name} siteDomain={provider.domains[0]} providerKey={provider.key} usernameLabel={provider.usernameLabel} phoneOnly={!!provider.phoneOnly} ask={ask} />
  </div>
}
