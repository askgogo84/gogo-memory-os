// Pure helpers for chat step narration; safe in client components (no database imports).
import type { GogoAgentState } from '@/lib/gogo/agent-states'

export type RunStep = { title: string; tool: string; status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | string }
export type RunSteps = { runId: string; status: string; title: string; steps: RunStep[]; done: boolean }

const ACTIVE = new Set(['running', 'queued', 'planning', 'pending'])
const GERUND: Record<string, string> = {
  research: 'Researching', check: 'Checking', read: 'Reading', search: 'Searching', compare: 'Comparing', create: 'Creating',
  find: 'Finding', open: 'Opening', review: 'Reviewing', prepare: 'Preparing', draft: 'Drafting', save: 'Saving', look: 'Looking',
  build: 'Building', collect: 'Collecting', gather: 'Gathering', summarise: 'Summarising', summarize: 'Summarizing', write: 'Writing',
  plan: 'Planning', confirm: 'Confirming', verify: 'Verifying', add: 'Adding', list: 'Listing', show: 'Showing', get: 'Getting',
  fetch: 'Fetching', watch: 'Watching', track: 'Tracking', book: 'Preparing to book', send: 'Preparing to send', ask: 'Asking',
}

/** "Read the latest posts" → "Reading the latest posts". Unknown verbs keep the title as it is. */
export function liveStepLine(title: string): string {
  const t = String(title || '').replace(/\s+/g, ' ').trim().slice(0, 140)
  if (!t) return 'Working on it'
  const m = t.match(/^([A-Za-z]+)\b(.*)$/)
  const verb = m ? GERUND[m[1].toLowerCase()] : undefined
  return verb ? `${verb}${m![2]}` : t
}

export function stateForStepTool(tool: string): GogoAgentState {
  const t = String(tool || '').toLowerCase()
  if (/browser|secure/.test(t)) return 'browsing'
  if (/web_search|search|research/.test(t)) return 'searching'
  if (/travel|flight/.test(t)) return 'flight'
  if (/compar/.test(t)) return 'comparing'
  if (/artifact|files|email|draft/.test(t)) return 'booking'
  return 'thinking'
}

export function shapeRunSteps(run: any, rows: any[]): RunSteps {
  const status = String(run?.status || '')
  const steps = (rows || []).map(r => ({ title: String(r?.title || r?.tool_name || 'Step').slice(0, 160), tool: String(r?.tool_name || ''), status: String(r?.status || 'pending') }))
  return { runId: String(run?.id || ''), status, title: String(run?.title || '').slice(0, 160), steps, done: !ACTIVE.has(status) }
}

