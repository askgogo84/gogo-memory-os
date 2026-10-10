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
  markPendingSignupCommitted,
  readPendingSignupForCommit,
} from './pending-credentials'
import { ownerTelegramId, saveVaultCredential } from './credential-store'
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
  const secret = generateCredentialSecret()
  const pending = await createPendingSignupCredential({ telegramId, runId: params.runId, domain, username, secret })
  return { pendingId: pending.id, telegramId, domain, username, secret }
}

export type SignupOutcome = 'created' | 'rejected' | 'unknown'
export type SignupVaultResult = 'saved' | 'discarded' | 'pending'

export async function resolveSignupCredential(begun: Pick<BegunSignup, 'pendingId' | 'telegramId'>, outcome: SignupOutcome): Promise<SignupVaultResult> {
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
    const credential = await saveVaultCredential({
      telegramId: begun.telegramId,
      provider: provider?.key || stored.domain,
      accountLabel: provider?.label || stored.domain,
      username: stored.username,
      secret: stored.secret,
      allowedDomains: provider?.domains?.length ? provider.domains : [stored.domain],
      metadata: { source: 'secure_browser_signup' },
    })
    await markPendingSignupCommitted({ telegramId: begun.telegramId, pendingId: begun.pendingId, credentialId: credential.id })
    return 'saved'
  } catch (error: any) {
    // The account may exist with this password. Keep the pending row for recovery.
    console.error('SIGNUP_VAULT_COMMIT_FAILED:', JSON.stringify({ pendingId: begun.pendingId, reason: String(error?.message || error).slice(0, 120) }))
    return 'pending'
  }
}
