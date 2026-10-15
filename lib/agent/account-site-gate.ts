// "Check my last Amazon order" needs the person's own Amazon account. If they have not signed in to that site in
// Gogo's secure browser yet, say so straight away with the Settings link, instead of loading the site's public pages
// until the WhatsApp time limit runs out ("the provider site took longer than WhatsApp's safe response window").
import { CONNECTION_CATALOGUE, VAULT_CONNECT_SITES, catalogueDomain, connectPath, type CatalogueSite } from '@/lib/dashboard/connection-catalogue'
import { listSiteConnections } from '@/lib/dashboard/site-sessions'

export const CONNECTIONS_URL = 'https://app.askgogo.in/dashboard/settings?section=connections'

// Tickets, trips and bookings are left out: "show my IndiGo ticket" is answered from saved tickets, not the site.
const ACCOUNT_THING = String.raw`(?:orders?|order history|purchases?|returns?|refunds?|cart|basket|wishlist|account|deliver(?:y|ies)|shipments?|rides?|appointments?|bills?|subscriptions?)`

function siteNames(site: CatalogueSite) {
  const base = site.name.toLowerCase()
  // "booking" alone is an ordinary word, so Booking.com only matches by its full name.
  const names = new Set(site.id === 'booking' ? [base] : [base, base.replace(/\.(?:in|com)$/, ''), site.id])
  return [...names].filter(n => n.length >= 3).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
}

/** The sign-in site a message is about, when it asks about the person's own account there. */
export function accountSiteFromText(text: string): CatalogueSite | null {
  const t = String(text || '').toLowerCase()
  if (!/\b(?:my|mine|i\s+(?:ordered|bought|booked))\b/.test(t)) return null
  for (const site of CONNECTION_CATALOGUE) {
    if (site.kind !== 'signin') continue
    const name = `(?:${siteNames(site).join('|')})`
    const near = new RegExp(String.raw`\b${name}\b(?:\W+\w+){0,3}?\W+${ACCOUNT_THING}\b|\b${ACCOUNT_THING}\b(?:\W+\w+){0,3}?\W+(?:on|from|at|in)\W+${name}\b`, 'i')
    if (near.test(t)) return site
  }
  return null
}

export const APP_URL = 'https://app.askgogo.in'

export function signInFirstReply(site: CatalogueSite, ask?: string) {
  // Sites Gogo can sign in to itself (Amazon, Flipkart...): one tap to connect, then Gogo carries on with the question.
  if (VAULT_CONNECT_SITES[site.id]) {
    return `To check that I need to sign in to ${site.name} for you, once. Connect it here (about 20 seconds); your login is sealed in your Gogo vault and never goes through chat:\n${APP_URL}${connectPath(site, ask)}\n\nI'll carry on with your question as soon as it's connected.`
  }
  return `To check your ${site.name} account I need you to sign in to ${site.name} once. Open Settings, find ${site.name} and tap Sign in, then sign in yourself in the secure browser (Gogo never sees your password):\n${CONNECTIONS_URL}\n\nAfter you tap "I'm signed in", ask me again.`
}

/** A reply when the message needs a site account the person has not connected; null otherwise. */
export async function tryAccountSiteSignInGate(params: { telegramId: string | number; text: string }) {
  const site = accountSiteFromText(params.text)
  if (!site) return null
  const connected = await listSiteConnections(String(params.telegramId)).catch(() => null)
  if (!connected) return null
  if (connected.some(row => row.siteId === site.id && row.status === 'active')) return null
  // A saved vault login for the site also counts: Gogo signs in with it.
  if (VAULT_CONNECT_SITES[site.id]) {
    const { listVaultCredentials } = await import('@/lib/vault/credential-store')
    const saved = await listVaultCredentials(String(params.telegramId)).catch(() => null)
    if (!saved) return null
    if (saved.some(item => item.status === 'active' && (item.allowedDomains || []).some((d: string) => d === catalogueDomain(site) || d.endsWith('.' + catalogueDomain(site))))) return null
  }
  return { text: signInFirstReply(site, params.text), status: 'paused' as const, handledBy: 'account-site-sign-in', siteId: site.id }
}
