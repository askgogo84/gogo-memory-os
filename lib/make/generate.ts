// Make: deck and sheet generation and edits. Non-personal requests go to the cheapest configured provider
// (make_draft_nonpersonal: the policy router never sends drafts to a provider that trains on inputs), Claude is the
// backstop. Public web snippets give the model real prices and facts; it never invents numbers.
import { deckPrompt, editPrompt, firstJson, scrubInventedNumbers, sheetPrompt, validDeck, validSheet, type MakeDoc } from './documents'

// The person's own data never leaves the primary model.
const PERSONAL = /\b(?:my|our)\s+(?:e-?mails?|inbox|calendar|meetings?|vault|documents?|files?|salary|income|bank|account|expenses?|bills?|card)\b/i

type Model = (prompt: string, scanText: string, opts?: { strong?: boolean }) => Promise<string>
export type { Model }
const defaultModel: Model = async (prompt, scanText, opts) => {
  // 24 Oct battery: the cheap model returned JSON in the wrong shape for an edit twice; the retry goes to Claude.
  if (!opts?.strong && !PERSONAL.test(scanText)) {
    const { cheapComplete } = await import('@/lib/inference/cheap')
    const cheap = await cheapComplete({ taskClass: 'make_draft_nonpersonal', prompt, scanText, maxTokens: 3500 }).catch(() => null)
    if (cheap && firstJson(cheap)) return cheap
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('no_model')
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: key })
  const res = await client.messages.create({ model: 'claude-haiku-4-5', max_tokens: 4000, temperature: 0.3, messages: [{ role: 'user', content: prompt }] }, { timeout: 45_000 })
  return (res.content.find((b: any) => b.type === 'text') as any)?.text || ''
}

/** A model that wraps the document ({"spreadsheet": {...}}) is unwrapped to the object that has slides or columns. */
function unwrap(raw: any): any {
  if (!raw || typeof raw !== 'object' || raw.slides || raw.columns) return raw
  const inner = Object.values(raw).find((v: any) => v && typeof v === 'object' && (Array.isArray(v.slides) || Array.isArray(v.columns)))
  return inner || raw
}

async function publicFacts(request: string, search?: (q: string) => Promise<any[]>) {
  if (PERSONAL.test(request)) return { facts: '', sources: [] as string[] }
  try {
    const run = search || (async (q: string) => (await import('@/lib/web-search')).searchWebResults(q, { timeoutMs: 6000 }))
    // Search the subject, not "pitch deck": "Make a 6 slide pitch deck for AskGogo, a …" → "AskGogo, a …".
    const q = request.replace(/^(?:please\s+)?(?:can you\s+|could you\s+)?(?:make|create|build|prepare|draft|generate|put together|design)\s+(?:me\s+)?(?:a|an|the|my)?\s*/i, '')
      .replace(/^[\s\S]{0,40}?\b(?:pitch\s+deck|slide deck|deck|slides|presentation|powerpoint|ppt|spreadsheet|sheet|excel)\s+(?:on|about|for|of|covering)\s+/i, '')
      .replace(/^\d+\s*(?:-\s*)?slides?\s+/i, '').slice(0, 160)
    const results = (await run(q)).slice(0, 5)
    return {
      facts: results.map((r: any, i: number) => `[${i + 1}] ${r.title}: ${r.snippet}`).join('\n'),
      sources: results.map((r: any) => String(r.url || '')).filter((u: string) => /^https:\/\//.test(u)),
    }
  } catch { return { facts: '', sources: [] as string[] } }
}

export async function generateDoc(format: 'deck' | 'sheet', request: string, deps: { model?: Model; search?: (q: string) => Promise<any[]> } = {}) {
  const model = deps.model || defaultModel
  const { facts, sources } = await publicFacts(request, deps.search)
  const prompt = format === 'deck' ? deckPrompt(request, facts) : sheetPrompt(request, facts)
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = unwrap(firstJson(await model(prompt, request, { strong: attempt > 0 }).catch(() => '')))
    const valid = format === 'deck' ? validDeck(raw) : validSheet(raw)
    const doc = valid && valid.format === 'deck' ? scrubInventedNumbers(valid, facts, request) : valid
    if (doc) return { doc, sources }
  }
  return null
}

export async function editDoc(doc: MakeDoc, instruction: string, deps: { model?: Model } = {}) {
  const model = deps.model || defaultModel
  for (let attempt = 0; attempt < 2; attempt++) {
    const raw = unwrap(firstJson(await model(editPrompt(doc, instruction), instruction, { strong: attempt > 0 }).catch(() => '')))
    const next = doc.format === 'deck' ? validDeck(raw) : validSheet(raw)
    // An edit may keep numbers already in the document or given in the instruction, never new ones.
    if (next) return next.format === 'deck' ? scrubInventedNumbers(next, JSON.stringify(doc), instruction) : next
  }
  return null
}

