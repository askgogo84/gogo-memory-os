/** Pure, fail-closed boundary between page observations and completion. */
export function isLoginDestination(page:{url?:string;text?:string;title?:string}):boolean {
  try {
    const path=new URL(page.url||'').pathname
    return /^\/(?:accounts\/)?(?:login|signin|sign-in)(?:\/|$)/i.test(path)
  }catch{return false}
}

/** Conservative metadata-only grammar; extra requested fields require body evidence. */
export function isTitleOnlyObjective(objective:string):boolean {
  const text=objective.toLowerCase()
    .replace(/https?:\/\/[^\s]+/g,' ')
    .replace(/do not click, fill, submit, log in, or navigate away[.!]?/g,' ')
    .replace(/['’]s\b/g,'')
  const words:string[]=text.match(/[a-z]+/g)||[]
  const allowed=new Set('open visit navigate to read inspect report show tell me give get what is whats the title of this that its a an website page site document tab current exact only and then please'.split(' '))
  return words.includes('title')&&words.every(word=>allowed.has(word))
}

export function verifiedBrowserAnswer(value:unknown,pageText:string,title='',allowTitleOnly=false):string|null {
  if(!value||typeof value!=='object')return null
  const result=value as {complete?:unknown;answer?:unknown;evidence?:unknown}
  if(result.complete!==true)return null
  const normalize=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase()
  const observed=normalize(pageText)
  const normalizedTitle=normalize(title)
  if((observed.length<40&&!(allowTitleOnly&&normalizedTitle))||!Array.isArray(result.evidence)||!result.evidence.length)return null
  if(!result.evidence.every(quote=>typeof quote==='string'&&((normalize(quote).length>=12&&observed.includes(normalize(quote)))||(normalizedTitle&&normalize(quote)===normalizedTitle))))return null
  if(!allowTitleOnly&&!result.evidence.some(quote=>normalize(String(quote))!==normalizedTitle&&normalize(String(quote)).length>=12&&observed.includes(normalize(String(quote)))))return null
  // Return only verified source excerpts. A genuine quote cannot launder an
  // unrelated or contradictory freeform answer into a successful result.
  const excerpts=[...new Set(result.evidence.map(quote=>String(quote).replace(/\s+/g,' ').trim()))].join('\n')
  return excerpts.length<=1800?excerpts:null
}
