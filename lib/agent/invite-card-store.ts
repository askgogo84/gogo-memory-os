// Read a shared occasion-invite card by its short id (app.askgogo.in/e/<id>). Edge-safe: plain fetch to the
// Supabase REST API, no Node APIs. Returns only what the friend-facing page may show: never the owner's number.
const ID_RE = /^[A-Za-z0-9]{10}$/
const MAX_AGE_MS = 60 * 86_400_000

export type SharedCard = {
  id: string
  spec: { kind: string; style: number; title: string; kicker: string; note: string; venue: string; when: string; party: string }
  invite: string | null
  map: string
}

const str = (v: unknown, n: number) => (typeof v === 'string' && v.trim() && v.length <= n ? v.trim() : null)

export async function getSharedCard(id: string): Promise<SharedCard | null> {
  if (!ID_RE.test(id)) return null
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/$/, '')
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (!base || !key) return null
  const url = `${base}/rest/v1/agent_activity?select=metadata_json,created_at&event_type=eq.occasion_invite_card&message=eq.${encodeURIComponent(`card ${id}`)}&limit=1`
  try {
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000), cache: 'no-store' })
    if (!res.ok) return null
    const row = (await res.json())?.[0]
    if (!row || Date.now() - (Date.parse(row.created_at) || 0) > MAX_AGE_MS) return null
    const m = row.metadata_json || {}, s = m.spec || {}
    const spec = {
      kind: ['birthday', 'anniversary', 'dinner'].includes(s.kind) ? s.kind : 'dinner',
      style: Number(s.style) % 2 === 1 ? 1 : 0,
      title: str(s.title, 80), kicker: str(s.kicker, 40), note: str(s.note, 80) || '', venue: str(s.venue, 80), when: str(s.when, 60), party: str(s.party, 30) || '',
    }
    if (m.id !== id || !spec.title || !spec.kicker || !spec.venue || !spec.when) return null
    const invite = typeof m.invite === 'string' && /^[a-z0-9]{1,12}-[a-z0-9]{6}$/.test(m.invite) ? m.invite : null
    return { id, spec: spec as SharedCard['spec'], invite, map: str(m.map, 80) || spec.venue! }
  } catch { return null }
}
