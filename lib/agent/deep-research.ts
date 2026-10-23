// Research mode (24 Oct live): "Research the best electric scooters under 1.5 lakh in India with sources" ran one
// search, got kick scooters and extension boards, and gave up. A research ask now runs several focused searches,
// reads the best pages, and writes a short cited answer, the way a person researching would.
// Public web only: never used for personal data (mail, calendar, vault), and it never acts on anything.
import Anthropic from '@anthropic-ai/sdk'
import { searchWebResults, type WebSearchResult } from '@/lib/web-search'

const PERSONAL = /\b(?:my|our)\s+(?:e-?mails?|inbox|calendar|meetings?|vault|documents?|files?|drive|expenses?|bills?|account|reminders?|contacts?)\b/i

export function isDeepResearchRequest(text: string) {
  const t = String(text || '').trim()
  if (!t || t.length > 600 || PERSONAL.test(t)) return false
  if (/^(?:please\s+)?(?:do\s+(?:a\s+)?|run\s+(?:a\s+)?)?(?:deep\s+)?research\b/i.test(t)) return true
  if (/^(?:please\s+)?(?:investigate|find out (?:everything|all|in detail))\b/i.test(t)) return true
  return /\bwith (?:sources|citations|references|links)\b/i.test(t) && /\b(?:best|compare|comparison|top|which|options|vs\.?|versus|review|research|pros and cons)\b/i.test(t)
}

type Model = (prompt: string, maxTokens: number, model: string) => Promise<string>
// The cheapest configured provider first (public web research only), Claude as the backstop.
let currentQuestion = ''
const defaultModel: Model = async (prompt, maxTokens, model) => {
  const { cheapComplete } = await import('@/lib/inference/cheap')
  const cheap = await cheapComplete({ taskClass: 'public_web_research', prompt, scanText: currentQuestion, maxTokens }).catch(() => null)
  if (cheap) return cheap
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no_model')
  const client = new Anthropic({ apiKey: key })
  const res = await client.messages.create({ model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }, { timeout: 30_000 })
  return (res.content.find((b: any) => b.type === 'text') as any)?.text || ''
}

export function fallbackQueries(question: string) {
  const q = question.replace(/^(?:please\s+)?(?:do\s+(?:a\s+)?)?(?:deep\s+)?research\s+(?:on\s+|into\s+|about\s+)?/i, '').replace(/\bwith (?:sources|citations|references|links)\b/i, '').trim()
  const year = new Date().getFullYear()
  return [...new Set([q, `${q} ${year}`, `${q} review comparison`, `${q} price specifications`])].slice(0, 4)
}

export async function planQueries(question: string, model: Model = defaultModel) {
  try {
    const out = await model(`Write 4 different Google search queries that together answer this research request. Include the year ${new Date().getFullYear()} where recency matters, and India/₹ when the request is about India. One query per line, no numbering, no quotes.\n\nRequest: ${question}`, 200, 'claude-haiku-4-5')
    const qs = out.split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').replace(/^["']|["']$/g, '').trim()).filter(l => l.length >= 4 && l.length <= 160)
    if (qs.length >= 2) return [...new Set(qs)].slice(0, 4)
  } catch {}
  return fallbackQueries(question)
}

function pageText(html: string) {
  return String(html || '')
    .replace(/<(script|style|nav|footer|header|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|tr|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8377;|&#x20b9;/gi, '₹').replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
}

async function readPage(url: string, fetchImpl: typeof fetch) {
  try {
    const res = await fetchImpl(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; AskGogoResearch/1.0)', accept: 'text/html' }, signal: AbortSignal.timeout(6000), redirect: 'follow' })
    if (!res.ok || !/html|text/i.test(res.headers.get('content-type') || '')) return ''
    return pageText((await res.text()).slice(0, 400_000)).slice(0, 3500)
  } catch { return '' }
}

export type ResearchSource = { n: number; title: string; url: string; snippet: string; text: string }

export async function gatherSources(queries: string[], deps: { search?: typeof searchWebResults; fetchImpl?: typeof fetch; readPages?: number } = {}) {
  const search = deps.search || searchWebResults
  const settled = await Promise.allSettled(queries.map(q => search(q, { timeoutMs: 8000 })))
  const seen = new Set<string>()
  const merged: WebSearchResult[] = []
  // Round-robin across queries so one query's results don't crowd out the others.
  const lists = settled.map(s => s.status === 'fulfilled' ? s.value || [] : [])
  for (let i = 0; i < 8; i++) for (const list of lists) {
    const r: any = list[i]
    if (!r?.url) continue
    const key = String(r.url).replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key); merged.push(r)
  }
  const top = merged.slice(0, 10)
  const toRead = top.slice(0, deps.readPages ?? 4)
  const texts = await Promise.all(toRead.map(r => readPage(r.url, deps.fetchImpl || fetch)))
  return top.map((r: any, i): ResearchSource => ({ n: i + 1, title: String(r.title || r.url).slice(0, 140), url: String(r.url), snippet: String(r.content || r.snippet || '').slice(0, 500), text: texts[i] || '' }))
}

export async function runDeepResearch(question: string, deps: { model?: Model; search?: typeof searchWebResults; fetchImpl?: typeof fetch } = {}) {
  currentQuestion = question
  const model = deps.model || defaultModel
  const queries = await planQueries(question, model)
  const sources = await gatherSources(queries, deps)
  if (!sources.length) return { text: `I couldn't find reliable sources for that right now. I didn't guess. Try rephrasing, or ask me again in a minute.`, sources: [], queries }
  const corpus = sources.map(s => `[${s.n}] ${s.title}\n${s.url}\n${s.snippet}${s.text ? `\n${s.text}` : ''}`).join('\n\n---\n\n')
  const prompt = `You are a careful researcher. Answer the request using ONLY the sources below. Cite every factual claim with [n]. If sources disagree or a detail is missing, say so briefly. Prefer the most recent information. Be concise and practical for someone reading on a phone.

Format:
- One-line answer first.
- Then 3-6 short bullets (the options or findings, each with key numbers like price/range/specs where available, and citations).
- Then one line "My pick:" only if the sources support a clear recommendation.
No headings with #, no tables, no italics, under 1200 characters before sources. Do not list the sources yourself.

Request: ${question}

Sources:
${corpus.slice(0, 24_000)}`
  let body = ''
  try { body = (await model(prompt, 900, 'claude-sonnet-4-5')).trim() } catch {}
  if (!body) body = sources.slice(0, 5).map(s => `• ${s.title} [${s.n}]`).join('\n')
  // Some models write markdown bold (**x**); WhatsApp bold is *x*.
  body = body.replace(/\*\*([^*\n]+)\*\*/g, '*$1*').replace(/^#{1,6}\s+/gm, '')
  const cited = new Set([...body.matchAll(/\[(\d{1,2})\]/g)].map(m => Number(m[1])))
  const used = sources.filter(s => cited.has(s.n))
  const list = (used.length ? used : sources.slice(0, 5)).map(s => `[${s.n}] ${s.title}\n${s.url}`).join('\n')
  return { text: `🔎 ${body}\n\nSources:\n${list}`, sources, queries }
}
