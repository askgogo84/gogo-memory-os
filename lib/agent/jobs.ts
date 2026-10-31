// Job hunting (31 Oct, from Muse users: "scan for new jobs once per day and report the ones I'd be qualified for",
// "it remembers my preferences like salary range", "tracks the status of all jobs we applied for from my email",
// "has 3 resumes and applies the correct one, writes a custom cover letter"). Gogo prepares; the person submits.
import { supabaseAdmin } from '@/lib/supabase-admin'

const PREFS = 'JOB_PREFS:'
const clean = (v: unknown, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)

export type JobPrefs = { raw: string; roles: string[]; locations: string[]; minSalaryLpa: number | null; remote: boolean }

// ---------------------------------------------------------------- preferences
export function parseJobPrefsCommand(text: string): string | null {
  const t = clean(text, 600)
  const m = t.match(/^(?:please\s+)?(?:save\s+|remember\s+|set\s+|update\s+)?(?:my\s+)?job\s+(?:preferences?|prefs|criteria|search\s+criteria)\s*(?:are|is|:|-|=|to)?\s*(.{8,})$/i)
    || t.match(/^(?:remember\s+(?:that\s+)?)?i(?:'m| am)\s+looking\s+for\s+(?:a\s+|an\s+)?(.{6,}?\b(?:roles?|jobs?|positions?|openings?)\b.*)$/i)
  return m ? clean(m[1], 400).replace(/[.!]+$/, '') : null
}

export function jobPrefsFrom(raw: string): JobPrefs {
  const r = clean(raw, 400)
  const lpa = r.match(/(\d{1,3}(?:\.\d+)?)\s*(?:lpa|l\b|lakhs?(?:\s+per\s+(?:annum|year))?)/i)
  const cr = r.match(/(\d{1,2}(?:\.\d+)?)\s*(?:cr|crores?)\b/i)
  const minSalaryLpa = lpa ? Number(lpa[1]) : cr ? Number(cr[1]) * 100 : null
  const locations = Array.from(new Set((r.match(/\b(?:bengaluru|bangalore|mumbai|delhi|ncr|gurgaon|gurugram|noida|pune|hyderabad|chennai|dubai|uae|singapore|london|remote)\b/gi) || []).map(x => x.toLowerCase().replace('bangalore', 'bengaluru'))))
  const roles = r.split(/\s*(?:,|;|\bor\b|\/)\s*/i).map(x => x.replace(/\b(?:roles?|jobs?|positions?|in|at|based|above|over|salary|minimum|min|remote|hybrid|\d+(?:\.\d+)?\s*(?:lpa|l|lakhs?|cr|crores?)|bengaluru|bangalore|mumbai|delhi|pune|hyderabad|chennai|dubai|uae|singapore|london)\b/gi, ' ').replace(/\s+/g, ' ').trim())
    .filter(x => x.length >= 3 && /[a-z]/i.test(x)).slice(0, 4)
  return { raw: r, roles, locations, minSalaryLpa, remote: /\bremote\b/i.test(r) }
}

export async function saveJobPrefs(telegramId: number, raw: string) {
  const { error } = await supabaseAdmin.from('memories').insert({ telegram_id: telegramId, content: `${PREFS}${clean(raw, 400)}` })
  if (error) throw new Error(`job_prefs_save_failed:${error.message}`)
}
export async function savedJobPrefs(telegramId: number): Promise<JobPrefs | null> {
  const { data } = await supabaseAdmin.from('memories').select('content').eq('telegram_id', telegramId).like('content', `${PREFS}%`).order('id', { ascending: false }).limit(1)
  const raw = String(data?.[0]?.content || '').slice(PREFS.length).trim()
  return raw ? jobPrefsFrom(raw) : null
}
export function jobPrefsReply(p: JobPrefs) {
  const bits = [p.roles.length ? `roles: ${p.roles.join(', ')}` : '', p.locations.length ? `where: ${p.locations.join(', ')}` : '', p.minSalaryLpa ? `at least ₹${p.minSalaryLpa} LPA` : ''].filter(Boolean)
  return `💼 Saved your job preferences${bits.length ? ` (${bits.join(' · ')})` : ''}.\n\nSay *scan for jobs every day* and I'll check daily and send only new openings that match.`
}

// ---------------------------------------------------------------- daily radar
export function isJobRadarRequest(text: string) {
  const t = clean(text, 400)
  return /\b(?:find|scan|look|search|check|hunt)\b[^.?!]{0,30}\b(?:new\s+)?(?:jobs?|openings?|roles?|positions?)\b[^.?!]{0,60}\b(?:every\s*day|daily|each\s+day|every\s+morning|once\s+a\s+day)\b/i.test(t)
    || /^(?:start|set\s+up|turn\s+on)\s+(?:a\s+|my\s+)?job\s+(?:radar|alerts?|scan)\b/i.test(t)
    || /\b(?:send|tell|show)\s+me\s+new\s+(?:jobs?|openings?)\s+(?:daily|every\s*day|each\s+day)\b/i.test(t)
}
/** The search a daily job watch runs: the request's own role words, else the saved preferences. */
export function jobRadarQuery(text: string, prefs: JobPrefs | null) {
  const own = clean(text, 300).replace(/\b(?:please|can\s+you|find|scan|look|search|check|hunt|for|me|new|every\s*day|daily|each\s+day|every\s+morning|once\s+a\s+day|and|report|send|tell|show|the\s+ones?|i(?:'d| would)\s+be\s+qualified\s+for|start|set\s+up|turn\s+on|a|my|job\s+radar|job\s+alerts?)\b/gi, ' ').replace(/\b(?:jobs?|openings?|positions?)\b/gi, ' ').replace(/\s+/g, ' ').trim()
  const roles = own.length >= 4 ? own : prefs?.roles.join(' OR ') || ''
  const where = prefs?.locations.length ? prefs.locations.join(' OR ') : ''
  const pay = prefs?.minSalaryLpa ? `${prefs.minSalaryLpa}+ LPA` : ''
  return clean([roles, 'jobs', where, pay].filter(Boolean).join(' '), 200)
}

// ---------------------------------------------------------------- application tracker
export type AppStatus = 'applied' | 'viewed' | 'assessment' | 'interview' | 'rejected' | 'offer'
export type Application = { company: string; role: string; status: AppStatus; at: number }
const STATUS_RULES: [AppStatus, RegExp][] = [
  ['offer', /\b(?:offer\s+letter|pleased\s+to\s+offer|job\s+offer|extend(?:ing)?\s+an?\s+offer)\b/i],
  ['rejected', /\b(?:unfortunately|regret\s+to|not\s+(?:to\s+)?(?:move|moving|proceed|be\s+moving)\s+forward|decided\s+to\s+(?:pursue|move\s+forward\s+with)\s+other|position\s+has\s+been\s+filled|not\s+selected|will\s+not\s+be\s+progressing)\b/i],
  ['interview', /\b(?:interview|schedule\s+(?:a\s+)?(?:call|chat|time)|next\s+round|speak\s+with\s+you|meet\s+the\s+team)\b/i],
  ['assessment', /\b(?:assessment|assignment|coding\s+(?:test|challenge)|take-?home|hackerrank|codility|test\s+link)\b/i],
  ['viewed', /\b(?:viewed\s+your\s+application|application\s+was\s+viewed|recruiter\s+viewed)\b/i],
  ['applied', /\b(?:thank(?:s|\s+you)\s+for\s+(?:applying|your\s+(?:application|interest))|application\s+(?:received|submitted|has\s+been\s+received|was\s+sent)|we(?:'ve|\s+have)\s+received\s+your\s+application|you\s+applied|your\s+application\s+(?:for|to))\b/i],
]
const NOT_APPLICATION = /\b(?:loan|credit\s+card|mutual\s+fund|insurance|visa\s+application|passport|admission|scholarship|app\s+store|newsletter|webinar)\b/i

export function classifyApplicationEmail(e: { from: string; subject: string; snippet?: string; at?: number }): Application | null {
  const text = `${e.subject} ${e.snippet || ''}`
  if (NOT_APPLICATION.test(text)) return null
  const status = STATUS_RULES.find(([, re]) => re.test(text))?.[0]
  if (!status) return null
  if (status !== 'applied' && !/\b(?:application|applied|role|position|candidacy|interview|opening|job|search|opportunity|your\s+interest|profile)\b/i.test(text)) return null
  const fromName = clean(String(e.from || '').replace(/<[^>]+>/, '').replace(/"/g, ''), 60)
  const domain = (String(e.from || '').match(/@([a-z0-9.-]+)/i)?.[1] || '').toLowerCase()
  const viaBoard = /linkedin|naukri|indeed|instahyre|iimjobs|workday|greenhouse|lever|ashby|smartrecruiters|myworkday|hirist|wellfound|cutshort/.test(domain)
  const STOP = /^(?:You|Your|We|Our|The|This|Thanks?|Hi|Hello|Dear|Unfortunately|Regards)$/
  const companyRaw = text.match(/\b(?:at|with|from|to)\s+([A-Z][A-Za-z0-9&.\-]+(?:\s+[A-Z][A-Za-z0-9&.\-]+){0,3})(?=[\s,.!:]|$)/)?.[1]
  const words = companyRaw ? companyRaw.split(/\s+/) : []
  const cut = words.findIndex(w => STOP.test(w))
  const companyFromText = (cut < 0 ? words : words.slice(0, cut)).join(' ') || undefined
  const company = clean((viaBoard ? companyFromText : null) || fromName.replace(/\b(?:careers?|recruiting|talent(?:\s+acquisition)?|hiring\s+team|jobs|team|hr|no-?reply)\b/gi, '').trim() || companyFromText || domain.split('.')[0] || 'Unknown company', 50)
  const role = clean(text.match(/\b(?:for|as)\s+(?:the\s+|a\s+|an\s+)?([A-Z][\w/&+\-]*(?:\s+(?:of|and|for|&|-|[A-Z][\w/&+\-]*)){0,6}?)(?:\s+(?:role|position|at|with)\b|[,.!:]|$)/)?.[1] || '', 60)
  return { company, role, status, at: Number(e.at || 0) }
}

const RANK: Record<AppStatus, number> = { applied: 1, viewed: 2, assessment: 3, interview: 4, rejected: 5, offer: 6 }
/** One row per company + role; the newest email decides the status (a rejection after an interview is a rejection). */
export function mergeApplications(rows: Application[]) {
  const by = new Map<string, Application>()
  for (const r of rows.sort((a, b) => a.at - b.at)) {
    const key = `${r.company.toLowerCase()}|${r.role.toLowerCase() || '-'}`
    const prev = by.get(key)
    if (!prev || r.at >= prev.at || RANK[r.status] > RANK[prev.status]) by.set(key, r)
  }
  return [...by.values()].sort((a, b) => b.at - a.at)
}
const LABEL: Record<AppStatus, string> = { applied: '📨 Applied', viewed: '👀 Viewed', assessment: '📝 Assessment', interview: '🗓️ Interview', rejected: '✖️ Not moving forward', offer: '🎉 Offer' }
export function formatApplications(apps: Application[], now = Date.now()) {
  if (!apps.length) return "📂 I couldn't find job application emails in the last 60 days. When you apply, the confirmation email is enough: ask *show my job applications* again and I'll track it."
  const ago = (t: number) => { const d = Math.floor((now - t) / 86400_000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : `${d} days ago` }
  const active = apps.filter(a => a.status !== 'rejected').length
  return `📂 *Your job applications* (${apps.length}, ${active} still open)\n\n${apps.slice(0, 15).map((a, i) => `${i + 1}. ${a.company}${a.role ? ` — ${a.role}` : ''}\n   ${LABEL[a.status]} · ${ago(a.at)}`).join('\n')}\n\nRead from your Gmail. Say *remind me to follow up with <company> on Monday* to nudge one.`
}
export function isJobApplicationsQuery(text: string) {
  const t = clean(text, 200).toLowerCase().replace(/[?.!]+$/, '')
  return /^(?:show|list|track|check|what(?:'s| is)|where)\b[^.?]{0,25}\b(?:job\s+)?applications?\b/.test(t) && /\b(?:job|applications?|applied)\b/.test(t) && !/\b(?:visa|loan|passport|app\s+store)\b/.test(t)
    || /^(?:which|what)\s+jobs?\s+(?:have|did)\s+i\s+appl(?:y|ied)\s+(?:for|to)/.test(t)
    || /^status\s+of\s+my\s+(?:job\s+)?applications?/.test(t)
}

// ---------------------------------------------------------------- prepare an application
export function parsePrepareApplication(text: string): { job: string } | null {
  const t = clean(text, 600)
  const m = t.match(/^(?:please\s+)?(?:prepare|prep|get\s+ready)\s+(?:an?\s+|my\s+)?(?:job\s+)?application\s+(?:for|to)\s+(.{4,})$/i)
    || t.match(/^(?:please\s+)?(?:write|draft)\s+(?:a\s+|my\s+)?cover\s+letter\s+(?:for|to)\s+(.{4,})$/i)
    || t.match(/^(?:please\s+)?apply\s+(?:for|to)\s+(.{4,})$/i)
  return m ? { job: clean(m[1], 400) } : null
}
/** The person's resumes among saved documents, newest first. */
export async function savedResumes(telegramId: number) {
  const { data } = await supabaseAdmin.from('documents').select('id,title,doc_type,summary,created_at').eq('telegram_id', telegramId).order('created_at', { ascending: false }).limit(200)
  return (data || []).filter((d: any) => /\b(?:resume|résumé|cv|curriculum\s+vitae)\b/i.test(`${d.title} ${d.doc_type} ${String(d.summary || '').slice(0, 200)}`))
}
/** The resume whose title or summary shares the most words with the job. */
export function pickResume(resumes: { title: string; summary?: string | null }[], job: string) {
  const words = new Set(job.toLowerCase().match(/[a-z]{3,}/g) || [])
  let best: any = null, score = -1
  for (const r of resumes) {
    const hay = `${r.title} ${String(r.summary || '').slice(0, 600)}`.toLowerCase()
    const s = [...words].filter(w => hay.includes(w)).length
    if (s > score) { best = r; score = s }
  }
  return best
}

/** Any job command, for routing guards (the brain leaves these to the handler). */
export function isJobCommand(text: string) {
  return Boolean(parseJobPrefsCommand(text) || isJobRadarRequest(text) || isJobApplicationsQuery(text) || parsePrepareApplication(text))
}
