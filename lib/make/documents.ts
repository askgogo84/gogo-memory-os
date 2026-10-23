// Make: real slides and sheets (approved mock, 24 Oct). A deck or a sheet is saved as structured data in
// agent_artifacts (content_json.format = 'deck' | 'sheet'), shown in its own viewer and exported to PowerPoint,
// Excel or CSV. Numbers in sheets are computed in code; the model never does arithmetic. Unknown facts stay
// as visible placeholders like [YOUR USERS], never invented.

export type Slide = { kicker: string; title: string; points: string[]; notes: string }
export type Deck = { format: 'deck'; title: string; theme: 'light'; slides: Slide[] }
export type Sheet = { format: 'sheet'; title: string; columns: string[]; rows: Array<Array<string | number>>; totalColumn: number | null; notes: string; estimateRows: number[] }
export type MakeDoc = Deck | Sheet

export function makeFormatOf(text: string): 'deck' | 'sheet' | null {
  const t = String(text || '').toLowerCase()
  if (/\b(?:pitch\s+)?(?:deck|slides?|slide deck|presentation|powerpoint|ppt)\b/.test(t)) return 'deck'
  if (/\b(?:spreadsheet|sheet|excel|xlsx|budget|expense table|cost table|tracker table)\b/.test(t)) return 'sheet'
  return null
}

function clean(v: unknown, max = 300) {
  return String(v ?? '').replace(/\s+/g, ' ').replace(/\*\*/g, '').trim().slice(0, max)
}

/** First JSON object in a model reply (it may wrap it in ```json fences or a sentence). */
export function firstJson(text: string): any {
  const s = String(text || '')
  const start = s.indexOf('{')
  if (start < 0) return null
  let depth = 0, inStr = false, esc = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) { try { return JSON.parse(s.slice(start, i + 1)) } catch { return null } }
  }
  return null
}

export function validDeck(raw: any): Deck | null {
  const slides = (Array.isArray(raw?.slides) ? raw.slides : []).slice(0, 20).map((s: any): Slide => ({
    kicker: clean(s?.kicker, 40), title: clean(s?.title, 120),
    points: (Array.isArray(s?.points) ? s.points : []).map((p: any) => clean(p, 160)).filter(Boolean).slice(0, 6),
    notes: clean(s?.notes, 500),
  })).filter((s: Slide) => s.title)
  if (slides.length < 2) return null
  return { format: 'deck', title: clean(raw?.title, 120) || slides[0].title, theme: 'light', slides }
}

export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  const s = String(v ?? '').replace(/[₹,\s]|rs\.?|inr/gi, '')
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null
  return Number(s)
}

export function validSheet(raw: any): Sheet | null {
  const columns = (Array.isArray(raw?.columns) ? raw.columns : []).map((c: any) => clean(c, 40)).filter(Boolean).slice(0, 8)
  if (columns.length < 2) return null
  const rows = (Array.isArray(raw?.rows) ? raw.rows : []).slice(0, 200)
    .map((r: any) => (Array.isArray(r) ? r : []).slice(0, columns.length).map((cell: any) => typeof cell === 'number' ? cell : clean(cell, 120)))
    .filter((r: any[]) => r.some(c => String(c).trim()))
    .map((r: any[]) => [...r, ...Array(Math.max(0, columns.length - r.length)).fill('')])
  if (!rows.length) return null
  let totalColumn: number | null = Number.isInteger(raw?.totalColumn) ? raw.totalColumn : null
  // Default: the right-most column whose cells are all numbers is the amount column.
  if (totalColumn === null || totalColumn < 0 || totalColumn >= columns.length) {
    totalColumn = null
    for (let c = columns.length - 1; c >= 0; c--) if (rows.every((r: any[]) => parseAmount(r[c]) !== null || String(r[c]).trim() === '')) { totalColumn = c; break }
  }
  if (totalColumn !== null) for (const r of rows) { const n = parseAmount(r[totalColumn]); if (n !== null) r[totalColumn] = n }
  const estimateRows = (Array.isArray(raw?.estimateRows) ? raw.estimateRows : []).filter((i: any) => Number.isInteger(i) && i >= 0 && i < rows.length)
  return { format: 'sheet', title: clean(raw?.title, 120) || 'Sheet', columns, rows, totalColumn, notes: clean(raw?.notes, 400), estimateRows }
}

export function sheetTotal(sheet: Sheet): number | null {
  if (sheet.totalColumn === null) return null
  return sheet.rows.reduce((sum, r) => sum + (parseAmount(r[sheet.totalColumn!]) || 0), 0)
}

export const inr = (n: number) => `₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(n)}`

export function deckPrompt(request: string, facts: string) {
  return `Create a presentation as JSON for this request: ${JSON.stringify(request)}
Use these public facts where relevant (may be empty): ${facts ? JSON.stringify(facts.slice(0, 6000)) : '""'}
Rules: one idea per slide; 3-4 short bullet points per slide (max 12 words each); a short kicker label; speaker notes of 1-2 sentences.
Never invent numbers, customers, revenue, users or quotes: use placeholders like [YOUR USERS], [AMOUNT], [ADD PROOF POINT] instead.
Follow the requested slide count (default 6). Light, plain wording, no emoji, no markdown.
Return ONLY JSON: {"title":"…","slides":[{"kicker":"…","title":"…","points":["…"],"notes":"…"}]}`
}

export function sheetPrompt(request: string, facts: string) {
  return `Create a spreadsheet as JSON for this request: ${JSON.stringify(request)}
Use these public facts for prices where relevant (may be empty): ${facts ? JSON.stringify(facts.slice(0, 6000)) : '""'}
Rules: 3-5 columns, 5-20 rows, plain words; amounts as plain numbers without currency symbols or commas (Indian Rupees unless asked otherwise); quantity x unit price where useful; mark rows that are your planning estimates (not from the facts) by listing their 0-based row numbers in "estimateRows"; do NOT add a total row (it is computed separately); put the amount column last and give its index in "totalColumn".
Return ONLY JSON: {"title":"…","columns":["Item","Qty","Amount"],"rows":[["Flights",4,36000]],"totalColumn":2,"estimateRows":[1],"notes":"one line on assumptions"}`
}

export function editPrompt(doc: MakeDoc, instruction: string) {
  return `Here is a ${doc.format === 'deck' ? 'presentation' : 'spreadsheet'} as JSON:
${JSON.stringify(doc)}
Apply this change and nothing else: ${JSON.stringify(instruction)}
Keep the same JSON shape. Never invent numbers or facts; use placeholders like [AMOUNT] if needed. ${doc.format === 'sheet' ? 'Do not add a total row.' : ''}
Return ONLY the full updated JSON.`
}

export function chatReply(doc: MakeDoc, id: string) {
  const link = `https://app.askgogo.in/dashboard/reports/${id}`
  if (doc.format === 'deck') {
    const outline = doc.slides.slice(0, 8).map((s, i) => `${i + 1}. ${s.title}`).join('\n')
    return `📊 Your deck is ready: *${doc.title}* · ${doc.slides.length} slides\n\n${outline}\n\nOpen slides (PowerPoint download inside):\n${link}\n\nSay "make slide 3 shorter" or "add a slide on pricing" and I'll update it.`
  }
  const total = sheetTotal(doc)
  return `📊 Your sheet is ready: *${doc.title}* · ${doc.rows.length} rows${total !== null ? ` · total ${inr(total)}` : ''}\n${doc.estimateRows.length ? `Rows marked "est." are planning estimates.\n` : ''}\nOpen the sheet (Excel and CSV download inside):\n${link}\n\nSay "make the hotel ₹5,000 a night" or "add a row for snacks" and I'll update it.`
}

/** CSV with a computed total row. */
export function sheetCsv(sheet: Sheet) {
  const esc = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [sheet.columns.map(esc).join(','), ...sheet.rows.map((r, i) => r.map((c, j) => esc(j === 0 && sheet.estimateRows.includes(i) ? `${c} (est.)` : c)).join(','))]
  const total = sheetTotal(sheet)
  if (total !== null) lines.push(sheet.columns.map((_, j) => j === 0 ? 'Total' : j === sheet.totalColumn ? String(total) : '').map(esc).join(','))
  return lines.join('\n')
}

/** "Make a pitch deck for …", "Create a budget sheet for a Goa trip for 4". Explicit make verbs only. */
export function makeDocRequest(text: string): { format: 'deck' | 'sheet'; request: string } | null {
  const t = String(text || '').trim()
  if (!t || t.length > 500) return null
  // Asked in a connected app's format (Google Sheets, Drive, Notion): that flow handles it.
  if (/\b(?:google\s+(?:sheets?|slides|docs?|drive)|in (?:my )?drive|notion|gsheet)\b/i.test(t)) return null
  // Reminders, tasks, events and messages that merely mention a deck or budget are not Make requests.
  if (/\b(?:remind(?:er)?s?|tasks?|to-?dos?|events?|meetings?|calendar|e-?mails?|messages?|whatsapp|note that|alarm|call)\b/i.test(t)) return null
  const m = t.match(/^(?:hey\s+gogo[,!]?\s+)?(?:please\s+)?(?:can you\s+|could you\s+|pls\s+)?(?:make|create|build|prepare|draft|generate|put together|design)\s+(?:me\s+|us\s+)?(?:a|an|the|my|one)?\s*([\s\S]{0,80}?)\b(pitch\s+deck|deck|slides|slide deck|presentation|powerpoint|ppt|spreadsheet|excel sheet|sheet|excel|budget|expense tracker|cost breakdown)\b/i)
  if (!m) return null
  const format = makeFormatOf(m[2]) || (/budget|expense|cost/i.test(m[2]) ? 'sheet' : null)
  if (!format) return null
  return { format, request: t }
}

export const MAKE_REPLY_MARK = /^📊 (?:Your (?:deck|sheet) is ready|Updated)/
/** Report id from Gogo's last Make reply, so "make slide 3 shorter" edits that document. */
export function madeIdFromReply(reply: string): string | null {
  const s = String(reply || '')
  if (!MAKE_REPLY_MARK.test(s)) return null
  return s.match(/\/dashboard\/reports\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i)?.[1] || null
}

/** A follow-up change to the document just made ("make slide 3 shorter", "make the hotel ₹5,000 a night"). */
export function isMakeEdit(text: string) {
  const t = String(text || '').trim()
  if (!t || t.length > 240 || makeDocRequest(t)) return false
  // "add milk to my list" or "set a reminder" right after a deck is not an edit to it.
  if (/\b(?:remind(?:er)?s?|tasks?|to-?dos?|events?|meetings?|calendar|e-?mails?|messages?|whatsapp|alarm|call|my list|shopping|grocer(?:y|ies)|note)\b/i.test(t)) return false
  return /^(?:please\s+)?(?:can you\s+)?(?:make|change|set|add|remove|delete|drop|rename|shorten|replace|update|move|swap|increase|reduce|cut|put|use|merge|split|reword|rewrite|fix|turn|convert)\b/i.test(t)
}

export function editedReply(doc: MakeDoc, id: string) {
  return chatReply(doc, id).replace(/^📊 Your (?:deck|sheet) is ready:/, '📊 Updated:')
}
