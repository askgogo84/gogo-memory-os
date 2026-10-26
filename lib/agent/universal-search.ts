// "Find everything about Toastr" (Perisclaw-style source-linked search, 27 Oct). One read-only question searches
// the person's own chat history, saved documents, notes, Gmail and Drive at once and lists hits by source with
// dates and links. Each source has its own short timeout; a source that is not connected or fails is named,
// never silently dropped. Nothing is written, sent or summarised by a model.
import type { AgentActor } from './actor'

export const UNIVERSAL_SEARCH_GATE = /\b(?:search\s+(?:everything|everywhere|all\s+(?:my\s+)?(?:stuff|things|sources|data))\s+(?:for|about)|(?:find|show)\s+(?:me\s+)?everything\s+(?:about|on|for|related\s+to)|everything\s+(?:i\s+have\s+)?(?:about|on)\s+\S)/i

export function parseUniversalSearch(text: string): string | null {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/[?.!]+$/, '')
  const m = t.match(/(?:search\s+(?:everything|everywhere|all\s+(?:my\s+)?(?:stuff|things|sources|data))\s+(?:for|about)|(?:find|show)\s+(?:me\s+)?everything\s+(?:about|on|for|related\s+to)|everything\s+(?:i\s+have\s+)?(?:about|on))\s+(.{2,80})$/i)
  if (!m) return null
  const term = m[1].replace(/^(?:the|my)\s+/i, '').replace(/\s+(?:please|pls)$/i, '').trim()
  return term.length >= 2 && /[a-z0-9]/i.test(term) ? term : null
}

export type SearchHit = { source: 'chat' | 'documents' | 'notes' | 'gmail' | 'drive'; title: string; when: string | null; link: string | null; snippet?: string }
export type SourceResult = { source: SearchHit['source']; hits: SearchHit[]; error?: 'not_connected' | 'failed' | 'timeout' }

const LABEL: Record<SearchHit['source'], string> = { chat: 'Chat with Gogo', documents: 'Saved documents', notes: 'Notes and memories', gmail: 'Gmail', drive: 'Google Drive' }
const ilikeSafe = (s: string) => s.replace(/[%_\\,()]/g, ' ').trim()
const short = (s: unknown, n = 140) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n)
/** The part of a long message around the search word, so the hit shows why it matched. Exported for tests. */
export function excerptAround(text: unknown, term: string, n = 110) {
  const t = String(text || '').replace(/\s+/g, ' ').trim().replace(/^["“]+|["”]+$/g, '')
  const i = t.toLowerCase().indexOf(String(term || '').toLowerCase())
  if (t.length <= n || i < 0) return t.slice(0, n)
  const start = Math.max(0, Math.min(i - 30, t.length - n))
  return `${start > 0 ? '…' : ''}${t.slice(start, start + n).trim()}${start + n < t.length ? '…' : ''}`
}
/** Drops repeated hits (the same message sent twice) and internal state rows stored as JSON. */
const unique = <T extends { title: string }>(hits: T[]) => { const seen = new Set<string>(); return hits.filter(h => { const k = h.title.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true }) }
const isStateRow = (s: unknown) => /^\s*[{[]/.test(String(s || ''))
const day = (v: unknown) => { const d = new Date(String(v || '')); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', timeZone: 'Asia/Kolkata' }) : null }

async function within<T>(ms: number, run: () => Promise<T>): Promise<T | 'timeout'> {
  return Promise.race([run(), new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), ms))])
}

export function formatUniversalSearch(term: string, results: SourceResult[]) {
  const found = results.filter(r => r.hits.length)
  const lines: string[] = [`*Everything about “${term}”*`]
  for (const r of found) {
    lines.push('', `*${LABEL[r.source]}*`)
    for (const h of r.hits.slice(0, 3)) lines.push(`• ${h.title}${h.when ? ` · ${h.when}` : ''}${h.snippet ? `\n  ${h.snippet}` : ''}${h.link ? `\n  ${h.link}` : ''}`)
    if (r.hits.length > 3) lines.push(`  +${r.hits.length - 3} more`)
  }
  const missing = results.filter(r => r.error).map(r => `${LABEL[r.source]} (${r.error === 'not_connected' ? 'not connected' : r.error === 'timeout' ? 'too slow just now' : 'couldn’t be searched'})`)
  const empty = results.filter(r => !r.error && !r.hits.length).map(r => LABEL[r.source])
  if (!found.length) lines.push('', `Nothing found for “${term}”.`)
  if (empty.length && found.length) lines.push('', `No matches in: ${empty.join(', ')}.`)
  if (missing.length) lines.push('', `Not searched: ${missing.join('; ')}.`)
  return lines.join('\n')
}

export async function runUniversalSearch(actor: AgentActor, term: string, deps: { db?: any; gmail?: (q: string) => Promise<any[]>; drive?: (q: string) => Promise<any[]> } = {}): Promise<SourceResult[]> {
  const db = deps.db || (await import('@/lib/supabase-admin')).supabaseAdmin
  const tg = Number(actor.legacyTelegramId)
  const like = `%${ilikeSafe(term)}%`
  const since = new Date(Date.now() - 180 * 86400_000).toISOString()
  const wrap = async (source: SearchHit['source'], run: () => Promise<SearchHit[]>): Promise<SourceResult> => {
    try {
      const out = await within(6000, run)
      return out === 'timeout' ? { source, hits: [], error: 'timeout' } : { source, hits: out }
    } catch (err: any) {
      return { source, hits: [], error: /not_connected|reconnect|scope|no_token|workspace_not/i.test(String(err?.message || '')) ? 'not_connected' : 'failed' }
    }
  }
  const gmail = deps.gmail || (async (q: string) => { const { searchWorkspaceEmailsByQuery } = await import('./google-workspace-read'); return searchWorkspaceEmailsByQuery(actor, q, 5) })
  const drive = deps.drive || (async (q: string) => { const { searchWorkspaceDrive } = await import('./google-workspace-read'); return (await searchWorkspaceDrive(actor, q)).files })
  return Promise.all([
    wrap('chat', async () => {
      const { data, error } = await db.from('conversations').select('role,content,created_at').eq('telegram_id', tg).eq('role', 'user').gte('created_at', since).ilike('content', like).order('created_at', { ascending: false }).limit(10)
      if (error) throw new Error('chat_failed')
      return unique((data || []).map((r: any) => ({ source: 'chat' as const, title: `You said: “${excerptAround(r.content, term)}”`, when: day(r.created_at), link: 'https://app.askgogo.in/dashboard/chat' }))).slice(0, 5)
    }),
    wrap('documents', async () => {
      const { data, error } = await db.from('documents').select('id,title,doc_type,created_at').eq('telegram_id', tg).or(`title.ilike.${like},summary.ilike.${like}`).order('created_at', { ascending: false }).limit(5)
      if (error) throw new Error('documents_failed')
      return (data || []).map((r: any) => ({ source: 'documents' as const, title: short(r.title || r.doc_type || 'Document', 110), when: day(r.created_at), link: 'https://app.askgogo.in/dashboard/library' }))
    }),
    wrap('notes', async () => {
      const { data, error } = await db.from('memories').select('content,created_at').eq('telegram_id', tg).ilike('content', like).order('created_at', { ascending: false }).limit(15)
      if (error) throw new Error('notes_failed')
      return unique((data || []).filter((r: any) => !isStateRow(r.content)).map((r: any) => ({ source: 'notes' as const, title: excerptAround(r.content, term, 130), when: day(r.created_at), link: 'https://app.askgogo.in/dashboard/memory' }))).slice(0, 5)
    }),
    wrap('gmail', async () => (await gmail(`"${term.replace(/"/g, '')}" newer_than:180d`)).map((m: any) => ({
      source: 'gmail' as const, title: `${short(m.subject, 90)} — ${short(String(m.from || '').replace(/<[^>]+>/, '').replace(/"/g, ''), 40)}`, when: day(m.date),
      link: /^[0-9a-f]{10,24}$/i.test(String(m.threadId || '')) ? `https://mail.google.com/mail/u/0/#all/${m.threadId}` : null, snippet: short(m.snippet, 120) }))),
    // 27 Oct live: Drive's full-text match returned 2018 zip files that contain the "toastr" JS library. Only files whose
    // name carries every search word count here.
    wrap('drive', async () => (await drive(term)).filter((f: any) => { const name = String(f?.name || '').toLowerCase(); return (term.toLowerCase().match(/[a-z0-9]+/g) || [] as string[]).every((w: string) => name.includes(w)) }).map((f: any) => ({ source: 'drive' as const, title: short(f.name, 110), when: day(f.modifiedTime),
      link: /^https:\/\/(?:docs|drive)\.google\.com\//.test(String(f.webViewLink || '')) ? String(f.webViewLink) : null }))),
  ])
}

export async function handleUniversalSearch(params: { actor: AgentActor; text: string }) {
  const term = parseUniversalSearch(params.text)
  if (!term) return null
  const results = await runUniversalSearch(params.actor, term)
  return { runId: 'universal-search', status: 'completed' as const, capability: 'orchestrator' as const, risk: 'low' as const, handledBy: 'universal-search', text: formatUniversalSearch(term, results) }
}
