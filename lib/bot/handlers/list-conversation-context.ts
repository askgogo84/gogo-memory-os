export function parseExplicitListShow(text:string):string|null{
  const t=String(text||'').trim()
  const m=t.match(/^\s*(?:show|open|view)(?:\s+me)?\s+(?:my\s+|the\s+)?(.+?)\s+list(?:\s+now)?\s*$/i)
  return m?.[1]?.trim()||null
}

export function isActiveListShow(text:string){
  return /^\s*(?:show|open|view)(?:\s+me)?\s+(?:the\s+|my\s+)?list(?:\s+now)?\s*$/i.test(String(text||''))
}

function cleanItem(value:string){return value.replace(/^[,;\s]+|[,;\s]+$/g,'').replace(/\s+/g,' ').trim()}

export function parseActiveListAdd(text:string):string[]|null{
  const t=String(text||'').trim()
  let payload=''
  let m=t.match(/^\s*also\s+add\s+(.+?)\s*$/i)
  if(m)payload=m[1]
  if(!payload){m=t.match(/^\s*add\s+(.+?)\s+also\s*$/i);if(m)payload=m[1]}
  if(!payload)return null
  const items=payload.split(/\s*(?:,|\band\b)\s*/i).map(cleanItem).filter(Boolean).slice(0,12)
  return items.length?items:null
}
