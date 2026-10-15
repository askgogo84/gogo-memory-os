// Signing in to a site for Gogo: the site opens in the person's own private secure browser, they type the password or
// OTP themselves, and Gogo keeps only the signed-in browser session (the persistent profile), never the password.
// The connection is recorded in vault_sessions (auth_method human_handoff) so Settings can show it and it can be
// removed. Removing it stops Gogo using the session; signing out on the site itself ends it there too.
import { supabaseAdmin } from '@/lib/supabase-admin'
import type { AgentActor } from '@/lib/agent/actor'
import { listVaultSessions, upsertVaultSession, markVaultSessionStatus } from '@/lib/vault/session-store'
import { CONNECTION_CATALOGUE, catalogueDomain, findCatalogueSite, type CatalogueSite } from './connection-catalogue'

export type SiteConnection = { siteId: string; name: string; domain: string; status: string; since: string | null }

export function signInObjective(site: CatalogueSite) {
  return `Open ${site.name} so the person can sign in themselves. Do not type, read or store any password, OTP or card detail.`
}

/** Opens the site in the person's secure browser for them to sign in. Returns the task to send them to. */
export async function startSiteSignIn(actor: AgentActor, siteId: string) {
  const site = findCatalogueSite(siteId)
  if (!site || site.kind === 'soon') throw new Error('site_not_available')
  const owner = String(actor.legacyTelegramId)
  const now = new Date().toISOString()
  const { data: run, error } = await supabaseAdmin.from('agent_runs').insert({
    telegram_id: owner, type: 'secure_browser', capability: 'browser', status: 'queued',
    title: `Sign in · ${site.name}`,
    summary: `Sign in to ${site.name} yourself in the secure browser, then come back to Settings and tap "I'm signed in".`,
    progress: 0, why: 'You sign in yourself; Gogo keeps the signed-in session, never your password.', source: 'web',
    metadata_json: { plan_type: 'secure_browser', url: site.url, objective: signInObjective(site), mode: 'read', risk: 'low', site_session: site.id },
    started_at: now, updated_at: now,
  }).select('id').single()
  if (error || !run?.id) throw new Error(`site_sign_in_create_failed:${error?.message || 'unknown'}`)
  const runId = String(run.id)
  const { startProviderBrowserHandoff } = await import('@/lib/agent/provider-browser-handoff')
  const handoff = await startProviderBrowserHandoff({ userId: actor.userId, url: site.url, sessionTaskId: runId })
  const { error: saveError } = await supabaseAdmin.from('agent_runs').update({
    status: 'paused', updated_at: new Date().toISOString(),
    metadata_json: { plan_type: 'secure_browser', url: site.url, objective: signInObjective(site), mode: 'read', risk: 'low', site_session: site.id, handoff },
  }).eq('id', runId).eq('telegram_id', owner)
  if (saveError) throw new Error(`site_sign_in_save_failed:${saveError.message}`)
  return { runId, site }
}

/** The person says they finished signing in: record the session and close the sign-in task. */
export async function confirmSiteSignIn(actor: AgentActor, siteId: string) {
  const site = findCatalogueSite(siteId)
  if (!site || site.kind === 'soon') throw new Error('site_not_available')
  const { browserSandboxNameFor, SANDBOX_GENERATION } = await import('@/lib/agent/secure-browser-bootstrap')
  const owner = String(actor.legacyTelegramId)
  await upsertVaultSession({
    telegramId: owner, provider: site.name, domain: catalogueDomain(site),
    sandboxName: browserSandboxNameFor(actor.userId), profileGeneration: SANDBOX_GENERATION,
    status: 'active', authMethod: 'human_handoff', metadata: { site: site.id, confirmedBy: 'person' },
  })
  const at = new Date().toISOString()
  await supabaseAdmin.from('agent_runs').update({
    status: 'completed', progress: 100, completed_at: at, updated_at: at,
    summary: `You signed in to ${site.name}. Gogo can use this session; it never saw your password.`,
  }).eq('telegram_id', owner).eq('type', 'secure_browser').eq('status', 'paused').eq('metadata_json->>site_session', site.id)
  return site
}

/** Stop Gogo using a site session. */
export async function removeSiteConnection(actor: AgentActor, siteId: string) {
  const site = findCatalogueSite(siteId)
  if (!site) throw new Error('site_unknown')
  const { browserSandboxNameFor } = await import('@/lib/agent/secure-browser-bootstrap')
  await markVaultSessionStatus({ telegramId: String(actor.legacyTelegramId), domain: catalogueDomain(site), sandboxName: browserSandboxNameFor(actor.userId), status: 'revoked' })
  return site
}

/** Sites with a live session, matched to the catalogue by domain. */
export async function listSiteConnections(telegramId: string): Promise<SiteConnection[]> {
  const sessions = await listVaultSessions(telegramId).catch(() => [])
  const out: SiteConnection[] = []
  for (const session of sessions) {
    if (session.status === 'revoked' || session.status === 'expired') continue
    const site = CONNECTION_CATALOGUE.find(item => catalogueDomain(item) === session.domain || session.domain.endsWith('.' + catalogueDomain(item)))
    if (!site || out.some(row => row.siteId === site.id)) continue
    out.push({ siteId: site.id, name: site.name, domain: session.domain, status: session.status, since: session.updatedAt })
  }
  return out
}
