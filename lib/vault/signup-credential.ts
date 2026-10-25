// Sign-up credential lifecycle for the secure browser.
//
// begin:   before a sign-up form is submitted, generate a password and record it as PENDING
//          (vault_pending_credentials). If that record cannot be written, the sign-up does not
//          proceed — nothing is submitted with a password that could be lost.
// resolve: after the submit, a verified "account created" commits the password to the Vault;
//          a clear rejection (for example "an account already exists") discards it; anything
//          unclear leaves it pending so it can be recovered rather than guessed.
//
// The password is returned only to the trusted backend caller, which passes it to the browser
// worker as a command-scoped variable. It never reaches the model, Activity, or logs.
import { generateCredentialSecret } from './generated-credential'
import {
  createPendingSignupCredential,
  discardPendingSignupCredential,
  findCommittedSignupForRun,
  findPendingSignupForRun,
  markPendingSignupCommitted,
  readPendingSignupForCommit,
} from './pending-credentials'
import { findVaultCredentialIdByLabel, ownerTelegramId, resolveVaultCredentialForDomain, saveVaultCredential } from './credential-store'
import { normalizeVaultDomain } from './domain-policy'
import { findVaultProviderForDomain } from './providers'

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i

// The account's username is the email the person named in the request (the authority source),
// never a value read from the provider's page.
export function signupUsernameFromObjective(objective: string): string | null {
  const match = String(objective || '').match(EMAIL)
  return match ? match[0].toLowerCase() : null
}

export type BegunSignup = {
  pendingId: string
  telegramId: string
  domain: string
  username: string
  secret: string
  /** Already saved to the Vault (handed back earlier in this run); nothing left to commit. */
  committed?: boolean
}

/** The Vault label for a generated sign-up password, e.g. "Hugging Face – you@example.com". */
export function signupVaultLabel(domain: string, username: string): string {
  const provider = findVaultProviderForDomain(domain)
  return `${provider?.label || domain} – ${String(username || '').trim().toLowerCase()}`.slice(0, 120)
}

export async function beginSignupCredential(params: {
  ownerId: string
  runId: string
  url: string
  objective: string
}): Promise<BegunSignup> {
  const username = signupUsernameFromObjective(params.objective)
  if (!username) throw new Error('signup_username_missing')
  const domain = normalizeVaultDomain(params.url)
  if (!domain) throw new Error('signup_domain_invalid')
  if (!params.runId) throw new Error('signup_run_missing')
  const telegramId = await ownerTelegramId(params.ownerId)
  // A resumed run (after the person completed a human check) reuses the password it already
  // generated, so the form and the Vault always hold the same value.
  const existing = await resumeSignupCredential({ ownerId: params.ownerId, runId: params.runId, telegramId })
  if (existing) return existing
  const secret = generateCredentialSecret()
  const pending = await createPendingSignupCredential({ telegramId, runId: params.runId, domain, username, secret })
  return { pendingId: pending.id, telegramId, domain, username, secret }
}

/** The pending sign-up password of this run, if one exists (host-only; contains the secret). */
export async function resumeSignupCredential(params: { ownerId: string; runId: string; telegramId?: string }): Promise<BegunSignup | null> {
  if (!params.runId) return null
  const telegramId = params.telegramId || await ownerTelegramId(params.ownerId)
  const pendingId = await findPendingSignupForRun({ telegramId, runId: params.runId })
  if (!pendingId) {
    // Handed back earlier: the password is already in the Vault. Reuse it so the form, the Vault
    // and anything the person typed all hold the same value.
    const committed = await findCommittedSignupForRun({ telegramId, runId: params.runId })
    if (!committed) return null
    const saved = await resolveVaultCredentialForDomain({ telegramId, credentialId: committed.credentialId, domain: committed.domain }).catch(() => null)
    if (!saved?.secret || !saved.username) return null
    return { pendingId: committed.pendingId, telegramId, domain: committed.domain, username: saved.username, secret: saved.secret, committed: true }
  }
  const stored = await readPendingSignupForCommit({ telegramId, pendingId })
  return { pendingId, telegramId, domain: stored.domain, username: stored.username, secret: stored.secret }
}

// created:  the site confirmed the account; save the password.
// handback: Gogo could not finish (a CAPTCHA, an unclear result). Save the password anyway
//           so the person can finish the sign-up or sign in with it themselves.
// rejected: the site clearly refused (for example the account already exists); discard it.
export type SignupOutcome = 'created' | 'handback' | 'rejected' | 'unknown'
export type SignupVaultResult = 'saved' | 'discarded' | 'pending'

export async function resolveSignupCredential(begun: Pick<BegunSignup, 'pendingId' | 'telegramId' | 'committed'>, outcome: SignupOutcome): Promise<SignupVaultResult> {
  if (begun.committed) return 'saved'
  if (outcome === 'unknown') return 'pending'
  if (outcome === 'rejected') {
    await discardPendingSignupCredential({ telegramId: begun.telegramId, pendingId: begun.pendingId }).catch((error) => {
      console.error('SIGNUP_PENDING_DISCARD_FAILED:', String(error?.message || error).slice(0, 120))
    })
    return 'discarded'
  }
  try {
    const stored = await readPendingSignupForCommit({ telegramId: begun.telegramId, pendingId: begun.pendingId })
    const provider = findVaultProviderForDomain(stored.domain)
    const providerKey = provider?.key || stored.domain
    const accountLabel = signupVaultLabel(stored.domain, stored.username)
    // A second attempt for the same email replaces that entry: the newest password is the one the
    // site's form holds now.
    const existingId = await findVaultCredentialIdByLabel(begun.telegramId, providerKey, accountLabel)
    const credential = await saveVaultCredential({
      telegramId: begun.telegramId,
      credentialId: existingId,
      provider: providerKey,
      accountLabel,
      username: stored.username,
      secret: stored.secret,
      allowedDomains: provider?.domains?.length ? provider.domains : [stored.domain],
      metadata: { source: 'secure_browser_signup', outcome, ...(provider?.loginUrl ? { login_url: provider.loginUrl } : {}) },
    })
    await markPendingSignupCommitted({ telegramId: begun.telegramId, pendingId: begun.pendingId, credentialId: credential.id })
    return 'saved'
  } catch (error: any) {
    // The account may exist with this password. Keep the pending row for recovery.
    console.error('SIGNUP_VAULT_COMMIT_FAILED:', JSON.stringify({ pendingId: begun.pendingId, reason: String(error?.message || error).slice(0, 120) }))
    return 'pending'
  }
}
