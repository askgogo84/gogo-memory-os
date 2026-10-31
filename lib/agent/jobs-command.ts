// Job commands: preferences, the daily radar, the application tracker, and preparing one application.
// Gogo never submits an application: it prepares the resume choice and cover letter, and the person applies.
import type { AgentActor } from './actor'
import type { AgentSurface } from './orchestrator'
import { isJobApplicationsQuery, isJobRadarRequest, jobPrefsFrom, jobPrefsReply, jobRadarQuery, parseJobPrefsCommand, parsePrepareApplication, pickResume, saveJobPrefs, savedJobPrefs, savedResumes } from './jobs'

const clean = (v: unknown, max = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const done = (text: string, handledBy: string) => ({ runId: handledBy, status: 'completed' as const, capability: 'memory' as const, risk: 'low' as const, text, handledBy })

export async function tryJobCommand(params: { actor: AgentActor; surface: AgentSurface; text: string }) {
  const tg = params.actor.legacyTelegramId
  const prefsText = parseJobPrefsCommand(params.text)
  if (prefsText) {
    await saveJobPrefs(tg, prefsText)
    return done(jobPrefsReply(jobPrefsFrom(prefsText)), 'job-prefs')
  }
  if (isJobRadarRequest(params.text)) {
    const prefs = await savedJobPrefs(tg).catch(() => null)
    const query = jobRadarQuery(params.text, prefs)
    if (!/\w{3,}\s+jobs/i.test(query)) return done("💼 Which roles should I look for? Tell me once, like *my job preferences: Head of AI or VP Engineering in Bengaluru or remote, above 80 LPA*, then say *scan for jobs every day*.", 'job-radar')
    const wc: any = await import('./watch-command')
    const created = await wc.tryCreateWebWatchFromCommand({ actor: params.actor, surface: params.surface, text: `Find me ${query} and keep looking every day` })
    if (!created) return done("I couldn't set up the daily job search just now. Nothing was created; try again in a minute.", 'job-radar')
    if (created.status !== 'completed') return { ...created, handledBy: 'job-radar' }
    return done(`💼 *Job radar on.* Every day I'll search for: ${query}.\n\nI'll message you only when new openings appear, with the link. When one looks right, say *prepare application for <role at company or link>* and I'll pick your resume and draft the cover letter. I never apply for you.\n\nSay *show my job applications* any time to see where each one stands.`, 'job-radar')
  }
  if (isJobApplicationsQuery(params.text)) {
    const gr: any = await import('@/lib/bot/handlers/gmail-read')
    const reply = await Promise.race([
      Promise.resolve().then(() => gr.jobApplicationsReply(tg)).catch((err: any) => { console.error('JOB_APPLICATIONS_FAILED:', clean(err?.message || err, 160)); return undefined }),
      new Promise(resolve => setTimeout(() => resolve(undefined), 20_000)),
    ])
    if (reply === null) return done('📂 I track applications from your Gmail, and Gmail is not connected. Say *connect gmail* and I will read only the application emails.', 'job-applications')
    if (typeof reply !== 'string') return done("📂 I couldn't read your application emails just now. Nothing changed; ask me again in a minute.", 'job-applications')
    return done(reply, 'job-applications')
  }
  const prep = parsePrepareApplication(params.text)
  if (prep) {
    const [resumes, prefs] = await Promise.all([savedResumes(tg).catch(() => []), savedJobPrefs(tg).catch(() => null)])
    const resume: any = resumes.length ? pickResume(resumes as any, prep.job) : null
    const { askClaude } = await import('@/lib/services/claude')
    const evidence = [resume ? `Resume on file: ${resume.title}\n${clean(resume.summary, 1500)}` : 'No resume saved.', prefs ? `Job preferences: ${prefs.raw}` : ''].filter(Boolean).join('\n\n')
    const letter = clean(await askClaude(`Write a cover letter of 150 to 200 words for this job: ${prep.job}. Use only facts from the resume notes in the context; never invent employers, numbers or achievements; where a specific would help and is not known, write a short [placeholder]. Plain text, no subject line, no sign-off name.`, [], [], params.actor.name || '', '', evidence).catch(() => ''), 2400)
    const link = prep.job.match(/https?:\/\/\S+/)?.[0]
    const resumeLine = resume ? `📎 Resume: *${clean(resume.title, 80)}*${resumes.length > 1 ? ` (best match of ${resumes.length} saved)` : ''}` : "📎 I don't have your resume saved. Send it here as a PDF and I'll use it for every application."
    return done(`💼 *Ready to apply: ${clean(prep.job.replace(/https?:\/\/\S+/, ''), 120) || 'this job'}*\n\n${resumeLine}\n\n✍️ *Cover letter*\n${letter || '(I could not draft it just now; ask again.)'}\n\n${link ? `Apply here: ${link}\n\n` : ''}I haven't applied. Submit it yourself, then say *show my job applications* and I'll track the replies.`, 'job-prepare')
  }
  return null
}
