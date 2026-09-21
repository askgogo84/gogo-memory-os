import { getSession } from '@/lib/dashboard/session'
import { supabaseAdmin } from '@/lib/supabase-admin'

export const dynamic='force-dynamic'

function fmtDate(v:string|null){
  if(!v)return 'No date'
  const d=new Date(v)
  return Number.isNaN(d.getTime())?v:new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'short',year:'numeric'}).format(d)
}
function size(bytes:number|null){
  if(!bytes)return ''
  if(bytes<1024)return `${bytes} B`
  if(bytes<1024*1024)return `${Math.round(bytes/1024)} KB`
  return `${(bytes/1024/1024).toFixed(1)} MB`
}

export default async function LibraryPage(){
  const session=await getSession()
  const tgNum=parseInt(session?.telegramId||'',10)
  const {data,error}=Number.isFinite(tgNum)
    ?await supabaseAdmin.from('documents').select('id,doc_type,title,summary,doc_date,expires_on,mime,size_bytes,created_at').eq('telegram_id',tgNum).order('created_at',{ascending:false}).limit(100)
    :{data:[],error:null}

  return <div className="mx-auto w-full max-w-[1100px] pb-10">
    <header className="border-b border-[#1f1f1f] pb-5">
      <div className="final-dark-eyebrow">Documents</div>
      <h1 className="final-dark-title mt-2 text-[34px]">Library</h1>
      <p className="mt-2 max-w-2xl text-[13px] leading-5 text-[#9a9a9a]">Tickets, receipts, PDFs and documents Gogo has filed for you.</p>
    </header>
    {error?<div className="mt-5 final-dark-panel p-5 text-[12px] text-[#d96c5f]">Couldn’t load your Library right now.</div>:(
      <section className="mt-5 final-dark-panel overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3.5"><span className="final-dark-eyebrow">Saved documents</span><span className="text-[10px] text-[#6a6a6a]">{data?.length||0}</span></div>
        <div className="border-t border-[#1f1f1f] px-4">
          {(data||[]).length?(data||[]).map((d:any)=><div key={d.id} className="grid gap-2 border-t border-[#1f1f1f] py-4 first:border-t-0 sm:grid-cols-[minmax(0,1fr)_auto]">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><span className="text-[#2fb8a6]">▣</span><h2 className="truncate text-[13px] font-medium text-[#f2efea]">{d.title||'Saved document'}</h2></div>
              <p className="mt-1 line-clamp-2 text-[11px] leading-4 text-[#9a9a9a]">{d.summary||String(d.doc_type||'document').replaceAll('_',' ')}</p>
              <div className="mt-2 flex flex-wrap gap-2 text-[9px] uppercase tracking-[.08em] text-[#6a6a6a]"><span>{String(d.doc_type||'document').replaceAll('_',' ')}</span>{d.mime&&<span>{d.mime.split('/').pop()}</span>}{d.size_bytes&&<span>{size(d.size_bytes)}</span>}{d.expires_on&&<span className="text-[#d9a441]">Expires {fmtDate(d.expires_on)}</span>}</div>
            </div>
            <div className="text-[10px] text-[#6a6a6a]">{fmtDate(d.doc_date||d.created_at)}</div>
          </div>):<div className="py-8 text-center text-[12px] text-[#6a6a6a]">No documents saved yet. Send a PDF or photo to Gogo and it will appear here.</div>}
        </div>
      </section>
    )}
  </div>
}
