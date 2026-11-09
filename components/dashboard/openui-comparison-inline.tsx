'use client'

import { useEffect, useMemo, useState } from 'react'
import { savedComparisonId, type SavedComparisonRead } from '@/lib/openui/search-observation'
import { OpenUISearchResults } from './openui-search-results'

/** Only saved comparison links become interactive cards. The endpoint authenticates
 * the session and filters by exact run owner. A random run ID never grants access.
 */
export function OpenUIComparisonInline({text}:{text:string}) {
  const id=useMemo(()=>savedComparisonId(text),[text])
  const [result,setResult]=useState<SavedComparisonRead|null>(null)
  useEffect(()=>{
    setResult(null)
    if(!id)return
    let active=true
    let busy=false
    const refresh=async()=>{
      if(busy || (typeof document!=='undefined' && document.hidden))return
      busy=true
      try{
        const res=await fetch('/api/comparisons/'+encodeURIComponent(id),{
          credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(12000),
        })
        if(!res.ok){if(active)setResult(null);return}
        const body=await res.json()
        if(active && body && Array.isArray(body.providers))setResult(body as SavedComparisonRead)
      }catch{ /* Unavailable/unauthorized comparisons must never reveal cached content. */ }
      finally{busy=false}
    }
    void refresh()
    const interval=setInterval(()=>void refresh(),30000)
    return()=>{active=false;clearInterval(interval)}
  },[id])
  if(!id||!result)return null
  return <div className="mt-4 max-w-[650px]">
    <OpenUISearchResults data={result} compact fullHref={'/dashboard/comparisons/'+encodeURIComponent(id)}/>
  </div>
}
