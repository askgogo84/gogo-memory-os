// When Gogo cannot finish creating an account, it hands the task back in one clear message:
// what happened, whether anything was submitted, the exact details to use, the sign-up link,
// and where the generated password is saved. Pure: no I/O, no secrets.
import { findVaultProviderForDomain } from '@/lib/vault/providers'

export type SignupHandbackReason = 'captcha' | 'unverified' | 'blocked' | 'error'
export type SignupHandbackVault = 'saved' | 'pending' | 'discarded' | null

export type SignupProfile = { email: string | null; username: string | null; fullName: string | null }

/** Reads the exact values from the approved objective ("…using email E, username U and full name N."). */
export function signupProfileFromObjective(objective: string): SignupProfile {
  const text = String(objective || '')
  const email = text.match(/\busing email\s+([^\s,]+@[^\s,]+?)(?=[,\s]|\.\s|\.$|$)/i)?.[1] || null
  const username = text.match(/\busername\s+([^\s,]+?)(?=\s+and full name\b|[,.]?\s|[,.]?$)/i)?.[1] || null
  const fullName = text.match(/\band full name\s+(.+?)\.(?:\s|$)/i)?.[1]?.trim() || null
  return { email: email ? email.toLowerCase() : null, username, fullName }
}

function siteLabel(url: string): { label: string; host: string } {
  let host = ''
  try { host = new URL(url).hostname.replace(/^www\./, '') } catch {}
  return { label: findVaultProviderForDomain(host)?.label || host || 'This site', host }
}

export function buildSignupHandback(params: {
  signupUrl: string
  objective: string
  reason: SignupHandbackReason
  submitted: boolean
  vault: SignupHandbackVault
  vaultLabel?: string | null
  vaultUrl: string
  takeoverUrl?: string | null
}): string {
  const { label } = siteLabel(params.signupUrl)
  const profile = signupProfileFromObjective(params.objective)
  const why = params.reason === 'captcha'
    ? 'it hit a CAPTCHA that only a person can complete'
    : params.reason === 'unverified'
      ? 'Gogo could not confirm the last step on the page'
      : params.reason === 'blocked'
        ? 'the site limited automated access'
        : 'the secure browser stopped before the end'
  const submittedLine = params.submitted
    ? `Gogo pressed the final button, but could not confirm the account exists. Check your email for a message from ${label} first; if there is one, the account was created.`
    : 'Nothing was submitted.'
  const details = [
    profile.email ? `email ${profile.email}` : null,
    profile.username ? `username ${profile.username}` : null,
    profile.fullName ? `name ${profile.fullName}` : null,
  ].filter(Boolean).join(', ')
  const vaultLine = params.vault === 'saved'
    ? `Gogo saved the password in your Vault as "${params.vaultLabel || label}". Open it here to view or copy it: ${params.vaultUrl}`
    : params.vault === 'pending'
      ? 'Gogo is holding the generated password securely but could not add it to your Vault yet. Choose your own password on the site.'
      : 'Choose your own password on the site.'
  const lines = [
    `${label} account not created: ${why}. ${submittedLine}`,
    '',
    `You can finish it here: ${params.signupUrl}${details ? `\nUse ${details}.` : ''}`,
    '',
    vaultLine,
  ]
  if (params.takeoverUrl && !params.submitted) {
    lines.push('', `Or finish in Gogo's browser, where the form is already filled in (tap Take control, complete the check, then Resume this task): ${params.takeoverUrl}`)
  }
  lines.push('', 'Never send passwords or codes in chat.')
  return lines.join('\n')
}
