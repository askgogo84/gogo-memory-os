// Two-phase generated credentials for sign-up.
//
// A generated password is held as PENDING until the site's own success state is verified.
// Only then is it committed to the Vault. A rejected sign-up is discarded, so it never becomes
// a saved login. The secret is held in memory here and never returned to a model or a log;
// callers receive secret-free ids and metadata.
//
// Limits: this ledger lives in one process. It is a building block, not the durable store.
// Production sign-up must persist the pending entry before the form is submitted, so a crash
// between submit and commit can still be recovered. Do not wire this into the browser path
// until that store exists.
import { randomBytes, randomInt } from 'node:crypto'

const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*-_=+'
const MIN_LENGTH = 16
const MAX_LENGTH = 64
export const COMMIT_WINDOW_MS = 60_000

export function generateCredentialSecret(length = 24): string {
  const size = Math.max(MIN_LENGTH, Math.min(MAX_LENGTH, Math.floor(length)))
  const all = LOWER + UPPER + DIGITS + SYMBOLS
  const pick = (set: string) => set[randomInt(set.length)]
  // One character from each class guarantees the usual site rules; the rest is uniform.
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < size) chars.push(pick(all))
  // Fisher–Yates shuffle with the CSPRNG so the class-guaranteed characters are not first.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

type Pending = {
  pendingId: string
  runId: string
  domain: string
  username: string
  secret: string
  createdAt: number
}

export type PendingSummary = Omit<Pending, 'secret'>

export class PendingCredentialLedger {
  private entries = new Map<string, Pending>()
  private runsWithPending = new Set<string>()
  constructor(private now: () => number = Date.now) {}

  // At most one generated credential per browser execution, so a failure always names one entry.
  begin(input: { runId: string; domain: string; username: string; secret?: string }): PendingSummary & { secret: string } {
    if (!input.runId || !input.domain || !input.username) throw new Error('pending_credential_invalid')
    if (this.runsWithPending.has(input.runId)) throw new Error('pending_credential_already_started')
    const secret = input.secret || generateCredentialSecret()
    const entry: Pending = {
      pendingId: `pend_${randomBytes(12).toString('base64url')}`,
      runId: input.runId,
      domain: input.domain.toLowerCase(),
      username: input.username,
      secret,
      createdAt: this.now(),
    }
    this.entries.set(entry.pendingId, entry)
    this.runsWithPending.add(input.runId)
    const { secret: _omit, ...summary } = entry
    return { ...summary, secret }
  }

  // Commit only after the site's own success state was verified by the caller.
  commit(pendingId: string, verification: { succeeded: boolean }): { username: string; domain: string; secret: string } {
    const entry = this.take(pendingId)
    if (!verification || verification.succeeded !== true) {
      // Verification failed: drop the secret. The sign-up did not succeed, so nothing is saved.
      throw new Error('pending_credential_not_verified')
    }
    return { username: entry.username, domain: entry.domain, secret: entry.secret }
  }

  discard(pendingId: string): boolean {
    return this.entries.delete(pendingId)
  }

  // Secret-free view for recovery and logs.
  list(runId?: string): PendingSummary[] {
    this.sweep()
    return [...this.entries.values()]
      .filter((e) => !runId || e.runId === runId)
      .map(({ secret: _s, ...rest }) => rest)
  }

  private take(pendingId: string): Pending {
    this.sweep()
    const entry = this.entries.get(pendingId)
    if (!entry) throw new Error('pending_credential_missing_or_expired')
    this.entries.delete(pendingId)
    return entry
  }

  // Entries past the commit window are dropped, and their secret with them.
  private sweep(): void {
    const cutoff = this.now() - COMMIT_WINDOW_MS
    for (const [id, entry] of this.entries) {
      if (entry.createdAt < cutoff) {
        this.entries.delete(id)
      }
    }
  }
}
