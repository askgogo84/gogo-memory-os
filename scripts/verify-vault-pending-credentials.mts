// Pending sign-up credentials: the table, its constraints and the store's rules are checked
// structurally. The migration itself was applied to a scratch Postgres 16 database with the
// constraint cases (one pending row per run, valid status, no ciphertext on committed rows).
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

const sql = readFileSync('supabase/migrations/20261010011000_vault_pending_credentials_v1.sql', 'utf8')
assert.match(sql, /create table if not exists public\.vault_pending_credentials/, 'the table is created idempotently')
assert.match(sql, /check \(status in \('pending','committed','discarded','expired'\)\)/, 'status is restricted')
assert.match(sql, /constraint vault_pending_payload_only_while_pending[\s\S]*status = 'pending' or payload_ciphertext = ''/, 'ciphertext exists only while pending')
assert.match(sql, /create unique index if not exists vault_pending_one_per_run[\s\S]*where status = 'pending' and run_id is not null/, 'one pending row per run')
assert.match(sql, /enable row level security/, 'RLS is enabled')
assert.match(sql, /revoke all on public\.vault_pending_credentials from anon, authenticated/, 'anon and authenticated have no access')
assert.ok(readdirSync('supabase/migrations').includes('20261010011000_vault_pending_credentials_v1.rollback.sql'), 'a rollback sits beside the migration')

const store = readFileSync('lib/vault/pending-credentials.ts', 'utf8')
assert.match(store, /readPendingSignupForCommit[\s\S]*\.eq\('status', 'pending'\)[\s\S]*\.gt\('expires_at'/, 'commit reads only live pending rows')
assert.match(store, /markPendingSignupCommitted[\s\S]*payload_ciphertext: ''[\s\S]*\.eq\('status', 'pending'\)/, 'commit wipes the ciphertext and only from pending')
assert.match(store, /discardPendingSignupCredential[\s\S]*payload_ciphertext: ''/, 'discard wipes the ciphertext')
assert.match(store, /'23505'[\s\S]*pending_credential_already_started/, 'a second pending row for a run is refused')
const listFn = store.slice(store.indexOf('export async function listPendingSignupCredentials'), store.indexOf('export async function expireStale'))
assert.doesNotMatch(listFn, /payload_ciphertext/, 'the recovery list never reads the secret payload')
assert.doesNotMatch(store.slice(0, store.indexOf('export async function readPendingSignupForCommit')), /decryptVaultValue\(/, 'only the host-only commit read decrypts')

console.log('Pending sign-up credentials: table constraints, RLS, commit/discard wipe and secret-free recovery checks passed (structural)')
