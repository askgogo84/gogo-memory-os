import type { ReactNode } from 'react'
import type { UserLearningReport } from '@/lib/agent/learning-report'

const number=(v:number|null|undefined,digits=0)=>v==null?'Unavailable':v.toLocaleString('en-US',{maximumFractionDigits:digits})
const rate=(v:number|null)=>v==null?'Unavailable':`${(v*100).toFixed(1)}%`
const time=(v:string|null)=>v?new Date(v).toISOString().replace('T',' ').slice(0,16)+' UTC':'Unavailable'
function Section({title,note,children}:{title:string;note?:string;children:ReactNode}){
  return <section className="rounded-xl border border-[#292929] bg-[#111] p-4 sm:p-6"><h2 className="text-lg font-medium">{title}</h2>{note?<p className="mt-2 text-sm leading-6 text-[#aaa]">{note}</p>:null}<div className="mt-4">{children}</div></section>
}
function Table({labels,rows}:{labels:string[];rows:ReactNode[][]}){
  return rows.length?<div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{labels.map(label=><th scope="col" key={label} className="whitespace-nowrap border-b border-[#333] px-3 py-3 font-medium text-[#aaa]">{label}</th>)}</tr></thead><tbody>{rows.map((row,i)=><tr key={i}>{row.map((cell,j)=><td key={j} className="border-b border-[#222] px-3 py-3 align-top">{cell}</td>)}</tr>)}</tbody></table></div>:<p className="py-4 text-sm text-[#aaa]">No evidence recorded in this sample.</p>
}
export function BrainReport({report:r}:{report:UserLearningReport}){
  const s=r.summary,t=r.taskMeasurements
  const cards=[['Learning outcomes',number(s.decisions)],['Provider-verified',number(s.verifiedCompletions)],['Positive evidence',number(r.positiveEvidence)],['Corrections / failures',`${s.corrections} / ${s.failures}`],['Guarded-live hints',number(r.routing.allowedHints)],['Shadow-only hints',number(r.routing.shadowOnlyHints)]]
  return <>
    <div className="rounded-xl border border-[#24433e] bg-[#10201d] p-4 text-sm leading-6 text-[#c3dcd6]">Learning stays within your permissions. Typed state takes precedence over learned hints and semantic guesses. Approvals and provider verification remain required; unknown mutations are never automatically retried.</div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">{cards.map(([label,value])=><div key={label} className="rounded-xl border border-[#292929] bg-[#111] p-4"><p className="text-xs text-[#aaa]">{label}</p><p className="mt-3 text-3xl font-semibold tabular-nums">{value}</p></div>)}</div>
    <p className="text-xs leading-5 text-[#aaa]">Updated {time(r.generatedAt)} · {r.windowHours} hours · up to {r.sampleLimit} activity rows. {r.truncated?'Sample limit reached; figures describe only the newest rows.':'Activity sample limit not reached.'} {r.learningEvents} learning events; {r.legacyUnidentifiedEvents} legacy events lack decision IDs and cannot be deduplicated. Replacement-route evidence: {r.replacementEvidence}; this is not a verified completion. <a className="underline text-[#2fb8a6]" href={`/api/dashboard/brain?hours=${r.windowHours}`}>Open sanitized JSON</a></p>
    <Section title="Outcome quality" note="Rates describe observed decision/handler outcomes in this sample. First-route accuracy uses only explicitly judged routes; completion alone does not establish correct first routing.">
      <Table labels={['Metric','Measured rate','Evidence']} rows={[
        ['Provider-verified completion',rate(s.verifiedCompletionRate),`${s.verifiedCompletions} / ${s.decisions}`],
        ['Clarification',rate(s.clarificationRate),`${s.clarifications} / ${s.decisions}`],
        ['Correction',rate(s.correctionRate),`${s.corrections} / ${s.decisions}`],
        ['Outcome unknown',rate(s.unknownRate),`${s.unknown} / ${s.decisions}`],
        ['First-route accuracy',rate(s.firstRouteAccuracy),`${s.firstRouteJudgments} judged routes`],
      ]}/>
    </Section>
    <Section title="Learned routing patterns" note="Calibrated confidence is the 95% Wilson lower bound of provider-verified completion, with at least 20 identified samples. Pattern totals summarize evidence; they do not grant live eligibility. Conflicts, corrections, typed context and action safety still control each decision.">
      <Table labels={['Domain / handler','Outcomes','Verified','Negative','Calibration samples','Calibrated confidence']} rows={r.patterns.map(p=>[`${p.domain} / ${p.handler}`,p.decisions,p.verifiedCompletions,p.corrections+p.failures,p.calibrationSamples,p.calibrationSamples<p.minimumSamples?'Insufficient evidence':rate(p.confidence)])}/>
    </Section>
    <Section title="Recent routing decisions" note="Guarded-live means an allowed first-refusal hint, not proof of execution. Rejected candidates may have no handler. No permission changes are made here.">
      <Table labels={['Time','Handler','Mode','Confidence','Guard reason']} rows={r.routeDecisions.map(d=>[time(d.at),d.handler||'No candidate',d.guardedLive?'Guarded-live hint':'Shadow-only',rate(d.confidence),d.reason.replace(/_/g,' ')])}/>
    </Section>
    <Section title="Jev usage" note="Counts include explicitly attempted calls only. Token totals cover calls with recorded usage; unavailable usage is not zero.">
      <Table labels={['Calls','Failed calls','Deterministic skips','Input tokens','Output tokens','Mean latency']} rows={[[r.jev.calls,r.jev.failedCalls,r.jev.deterministicSkips,`${number(r.jev.inputTokens.total)} (${r.jev.inputTokens.measuredCalls} measured calls)`,`${number(r.jev.outputTokens.total)} (${r.jev.outputTokens.measuredCalls} measured calls)`,r.jev.meanLatencyMs==null?'Unavailable':`${number(r.jev.meanLatencyMs)} ms`]]}/>
    </Section>
    <Section title="Model usage & cost" note="Recorded general-plan SDK calls only. Specialist model calls and whole-task model cost are not fully instrumented. Cost estimates use operator-configured rates captured with each event; missing prices stay unavailable.">
      <Table labels={['Provider / model','Calls','Input tokens','Output tokens','Estimated USD','Priced calls']} rows={r.modelUsage.map(m=>[`${m.provider} / ${m.model}`,m.calls,`${number(m.inputTokens.total)} (${m.inputTokens.measuredCalls} measured)`,`${number(m.outputTokens.total)} (${m.outputTokens.measuredCalls} measured)`,number(m.estimatedCostUsd.total,6),`${m.estimatedCostUsd.measuredCalls} / ${m.calls}`])}/>
      <p className="mt-4 text-xs text-[#aaa]">Completed task sample: at most {r.taskSampleLimit}; {r.taskSampleTruncated?'limit reached':'limit not reached'}. {r.taskHistoryTruncated?'Linked history limit reached; task averages withheld.':'Linked task histories include activity before the reporting window.'}</p>
      <Table labels={['Task metric','Measured value','Coverage']} rows={[
        ['Completed tasks',number(t?.completedTasks),'Completed in the selected window'],
        ['Planner SDK calls / measured task',number(t?.plannerSdkCallsPerMeasuredCompletedTask,2),`${t?.measuredPlannerTasks??0} measured tasks`],
        ['Planner input tokens / measured task',number(t?.plannerInputTokensPerMeasuredCompletedTask,1),`${t?.inputTokenTasks??0} measured tasks`],
        ['Planner output tokens / measured task',number(t?.plannerOutputTokensPerMeasuredCompletedTask,1),`${t?.outputTokenTasks??0} measured tasks`],
        ['Planner estimated USD / priced task',number(t?.plannerEstimatedCostUsdPerMeasuredCompletedTask,6),`${t?.pricedTasks??0} priced tasks`],
        ['Jev calls / linked task',number(t?.jevCallsPerLinkedCompletedTask,2),`${t?.linkedJevTasks??0} linked tasks`],
        ['Mean completed-task elapsed time',t?.meanCompletedTaskElapsedMs==null?'Unavailable':`${number(t.meanCompletedTaskElapsedMs/1000,1)} s`,'Includes approval wait'],
        ['Whole-task model/token/cost totals','Unavailable','Specialist coverage incomplete'],
      ]}/>
    </Section>
    <Section title="Daily evidence" note="UTC event-day cohorts within the selected sample. Later corrections can belong to a different day; these rows are not a cumulative success curve or proof of causal improvement.">
      <Table labels={['UTC date','Outcomes','Verified','Corrections','Clarifications','Unknown']} rows={r.dailyEvidence.map(d=>[d.day,d.decisions,d.verifiedCompletions,d.corrections,d.clarifications,d.unknown])}/>
    </Section>
    <Section title="Recent learning events" note="Only time, routing labels and evidence state are shown. Messages, email bodies, provider IDs, credentials and private payloads are omitted.">
      <Table labels={['Time','Domain','Handler','Outcome','Provider verified']} rows={r.recentEvents.map(e=>[time(e.at),e.domain,e.handler,e.outcome,e.verified?'Yes':'No'])}/>
    </Section>
  </>
}
