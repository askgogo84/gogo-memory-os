import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { browserContextForRun, getDashboardActivityRun } from '@/lib/dashboard/agent-activity'
import { BrowserLiveShot } from '@/components/dashboard/browser-live-shot'
import { findVaultCredentialForDomain } from '@/lib/vault/credential-store'
import { findVaultProviderForDomain } from '@/lib/vault/providers'
import { VaultResumeTaskButton } from '@/components/dashboard/vault-resume-task-button'

export const dynamic='force-dynamic'

export default async function ActivityBrowserPage({params}:{params:Promise<{runId:string}>}){
  const session=await getSession()
  if(!session)notFound()
  const {runId}=await params
  const run=await getDashboardActivityRun(session.telegramId,runId)
  if(!run)notFound()
  const browser=browserContextForRun(run)
  if(!browser.hasBrowser)notFound()

  const handoff:any=run.metadata?.handoff||{}
  const handoffActive=['paused','waiting_approval'].includes(run.status)
  const cloudTakeover=handoffActive&&Boolean(handoff?.takeoverUrl)
  const deviceHandoff=handoffActive&&handoff?.mode==='device'&&Boolean(handoff?.providerUrl)
  const latest=[...run.steps].reverse().find(s=>s.toolName==='secure_browser'||/browser/i.test(s.toolName)||s.output?.browser)
  const raw:any=latest?.output?.browser||latest?.output?.browserState||latest?.output||{}
  const pageTitle=String(raw?.title||'')
  const pageUrl=String(raw?.url||handoff?.providerUrl||'')
  let displayUrl=browser.hostname||'Secure browser'
  try{
    const u=new URL(pageUrl)
    displayUrl=u.hostname+u.pathname
  }catch{}

  const latestOutput:any=latest?.output||{}
  const humanAuth=latestOutput?.blockReason==='human_auth_required'||String(run.error||'')==='human_auth_required'
  const host=browser.hostname||(()=>{try{return new URL(pageUrl).hostname}catch{return ''}})()
  const vaultProvider=humanAuth&&host?findVaultProviderForDomain(host):null
  const vaultCredential=vaultProvider
    ? await findVaultCredentialForDomain(session.telegramId,host).catch(()=>null)
    : null

  const headline=browser.providerBlocked?'Blocked by the provider':cloudTakeover?'Gogo is standing by':run.status==='running'?'Gogo is working in the browser':'Browser task'

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="border-b border-[#b8a797] pb-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={'/dashboard/activity/'+encodeURIComponent(run.id)} className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#9a8778] hover:text-[#4D2A50]">← Back to task</Link>
        <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#9a8778]">Gogo&apos;s browser</span>
      </div>
      <div className="mt-4 flex items-start gap-3">
        <span className={'mt-1.5 h-3 w-3 rounded-full '+(browser.providerBlocked?'border border-[#6b4a34] bg-[#fbf6ef]':cloudTakeover?'bg-[#E4A97D]':'bg-[#F18219] shadow-[0_0_0_5px_rgba(241,130,25,.10)]')}/>
        <div>
          <h1 className="font-serif text-[28px] font-semibold leading-tight text-[#3E2312]">{headline}</h1>
          <p className="mt-1 text-[13px] text-[#6b4a34]">{displayUrl}{run.steps.length?' · step '+Math.min(run.steps.length,Math.max(1,run.steps.filter(s=>s.status==='completed').length+1))+' of '+run.steps.length:''}</p>
        </div>
      </div>
    </header>

    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="overflow-hidden rounded-[16px] border border-[#b8a797] bg-[#fbf6ef]">
        <div className="flex h-9 items-center gap-2 bg-[#f0eaf1] px-3">
          <span className="h-2 w-2 rounded-full bg-[#b8a797]"/>
          <span className="truncate text-[10px] text-[#9a8778]">{displayUrl}</span>
        </div>

        {browser.providerBlocked?
          <div className="grid min-h-[430px] place-items-center px-7 py-10">
            <div className="max-w-xl">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[#f0eaf1] text-[#4D2A50]">▣</div>
              <h2 className="mt-4 font-serif text-[26px] font-semibold text-[#3E2312]">This site won&apos;t let Gogo in.</h2>
              <p className="mt-3 text-[14px] leading-6 text-[#6b4a34]">The provider is refusing visits from automated browsers running on servers. Taking control of the same cloud browser would not help because the block is based on where the request comes from.</p>
              <p className="mt-3 text-[14px] leading-6 text-[#6b4a34]">Open the provider on your own device and continue there. Gogo keeps the task context and does not invent provider results.</p>
            </div>
          </div>
        :cloudTakeover?
          <BrowserLiveShot runId={run.id}/>
        :
          <div className="grid min-h-[430px] place-items-center px-7 py-10 text-center">
            <div>
              <div className="mx-auto h-12 w-12 rounded-full bg-[#fdf0e2]"/>
              <h2 className="mt-4 font-serif text-[24px] font-semibold text-[#3E2312]">{pageTitle||'Browser state recorded'}</h2>
              <p className="mt-2 max-w-lg text-[13px] leading-5 text-[#6b4a34]">{browser.summary||'Gogo recorded the latest secure-browser state for this task.'}</p>
            </div>
          </div>}
      </section>

      <aside className="space-y-4">
        <section className="rounded-[16px] border border-[#b8a797] bg-[#fbf6ef] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#9a8778]">Current state</p>
          <h2 className="mt-2 text-[15px] font-semibold text-[#3E2312]">{pageTitle||headline}</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#6b4a34]">{browser.summary||run.summary}</p>
        </section>

        {humanAuth&&vaultProvider&&<section className="rounded-[16px] border border-[#2a2a2a] bg-[#151515] p-5 text-[#F2EFEA]">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#8f8f8f]">Secure Vault</p>
          <h2 className="mt-2 text-[15px] font-semibold">{vaultCredential?'Login saved':'Login needed'} · {vaultProvider.label}</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#a9a9a9]">{vaultCredential
            ? 'A domain-bound login is available. Gogo can retry this same browser task without putting the password into chat or model context.'
            : 'Save the login securely. Gogo will use it only on the allowed provider domain, then resume this task.'}</p>
          <div className="mt-4">
            {vaultCredential
              ? <VaultResumeTaskButton runId={run.id}/>
              : <Link href={`/dashboard/you/vault/add/${vaultProvider.key}?returnRun=${encodeURIComponent(run.id)}`} className="inline-flex h-11 w-full items-center justify-center rounded-[11px] bg-[#F2EFEA] px-4 text-[13px] font-bold text-[#0B0B0B]">Add {vaultProvider.label} login</Link>}
          </div>
        </section>}

        {(cloudTakeover||deviceHandoff)&&<section className="rounded-[16px] bg-[#fdf0e2] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#D67528]">{deviceHandoff?'Your device':'Human handoff'}</p>
          <h2 className="mt-2 font-serif text-[22px] font-semibold text-[#3E2312]">{deviceHandoff?'Open this on your device.':'Take control when Gogo needs you.'}</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#6b4a34]">{deviceHandoff?'The provider blocks the server browser. Continue on your own connection.':'Use the same persistent browser session for the human-only step, then return control to Gogo.'}</p>
          <a href={'/api/dashboard/agent/runs/'+encodeURIComponent(run.id)+'/handoff'} target="_blank" rel="noopener" className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-[11px] bg-[#F18219] px-4 text-[13px] font-bold text-[#3E2312]">{deviceHandoff?'Open provider':'Take control'}</a>
        </section>}

        <section className="rounded-[16px] border border-[#b8a797] bg-[#fbf6ef] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#9a8778]">Safe handoff</p>
          <p className="mt-2 text-[12.5px] leading-5 text-[#6b4a34]">Passwords, OTPs and payment-auth values stay in the provider/browser flow. AskGogo does not ask you to paste those secrets into Activity.</p>
        </section>
      </aside>
    </div>
  </div>
}
