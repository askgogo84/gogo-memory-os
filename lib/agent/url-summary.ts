// "Summarise https://…" (24 Oct live): went to the secure browser, took 96 s and failed on Wikipedia.
// A public page summary is a read: fetch it on the server, extract the text, summarise with sources.
// Sign-in pages, private hosts and non-HTML files fall back to the normal path.
import Anthropic from '@anthropic-ai/sdk'

const URL_RE = /https?:\/\/[^\s<>"')]+/i

export function urlSummaryRequest(text: string): { url: string; ask: string } | null {
  const t = String(text || '').trim()
  if (t.length > 600) return null
  const url = t.match(URL_RE)?.[0]?.replace(/[.,;!?]+$/, '')
  if (!url) return null
  const rest = t.replace(URL_RE, ' ').replace(/\s+/g, ' ').trim()
  const asks = /^(?:please\s+)?(?:summar(?:ise|ize|y of)|tl;?dr|give me (?:a |the )?(?:summary|gist|key points)|what(?:'s| is| does)(?: this| the)? (?:page|article|link|post)?\s*(?:about|say)|key (?:points|takeaways) (?:from|of)|read)\b/i
  // A bare link is saved to the link vault elsewhere; only an explicit summary ask is handled here.
  if (!rest || !asks.test(rest)) return null
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { return null }
  // Private/local addresses and the person's own app links are never fetched.
  if (/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)|\.local$|\.internal$/.test(host) || /(?:^|\.)askgogo\.in$/.test(host)) return null
  if (/(?:mail\.google|docs\.google|drive\.google|calendar\.google|accounts\.)/.test(host)) return null
  return { url, ask: rest }
}

function readable(html: string) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s+/g, ' ').trim() || ''
  const body = (html.match(/<(article|main)[\s\S]*?<\/\1>/i)?.[0] || html)
    .replace(/<(script|style|nav|footer|header|aside|noscript|svg|form|table)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6])>/gi, '\n').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#8377;|&#x20b9;/gi, '₹').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim()
  return { title: title.replace(/&amp;/g, '&').slice(0, 160), text: body }
}

type Model = (prompt: string) => Promise<string>
const defaultModel: Model = async prompt => {
  // Cheapest configured provider first (public page, non-personal ask), Claude as the backstop.
  const { cheapComplete } = await import('@/lib/inference/cheap')
  const ask = prompt.split('.')[0] || 'Summarise'
  const cheap = await cheapComplete({ taskClass: 'public_web_research', prompt, scanText: ask, maxTokens: 700 }).catch(() => null)
  if (cheap) return cheap
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no_model')
  const client = new Anthropic({ apiKey: key })
  const res = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 700, temperature: 0.2, messages: [{ role: 'user', content: prompt }] }, { timeout: 20_000 })
  return (res.content.find((b: any) => b.type === 'text') as any)?.text || ''
}

export async function summariseUrl(req: { url: string; ask: string }, deps: { fetchImpl?: typeof fetch; model?: Model } = {}) {
  const fetchImpl = deps.fetchImpl || fetch
  let res: Response
  try {
    res = await fetchImpl(req.url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; AskGogo/1.0)', accept: 'text/html,application/xhtml+xml' }, redirect: 'follow', signal: AbortSignal.timeout(8000) })
  } catch { return null }
  try { const finalHost = new URL(res.url || req.url).hostname.toLowerCase(); if (/^(?:localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)|\.local$|\.internal$/.test(finalHost)) return null } catch { return null }
  if (!res.ok || !/html|text\/plain/i.test(res.headers.get('content-type') || '')) return null
  const { title, text } = readable((await res.text()).slice(0, 1_500_000))
  // A sign-in wall or an empty shell page is not something to summarise from the server.
  if (text.length < 400 || /\b(?:sign in|log in) to (?:continue|view)\b/i.test(text.slice(0, 1500))) return null
  const prompt = `${req.ask}. Use only the page text below. Reply for a phone: one line on what the page is, then 4-6 short bullets with the key facts (numbers, dates, names), then one line "Worth knowing:" if something stands out. Plain text, bullets with •, no headings, no italics, under 900 characters.\n\nTitle: ${title}\nURL: ${req.url}\n\nPage text:\n${text.slice(0, 12_000)}`
  let body = ''
  try { body = (await (deps.model || defaultModel)(prompt)).trim() } catch {}
  if (!body) return null
  return `📄 ${title || 'Page summary'}\n\n${body}\n\nSource: ${req.url}`
}
