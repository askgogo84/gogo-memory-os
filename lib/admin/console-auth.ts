// Admin console access: (1) a dashboard session on an admin number, (2) the admin password.
// Spec: docs/admin-console/README.md §Security.
import { createHmac, randomBytes, scryptSync, timingSafeEqual, createHash } from 'node:crypto'
import { cookies, headers } from 'next/headers'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { getSession } from '@/lib/dashboard/session'
import { isAdminPhone } from '@/lib/bot/handlers/admin-analytics'

export const ADMIN_COOKIE = 'askgogo_admin'
export const ADMIN_SESSION_MS = 12 * 60 * 60 * 1000
export const LOCK_AFTER = 5
export const LOCK_WINDOW_MS = 15 * 60 * 1000

export type AdminRole = 'owner' | 'operator' | 'viewer'
const RANK: Record<AdminRole, number> = { viewer: 1, operator: 2, owner: 3 }
export type AdminIdentity = { phone: string; name: string; role: AdminRole; telegramId: string }

export function e164(phone: string) {
  const raw = String(phone || '').replace(/^whatsapp:/, '').trim()
  const d = raw.replace(/\D/g, '')
  return d ? (raw.startsWith('+') ? `+${d}` : d.length === 10 ? `+91${d}` : `+${d}`) : ''
}
export const canDo = (role: AdminRole, min: AdminRole) => RANK[role] >= RANK[min]

/** Step 1: who is this (dashboard session on an admin number or an active admin member)? */
export async function adminIdentity(): Promise<AdminIdentity | null> {
  const session = await getSession()
  if (!session) return null
  const { data: user } = await supabaseAdmin.from('users').select('whatsapp_id, name').eq('telegram_id', Number(session.telegramId)).maybeSingle()
  const phone = e164((user as any)?.whatsapp_id || '')
  if (!phone) return null
  if (isAdminPhone(phone)) return { phone, name: (user as any)?.name || 'Owner', role: 'owner', telegramId: session.telegramId }
  const { data: member } = await supabaseAdmin.from('admin_members').select('name, role, active').eq('phone_e164', phone).maybeSingle()
  if (member && (member as any).active) return { phone, name: (member as any).name, role: (member as any).role, telegramId: session.telegramId }
  return null
}

// ── Password ────────────────────────────────────────────────────────────────
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}
export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, salt, hash] = String(stored || '').split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const got = scryptSync(String(password || ''), salt, 32)
  const want = Buffer.from(hash, 'hex')
  return want.length === got.length && timingSafeEqual(got, want)
}
export async function storedPasswordHash(): Promise<string | null> {
  const env = (process.env.ADMIN_CONSOLE_PASSWORD_HASH || '').trim()
  if (env) return env
  const { data } = await supabaseAdmin.from('admin_settings').select('value').eq('key', 'password_hash').maybeSingle()
  return (data as any)?.value || null
}
export async function setPasswordHash(hash: string, by: string) {
  const { error } = await supabaseAdmin.from('admin_settings').upsert({ key: 'password_hash', value: hash, updated_by: by, updated_at: new Date().toISOString() })
  if (error) throw new Error('could_not_save_password')
}

// ── Signed console cookie (bound to the phone and the current password hash) ──
function cookieKey(passwordHash: string) {
  return createHash('sha256').update(`askgogo-admin:${passwordHash}:${process.env.DASHBOARD_THROTTLE_PEPPER || process.env.CRON_SECRET || ''}`).digest()
}
export function signConsoleCookie(phone: string, passwordHash: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ p: phone, e: now + ADMIN_SESSION_MS })).toString('base64url')
  const sig = createHmac('sha256', cookieKey(passwordHash)).update(payload).digest('base64url')
  return `${payload}.${sig}`
}
export function readConsoleCookie(value: string | undefined, phone: string, passwordHash: string, now = Date.now()): boolean {
  if (!value || !passwordHash) return false
  if (value.length > 4096 || value.split('.').length !== 2) return false
  const [payload, sig] = value.split('.')
  if (!/^[A-Za-z0-9_-]+$/.test(payload) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false
  const want = createHmac('sha256', cookieKey(passwordHash)).update(payload).digest()
  const got = Buffer.from(sig, 'base64url')
  // Node's decoder accepts noncanonical padding bits; require the signed wire representation too.
  if (got.toString('base64url') !== sig || got.length !== want.length || !timingSafeEqual(got, want)) return false
  try { const d = JSON.parse(Buffer.from(payload, 'base64url').toString()); return d.p === phone && typeof d.e === 'number' && Number.isFinite(d.e) && d.e > now } catch { return false }
}

// One flat shape (this repo compiles with strict:false, where discriminated-union narrowing does not work).
export type ConsoleGate = { ok: boolean; admin?: AdminIdentity; step?: 'signin' | 'not_admin' | 'set_password' | 'password' | 'forbidden' }

/** Full gate for console pages and console APIs. */
export async function requireAdminConsole(min: AdminRole = 'viewer'): Promise<ConsoleGate> {
  const admin = await adminIdentity()
  if (!admin) { const s = await getSession(); return { ok: false, step: s ? 'not_admin' : 'signin' } }
  const hash = await storedPasswordHash()
  if (!hash) return { ok: false, step: 'set_password' }
  const jar = await cookies()
  if (!readConsoleCookie(jar.get(ADMIN_COOKIE)?.value, admin.phone, hash)) return { ok: false, step: 'password' }
  if (!canDo(admin.role, min)) return { ok: false, step: 'forbidden' }
  return { ok: true, admin }
}

// ── Lockout + audit ─────────────────────────────────────────────────────────
export async function recentFailures(phone: string): Promise<number> {
  const since = new Date(Date.now() - LOCK_WINDOW_MS).toISOString()
  const { data } = await supabaseAdmin.from('admin_login_attempts').select('ok, created_at').eq('actor_phone', phone).gte('created_at', since).order('created_at', { ascending: false }).limit(20)
  let n = 0
  for (const row of (data || []) as any[]) { if (row.ok) break; n++ }
  return n
}
export async function recordAttempt(phone: string, ok: boolean) {
  await supabaseAdmin.from('admin_login_attempts').insert({ actor_phone: phone, ok, ip_hash: await ipHash() })
}
async function ipHash(): Promise<string | null> {
  try {
    const h = await headers()
    const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim()
    const pepper = process.env.DASHBOARD_THROTTLE_PEPPER
    return ip && pepper ? createHmac('sha256', pepper).update(ip).digest('hex').slice(0, 24) : null
  } catch { return null }
}
export async function audit(admin: { phone: string; name: string } | null, action: string, target?: string | null, detail: Record<string, unknown> = {}) {
  try {
    const h = await headers().catch(() => null)
    await supabaseAdmin.from('admin_audit_log').insert({
      actor_phone: admin?.phone || null, actor_name: admin?.name || null, action, target: target || null, detail,
      ip_hash: await ipHash(), user_agent: (h?.get('user-agent') || '').slice(0, 160) || null,
    })
  } catch (err: any) { console.error('ADMIN_AUDIT_FAILED', err?.message || err) }
}
