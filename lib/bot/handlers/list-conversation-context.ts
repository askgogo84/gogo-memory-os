export function isActiveListShow(text:string){
  return /^\s*(?:show|open|view)(?:\s+me)?\s+(?:the\s+|my\s+)?list(?:\s+now)?\s*$/i.test(String(text||''))
}

export function parseExplicitListShow(text:string):string|null{
  const t=String(text||'').trim()
  if(isActiveListShow(t))return null
  const m=t.match(/^\s*(?:show|open|view)(?:\s+me)?\s+(?:my\s+|the\s+)?(.+?)(?:\s+list)?(?:\s+now)?\s*$/i)
  return m?.[1]?.trim()||null
}

function cleanItem(value:string){return value.replace(/^[,;\s]+|[,;\s]+$/g,'').replace(/\s+/g,' ').trim()}

export function parseActiveListAdd(text:string):string[]|null{
  const t=String(text||'').trim()
  let payload=''
  let m=t.match(/^\s*also\s+add\s+(.+?)\s*$/i)
  if(m)payload=m[1]
  if(!payload){m=t.match(/^\s*add\s+(.+?)\s+also\s*$/i);if(m)payload=m[1]}
  if(!payload)return null

  // Context is only for destination-less follow-ups. Explicit targets such as
  // “also add a meeting to my calendar” or “also add milk to groceries” belong to
  // their normal calendar/reminder/list router and must never be swallowed here.
  if(/\b(?:to|into)\s+(?:my\s+|the\s+)?\S+/i.test(payload))return null
  if(/\b(?:calendar|reminder|alarm)\b/i.test(payload))return null

  const items=payload.split(/\s*(?:,|\band\b)\s*/i).map(cleanItem).filter(Boolean).slice(0,12)
  return items.length?items:null
}
