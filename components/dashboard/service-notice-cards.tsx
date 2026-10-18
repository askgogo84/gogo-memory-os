import type {ServiceNotice} from '@/lib/dashboard/service-notices'

/** Review-only evidence. A billing warning grants no payment or account authority. */
export function ServiceNoticeCards({notices,unavailable=false}:{notices:ServiceNotice[];unavailable?:boolean}){
  return <>
    {unavailable&&<p role="status" className="py-3 text-[15px] text-[#d9a441]">Service notices could not be loaded. Try refreshing.</p>}
    {notices.map(notice=><article key={notice.id} className="border-t border-[#2a2a2a] py-4 first:border-t-0">
      <h3 className="text-[16px] font-semibold text-[#f2efea]">{notice.title}</h3>
      <p className="mt-1 text-[15px] leading-5 text-[#b7b7b7]">{notice.summary}</p>
      <p className="mt-2 text-[13px] text-[#d9a441]">Review with the provider. No payment or account change is authorized.</p>
      <details className="mt-2 text-[13px] text-[#a8a8a4]"><summary className="cursor-pointer">Email source</summary><p className="mt-1 break-all">Thread: {notice.threadId}{notice.messageId?` · Message: ${notice.messageId}`:''}</p></details>
    </article>)}
  </>
}
