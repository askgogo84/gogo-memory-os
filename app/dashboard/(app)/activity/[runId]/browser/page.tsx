import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getSession } from '@/lib/dashboard/session'
import { browserContextForRun, getDashboardActivityRun } from '@/lib/dashboard/agent-activity'
import { BrowserLiveShot } from '@/components/dashboard/browser-live-shot'
import { listVaultCredentialsForDomain } from '@/lib/vault/credential-store'
import { findVaultProviderForDomain } from '@/lib/vault/providers'
import { VaultResumeTaskButton } from '@/components/dashboard/vault-resume-task-button'
import {RestoreBrowserHandoffButton} from '@/components/dashboard/restore-browser-handoff-button'
import {browserHandoffIsLive} from '@/lib/agent/browser-handoff-health'

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
  const cloudHandoff=handoffActive&&Boolean(handoff?.takeoverUrl)
  const cloudTakeover=cloudHandoff&&await browserHandoffIsLive(handoff.takeoverUrl)
  const expiredHandoff=cloudHandoff&&!cloudTakeover
  const canRestore=expiredHandoff&&run.metadata?.mode==='read'&&run.metadata?.browser_safe_to_retry!==false
    &&Boolean(run.metadata?.commerce_parent_id||run.metadata?.comparison_parent_id)
  const deviceHandoff=handoffActive&&handoff?.mode==='device'&&Boolean(handoff?.providerUrl)
  const latest=[...run.steps].reverse().find(s=>s.toolName==='secure_browser'||/browser/i.test(s.toolName)||s.output?.browser)
  const raw:any=latest?.output?.browser||latest?.output?.browserState||latest?.output||{}
  const pageTitle=browser.title
  const pageUrl=String(raw?.url||handoff?.providerUrl||run.metadata?.browser_url||'')
  let displayUrl=browser.hostname||'Secure browser'
  try{
    const u=new URL(pageUrl)
    displayUrl=u.hostname+u.pathname
  }catch{}

  const latestOutput:any=latest?.output||{}
  const humanAuth=latestOutput?.blockReason==='human_auth_required'||String(run.error||'')==='human_auth_required'
  const host=browser.hostname||(()=>{try{return new URL(pageUrl).hostname}catch{return ''}})()
  const secondaryAuth=Boolean(run.metadata?.secondary_auth)||(humanAuth&&Boolean(latestOutput?.authReason)&&latestOutput.authReason!=='password')
  const vaultProvider=humanAuth&&!secondaryAuth&&host?findVaultProviderForDomain(host):null
  const vaultAccounts=vaultProvider
    ? await listVaultCredentialsForDomain(session.telegramId,host).catch(()=>[])
    : []
  const vaultCredential=vaultAccounts.length===1?vaultAccounts[0]:null
  const vaultNeedsSelection=vaultAccounts.length>1

  const headline=expiredHandoff?'Secure browser expired':browser.providerBlocked?'Blocked by the provider':cloudTakeover?'Gogo is standing by':run.status==='running'?'Gogo is working in the browser':'Browser task'

  return <div className="mx-auto w-full max-w-[1180px] pb-10">
    <header className="border-b border-[#2A2A2A] pb-4">
      {typeof run.metadata?.commerce_parent_id==='string'&&<Link href={'/dashboard/commerce?run='+encodeURIComponent(run.metadata.commerce_parent_id)} className="text-sm text-[#2FB8A6]">← Back to your comparison</Link>}
      {typeof run.metadata?.comparison_parent_id==='string'&&<Link href={'/dashboard/comparisons/'+encodeURIComponent(run.metadata.comparison_parent_id)} className="text-sm text-[#2FB8A6]">← Back to your saved comparison</Link>}
      <div className="flex items-center justify-between gap-3">
        <Link href={'/dashboard/activity/'+encodeURIComponent(run.id)} className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-[.12em] text-[#6A6A6A] hover:text-[#2FB8A6]">← Back to task</Link>
        <span className="text-[11px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Gogo&apos;s browser</span>
      </div>
      <div className="mt-4 flex items-start gap-3">
        <span className={'mt-1.5 h-3 w-3 rounded-full '+(browser.providerBlocked?'border border-[#9A9A9A] bg-[#111111]':cloudTakeover?'bg-[#D9A441]':'bg-[#2FB8A6] shadow-[0_0_0_5px_rgba(241,130,25,.10)]')}/>
        <div>
          <h1 className="font-serif text-[28px] font-semibold leading-tight text-[#F2EFEA]">{headline}</h1>
          <p className="mt-1 text-[13px] text-[#9A9A9A]">{displayUrl}{run.steps.length?' · step '+Math.min(run.steps.length,Math.max(1,run.steps.filter(s=>s.status==='completed').length+1))+' of '+run.steps.length:''}</p>
        </div>
      </div>
    </header>

    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <section className="overflow-hidden rounded-[16px] border border-[#2A2A2A] bg-[#111111]">
        <div className="flex h-9 items-center gap-2 bg-[#161616] px-3">
          <span className="h-2 w-2 rounded-full bg-[#2A2A2A]"/>
          <span className="truncate text-[10px] text-[#6A6A6A]">{displayUrl}</span>
        </div>

        {expiredHandoff?
          <div className="grid min-h-[430px] place-items-center px-7 py-10 text-center">
            <div className="max-w-xl"><h2 className="font-serif text-[26px] font-semibold text-[#F2EFEA]">This temporary browser has stopped.</h2>
              <p className="mt-3 text-[14px] leading-6 text-[#9A9A9A]">Your saved task and comparison are still here. The old Take control link cannot open this session. Restore a fresh secure browser for the same read-only task, then select your delivery location there.</p>
            </div>
          </div>
        :browser.providerBlocked?
          <div className="grid min-h-[430px] place-items-center px-7 py-10">
            <div className="max-w-xl">
              <div className="grid h-11 w-11 place-items-center rounded-full bg-[#161616] text-[#2FB8A6]">▣</div>
              <h2 className="mt-4 font-serif text-[26px] font-semibold text-[#F2EFEA]">This site won&apos;t let Gogo in.</h2>
              <p className="mt-3 text-[14px] leading-6 text-[#9A9A9A]">The provider is refusing visits from automated browsers running on servers. Taking control of the same cloud browser would not help because the block is based on where the request comes from.</p>
              <p className="mt-3 text-[14px] leading-6 text-[#9A9A9A]">Open the provider on your own device and continue there. Gogo keeps the task context and does not invent provider results.</p>
            </div>
          </div>
        :cloudTakeover?
          <BrowserLiveShot runId={run.id}/>
        :
          <div className="grid min-h-[430px] place-items-center px-7 py-10 text-center">
            <div>
              <div className="mx-auto h-12 w-12 rounded-full bg-[#1A1710]"/>
              <h2 className="mt-4 font-serif text-[24px] font-semibold text-[#F2EFEA]">{pageTitle||'Browser state recorded'}</h2>
              <p className="mt-2 max-w-lg text-[13px] leading-5 text-[#9A9A9A]">{browser.summary||'Gogo recorded the latest secure-browser state for this task.'}</p>
            </div>
          </div>}
      </section>

      <aside className="space-y-4">
        <section className="rounded-[16px] border border-[#2A2A2A] bg-[#111111] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Current state</p>
          <h2 className="mt-2 text-[15px] font-semibold text-[#F2EFEA]">{pageTitle||headline}</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#9A9A9A]">{browser.summary||run.summary}</p>
        </section>

        {humanAuth&&vaultProvider&&<section className="rounded-[16px] border border-[#2a2a2a] bg-[#151515] p-5 text-[#F2EFEA]">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#8f8f8f]">Secure Vault</p>
          <h2 className="mt-2 text-[15px] font-semibold">{vaultNeedsSelection?'Choose account':vaultCredential?'Login saved':'Login needed'} · {vaultProvider.label}</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#a9a9a9]">{vaultNeedsSelection
            ? 'More than one saved login is valid for this provider. Choose the account Gogo should use for this task.'
            : vaultCredential
              ? 'A domain-bound login is available. Gogo can retry this same browser task without putting the password into chat or model context.'
              : 'Save the login securely. Gogo will use it only on the allowed provider domain, then resume this task.'}</p>
          <div className="mt-4">
            {vaultNeedsSelection
              ? <div className="space-y-2">
                  {vaultAccounts.map(account=><VaultResumeTaskButton
                    key={account.credentialId}
                    runId={run.id}
                    credentialId={account.credentialId}
                    label={`Use ${account.accountLabel} · ${account.usernameHint}`}
                  />)}
                </div>
              : vaultCredential
                ? <VaultResumeTaskButton runId={run.id} credentialId={vaultCredential.credentialId}/>
                : <Link href={`/dashboard/you/vault/add/${vaultProvider.key}?returnRun=${encodeURIComponent(run.id)}`} className="inline-flex h-11 w-full items-center justify-center rounded-[11px] bg-[#F2EFEA] px-4 text-[13px] font-bold text-[#0B0B0B]">Add {vaultProvider.label} login</Link>}
          </div>
        </section>}

        {run.metadata?.auth_reconciliation_required&&<section className="rounded-[16px] bg-[#1A1710] p-5">
          <h2 className="font-serif text-[22px] text-[#F2EFEA]">Verify the outcome with the provider</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#D9A441]">The retained browser is unavailable after a possible submission. Check your booking, check-in, or payment status directly with the provider before taking any further action. Gogo will not repeat the action.</p>
        </section>}
        {expiredHandoff&&<section className="rounded-[16px] bg-[#1A1710] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#D9A441]">Browser session expired</p>
          <h2 className="mt-2 font-serif text-[22px] font-semibold text-[#F2EFEA]">Continue this saved task</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#9A9A9A]">Restoring opens a fresh browser on the same provider. It does not create a new comparison or submit an order. Any location selected only in the stopped browser needs to be selected again.</p>
          {canRestore?<RestoreBrowserHandoffButton runId={run.id}/>:<p className="mt-3 text-[12px] text-[#D9A441]">This task cannot be safely restored automatically. Check the provider directly before retrying.</p>}
        </section>}
        {(cloudTakeover||deviceHandoff)&&<section className="rounded-[16px] bg-[#1A1710] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#D9A441]">{deviceHandoff?'Your device':'Human handoff'}</p>
          <h2 className="mt-2 font-serif text-[22px] font-semibold text-[#F2EFEA]">{deviceHandoff?'Open this on your device.':'Take control when Gogo needs you.'}</h2>
          <p className="mt-2 text-[12.5px] leading-5 text-[#9A9A9A]">{deviceHandoff?'The provider blocks the server browser. Continue on your own connection.':'Use the same persistent browser session for the human-only step, then return control to Gogo.'}</p>
          <a href={'/api/dashboard/agent/runs/'+encodeURIComponent(run.id)+'/handoff'} target="_blank" rel="noopener" className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-[11px] bg-[#2FB8A6] px-4 text-[13px] font-bold text-[#F2EFEA]">{deviceHandoff?'Open provider':'Take control'}</a>
          {cloudTakeover&&(secondaryAuth||humanAuth||run.metadata?.commerce_parent_id||run.metadata?.comparison_parent_id)&&<div className="mt-3"><VaultResumeTaskButton runId={run.id} label={(run.metadata?.secondary_auth?.safeToRetry===false||run.metadata?.browser_safe_to_retry===false)?"Check outcome without repeating action":"Resume this task"}/></div>}
          {(run.metadata?.secondary_auth?.safeToRetry===false||run.metadata?.browser_safe_to_retry===false)&&<p className="mt-3 text-[12px] text-[#D9A441]">An action may already have reached the provider. Gogo will only inspect the result after you finish authentication; it will not repeat the action.</p>}
        </section>}
        {(secondaryAuth||run.metadata?.browser_waiting)&&!cloudTakeover&&run.metadata?.secondary_auth?.safeToRetry!==false&&run.metadata?.browser_safe_to_retry!==false&&<section className="rounded-[16px] bg-[#1A1710] p-5">
          <p className="mb-3 text-[12px] text-[#D9A441]">The secure browser is not available yet. Finish any other active takeover, then retry this saved task.</p>
          <VaultResumeTaskButton runId={run.id} label="Retry this task"/>
        </section>}

        <section className="rounded-[16px] border border-[#2A2A2A] bg-[#111111] p-5">
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#6A6A6A]">Safe handoff</p>
          <p className="mt-2 text-[12.5px] leading-5 text-[#9A9A9A]">Passwords, OTPs and payment-auth values stay in the provider/browser flow. AskGogo does not ask you to paste those secrets into Activity.</p>
        </section>
      </aside>
    </div>
  </div>
}
