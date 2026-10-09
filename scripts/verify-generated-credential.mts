// Two-phase generated sign-up credentials: a password is saved only after the site's own success
// state is verified. Pure logic test; no browser and no database.
import assert from 'node:assert/strict'
import { PendingCredentialLedger, generateCredentialSecret, COMMIT_WINDOW_MS } from '../lib/vault/generated-credential.ts'

// Generator: length, class coverage, uniqueness, no ambiguous characters.
for (let i = 0; i < 200; i++) {
  const s = generateCredentialSecret(24)
  assert.equal(s.length, 24)
  assert.match(s, /[a-z]/)
  assert.match(s, /[A-Z]/)
  assert.match(s, /[2-9]/)
  assert.match(s, /[!@#$%^&*\-_=+]/)
  assert.doesNotMatch(s, /[0OoIl1]/, 'ambiguous characters are excluded')
}
assert.equal(generateCredentialSecret(4).length, 16, 'short requests are raised to the minimum')
assert.equal(generateCredentialSecret(500).length, 64, 'long requests are capped')
assert.notEqual(generateCredentialSecret(), generateCredentialSecret(), 'secrets differ')

// Two-phase: verified success commits the secret once.
{
  let t = 1_000
  const ledger = new PendingCredentialLedger(() => t)
  const p = ledger.begin({ runId: 'run-1', domain: 'Huggingface.co', username: 'ada@example.com' })
  assert.match(p.pendingId, /^pend_/)
  assert.equal(p.domain, 'huggingface.co')
  assert.ok(!JSON.stringify(ledger.list()).includes(p.secret), 'the list view never contains the secret')
  const committed = ledger.commit(p.pendingId, { succeeded: true })
  assert.equal(committed.secret, p.secret)
  assert.throws(() => ledger.commit(p.pendingId, { succeeded: true }), /missing_or_expired/, 'a committed entry cannot be committed again')
}

// Unverified success is never saved, and the entry is gone afterwards.
{
  const ledger = new PendingCredentialLedger(() => 1)
  const p = ledger.begin({ runId: 'run-2', domain: 'example.com', username: 'x@example.com' })
  assert.throws(() => ledger.commit(p.pendingId, { succeeded: false }), /not_verified/)
  assert.equal(ledger.list().length, 0, 'an unverified entry is dropped')
}

// Discard removes the entry without saving.
{
  const ledger = new PendingCredentialLedger(() => 1)
  const p = ledger.begin({ runId: 'run-3', domain: 'example.com', username: 'x@example.com' })
  assert.equal(ledger.discard(p.pendingId), true)
  assert.equal(ledger.discard(p.pendingId), false)
}

// One generated credential per browser execution.
{
  const ledger = new PendingCredentialLedger(() => 1)
  ledger.begin({ runId: 'run-4', domain: 'example.com', username: 'a@example.com' })
  assert.throws(() => ledger.begin({ runId: 'run-4', domain: 'example.com', username: 'b@example.com' }), /already_started/)
}

// Entries past the commit window expire, and their secret is dropped with them.
{
  let t = 0
  const ledger = new PendingCredentialLedger(() => t)
  const p = ledger.begin({ runId: 'run-5', domain: 'example.com', username: 'a@example.com' })
  t = COMMIT_WINDOW_MS + 1
  assert.throws(() => ledger.commit(p.pendingId, { succeeded: true }), /missing_or_expired/)
}

// Invalid input is refused before anything is generated.
{
  const ledger = new PendingCredentialLedger(() => 1)
  assert.throws(() => ledger.begin({ runId: '', domain: 'example.com', username: 'a@example.com' }), /invalid/)
}

console.log('Generated sign-up credentials: generator, two-phase commit, discard, one-per-run and expiry checks passed')
