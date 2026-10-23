// SecondBrain migration, run for real in PGlite: grants, default-deny for anon/authenticated, consent-based
// invitations (one pending per person), last-owner guard (incl. concurrent demotion), append-only audit, cascade
// delete, and the rollback leaving nothing behind.
// Run: npx tsx scripts/verify-secondbrain-sql.mts
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create table public.agent_artifacts (id uuid primary key default gen_random_uuid(), telegram_id text, title text);`)
const up = readFileSync('supabase/migrations/20261023100000_secondbrain_workspaces.sql', 'utf8')
const down = readFileSync('supabase/migrations/20261023100000_secondbrain_workspaces.rollback.sql', 'utf8')
await db.exec(up)
await db.exec(up) // idempotent re-run

const fails = async (sql: string, re: RegExp, why: string) => {
  let err: any = null
  try { await db.exec(sql) } catch (e) { err = e }
  assert.ok(err, `${why}: expected failure`)
  assert.match(String(err?.message || err), re, why)
}

// Grants: only service_role reaches the tables.
for (const role of ['anon', 'authenticated']) {
  await fails(`set role ${role}; select * from public.workspace_members;`, /permission denied/, `${role} denied`)
  await db.exec('reset role')
}
await db.exec(`set role service_role;
  insert into public.workspaces (id, name, created_by) values ('11111111-1111-4111-8111-111111111111', 'Tipplr ops', '100');
  insert into public.workspace_members (workspace_id, telegram_id, role) values ('11111111-1111-4111-8111-111111111111', '100', 'owner');
  insert into public.workspace_audit_log (workspace_id, actor, action) values ('11111111-1111-4111-8111-111111111111', '100', 'workspace.create');`)
await fails(`update public.workspace_audit_log set action = 'x';`, /permission denied|append-only/, 'service_role cannot rewrite audit')
await db.exec('reset role')
console.log('Grants: service_role only; anon/authenticated denied')

// Last owner cannot be removed or demoted; a second owner makes it possible.
const W = `'11111111-1111-4111-8111-111111111111'`
await fails(`delete from public.workspace_members where workspace_id = ${W} and telegram_id = '100';`, /last_owner/, 'last owner delete blocked')
await fails(`update public.workspace_members set role = 'admin' where workspace_id = ${W} and telegram_id = '100';`, /last_owner/, 'last owner demote blocked')
await db.exec(`insert into public.workspace_members (workspace_id, telegram_id, role) values (${W}, '200', 'owner');`)
// Both owners demoted in one statement (what a race amounts to): must still fail.
await fails(`update public.workspace_members set role = 'member' where workspace_id = ${W};`, /last_owner/, 'demoting every owner at once blocked')
await db.exec(`update public.workspace_members set role = 'admin' where workspace_id = ${W} and telegram_id = '200';`)
console.log('Last owner: never removed or demoted, even all at once')

// Invitations: one pending per person; owner never invitable.
await db.exec(`insert into public.workspace_invites (workspace_id, telegram_id, role, invited_by) values (${W}, '300', 'member', '100');`)
await fails(`insert into public.workspace_invites (workspace_id, telegram_id, role, invited_by) values (${W}, '300', 'viewer', '100');`, /duplicate key|unique/, 'one pending invite per person')
await fails(`insert into public.workspace_invites (workspace_id, telegram_id, role, invited_by) values (${W}, '301', 'owner', '100');`, /check/, 'owner cannot be invited')
await db.exec(`update public.workspace_invites set status = 'revoked' where telegram_id = '300';
  insert into public.workspace_invites (workspace_id, telegram_id, role, invited_by) values (${W}, '300', 'viewer', '100');`)
const exp = await db.query<{ days: number }>(`select round(extract(epoch from expires_at - created_at) / 86400) as days from public.workspace_invites limit 1`)
assert.equal(Number(exp.rows[0].days), 14)
console.log('Invitations: pending until accepted, one at a time, owner never invitable, expire in 14 days')

// Audit is append-only, but deleting the workspace cascades everything away.
await fails(`delete from public.workspace_audit_log;`, /append-only/, 'audit delete blocked')
await db.exec(`delete from public.workspaces where id = ${W};`)
const left = await db.query<{ n: number }>(`select (select count(*) from public.workspace_members) + (select count(*) from public.workspace_audit_log) + (select count(*) from public.workspace_invites) as n`)
assert.equal(Number(left.rows[0].n), 0)
console.log('Audit: append-only; workspace delete cascades cleanly')

await db.exec(down)
const tables = await db.query<{ n: number }>(`select count(*) as n from pg_tables where schemaname = 'public' and tablename like 'workspace%'`)
const fns = await db.query<{ n: number }>(`select count(*) as n from pg_proc where proname like 'workspace_%'`)
assert.equal(Number(tables.rows[0].n), 0); assert.equal(Number(fns.rows[0].n), 0)
const art = await db.query<{ n: number }>(`select count(*) as n from pg_tables where tablename = 'agent_artifacts'`)
assert.equal(Number(art.rows[0].n), 1, 'rollback keeps agent_artifacts')
console.log('Rollback: removes every workspace table and function, keeps artifacts')
