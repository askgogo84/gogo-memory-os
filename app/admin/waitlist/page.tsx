import Link from 'next/link'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

type Params={q?:string;country?:string;optin?:string;status?:string}

function fmt(iso:string|null){
  if(!iso)return '—'
  return new Intl.DateTimeFormat('en-IN',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Kolkata'}).format(new Date(iso))
}
function pill(on:boolean,yes:string,no:string){
  return <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${on?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-600'}`}>{on?yes:no}</span>
}

export default async function AdminWaitlistPage({searchParams}:{searchParams:Promise<Params>}){
  const params=await searchParams
  const q=String(params.q||'').trim()
  const country=String(params.country||'all').toUpperCase()
  const optin=String(params.optin||'all')
  const status=String(params.status||'all')

  const {data,error}=await supabaseAdmin
    .from('waitlist')
    .select('id,phone_e164,email,country,whatsapp_opt_in,source,created_at,invited_at')
    .order('created_at',{ascending:false})
    .limit(1000)

  const rows=data||[]
  const filtered=rows.filter((r:any)=>{
    if(country!=='ALL'&&String(r.country||'').toUpperCase()!==country)return false
    if(optin==='yes'&&!r.whatsapp_opt_in)return false
    if(optin==='no'&&r.whatsapp_opt_in)return false
    if(status==='invited'&&!r.invited_at)return false
    if(status==='waiting'&&r.invited_at)return false
    if(q){
      const hay=`${r.phone_e164||''} ${r.email||''} ${r.source||''}`.toLowerCase()
      if(!hay.includes(q.toLowerCase()))return false
    }
    return true
  })

  const now=Date.now()
  const day=24*60*60*1000
  const total=rows.length
  const today=rows.filter((r:any)=>now-new Date(r.created_at).getTime()<day).length
  const week=rows.filter((r:any)=>now-new Date(r.created_at).getTime()<7*day).length
  const optins=rows.filter((r:any)=>r.whatsapp_opt_in).length
  const invited=rows.filter((r:any)=>r.invited_at).length
  const sourceCounts=rows.reduce((acc:Record<string,number>,r:any)=>{
    const key=String(r.source||'unknown')
    acc[key]=(acc[key]||0)+1
    return acc
  },{})
  const topSources=Object.entries(sourceCounts).sort((a,b)=>b[1]-a[1]).slice(0,6)

  return <main className="min-h-screen bg-slate-50 p-6 text-slate-950 md:p-10">
    <div className="mx-auto max-w-7xl">
      <header className="mb-7 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">Growth</span>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">Join Gogo waitlist</h1>
          <p className="mt-2 text-sm text-slate-500">Live signups from askgogo.in, directly from Supabase.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin" className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">← Admin</Link>
          <Link href="/admin/users" className="rounded-xl bg-slate-950 px-4 py-2 text-sm font-semibold text-white">Manage users</Link>
        </div>
      </header>

      {error&&<div className="mb-5 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">Couldn’t load waitlist: {error.message}</div>}

      <section className="grid gap-4 md:grid-cols-5">
        {[
          ['Total signups',total,'All waitlist entries'],
          ['Last 24 hours',today,'New today'],
          ['Last 7 days',week,'Recent growth'],
          ['WhatsApp opt-in',optins,`${total?Math.round(optins/total*100):0}% of signups`],
          ['Invited',invited,`${Math.max(0,total-invited)} still waiting`],
        ].map(([label,value,hint])=><div key={String(label)} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold">{value}</p>
          <p className="mt-1 text-xs text-slate-400">{hint}</p>
        </div>)}
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <form className="grid gap-3 border-b border-slate-100 p-4 md:grid-cols-[minmax(0,1fr)_140px_150px_150px_auto]">
            <input name="q" defaultValue={q} placeholder="Search email, WhatsApp or source…" className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-300"/>
            <select name="country" defaultValue={country} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="ALL">All countries</option><option value="IN">India</option><option value="AE">UAE</option>
            </select>
            <select name="optin" defaultValue={optin} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">All opt-ins</option><option value="yes">WhatsApp yes</option><option value="no">WhatsApp no</option>
            </select>
            <select name="status" defaultValue={status} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">All statuses</option><option value="waiting">Waiting</option><option value="invited">Invited</option>
            </select>
            <button className="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white">Filter</button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr><th className="p-3">Joined</th><th className="p-3">Email</th><th className="p-3">WhatsApp</th><th className="p-3">Country</th><th className="p-3">Opt-in</th><th className="p-3">Source</th><th className="p-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r:any)=><tr key={r.id} className="hover:bg-slate-50">
                  <td className="p-3 text-xs text-slate-500">{fmt(r.created_at)}</td>
                  <td className="p-3 font-medium text-slate-800">{r.email||'—'}</td>
                  <td className="p-3 text-slate-700">{r.phone_e164||'—'}</td>
                  <td className="p-3">{r.country||'—'}</td>
                  <td className="p-3">{pill(Boolean(r.whatsapp_opt_in),'Opted in','No opt-in')}</td>
                  <td className="p-3 text-xs text-slate-500">{r.source||'—'}</td>
                  <td className="p-3">{r.invited_at?pill(true,'Invited','Waiting'):pill(false,'Invited','Waiting')}</td>
                </tr>)}
                {!filtered.length&&<tr><td colSpan={7} className="p-10 text-center text-slate-400">No waitlist entries match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="border-t border-slate-100 px-4 py-3 text-xs text-slate-400">Showing {filtered.length} of {total} signups.</div>
        </div>

        <aside className="space-y-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Signup sources</h2>
            <div className="mt-4 space-y-3">
              {topSources.length?topSources.map(([source,count])=><div key={source}>
                <div className="flex items-center justify-between gap-3 text-xs"><span className="truncate text-slate-600">{source}</span><span className="font-semibold text-slate-900">{count}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-emerald-500" style={{width:`${total?Math.max(4,Math.round(count/total*100)):0}%`}}/></div>
              </div>):<p className="text-xs text-slate-400">No source data yet.</p>}
            </div>
          </section>
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
            <h2 className="text-sm font-semibold text-amber-900">Access workflow</h2>
            <p className="mt-2 text-xs leading-5 text-amber-800">Use this page to review demand and opt-in status. Invites should stay a deliberate admin action; this page does not auto-message or auto-create accounts.</p>
          </section>
        </aside>
      </section>
    </div>
  </main>
}
