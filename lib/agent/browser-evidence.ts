/** Pure, fail-closed boundary between page observations and completion. */
export function isLoginDestination(page:{url?:string;text?:string;title?:string}):boolean {
  try {
    const path=new URL(page.url||'').pathname
    return /^\/(?:accounts\/)?(?:login|signin|sign-in)(?:\/|$)/i.test(path)
  }catch{return false}
}

/** True when a URL's PATH is a sign-in/login destination. Covers Amazon (/ap/signin),
 *  Flipkart (/account/login) and the generic /login,/signin,/sign-in forms. Used to keep
 *  public product/price/search reads from navigating into a login wall. */
export function isLoginUrl(url:string):boolean {
  try {
    const path=new URL(url).pathname.toLowerCase()
    return /(?:^|\/)(?:login|signin|sign-in)(?:\/|$)/.test(path)
      || /\/ap\/signin/.test(path)
      || /\/accounts?\/(?:login|signin|sign-in)/.test(path)
  } catch { return false }
}

/** Conservative metadata-only grammar; extra requested fields require body evidence. */
export function isTitleOnlyObjective(objective:string):boolean {
  const text=objective.toLowerCase()
    .replace(/https?:\/\/[^\s]+/g,' ')
    .replace(/do not click, fill, submit, log in, or navigate away[.!]?/g,' ')
    .replace(/['’]s\b/g,'')
  const words:string[]=text.match(/[a-z]+/g)||[]
  const allowed=new Set('open visit navigate to read inspect report show tell me give get what is whats the title of this that its a an website webpage page site document tab browser in current exact only and then please'.split(' '))
  return words.includes('title')&&words.every(word=>allowed.has(word))
}

export function verifiedBrowserAnswer(value:unknown,pageText:string,title='',allowTitleOnly=false):string|null {
  if(!value||typeof value!=='object')return null
  const result=value as {complete?:unknown;answer?:unknown;evidence?:unknown}
  if(result.complete!==true)return null
  const normalize=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase()
  const observed=normalize(pageText)
  const normalizedTitle=normalize(title)
  if(/^(?:loading\b|please wait\b|just a moment\b|sign in[.\s…!]*$|log in[.\s…!]*$|login[.\s…!]*$)/i.test(observed))return null
  const terseStatus=/^(?:ok|up|healthy|operational|down|unavailable|available)$/i.test(observed)
  if((!observed&&!(allowTitleOnly&&normalizedTitle))||!Array.isArray(result.evidence)||!result.evidence.length)return null
  const bodyEvidence=(quote:string)=>{const text=normalize(quote);return !!text&&observed.includes(text)&&(text.length>=12||text===observed)}
  if(!result.evidence.every(quote=>typeof quote==='string'&&((bodyEvidence(quote))||(normalizedTitle&&normalize(quote)===normalizedTitle))))return null
  if(!allowTitleOnly&&!result.evidence.some(quote=>(normalize(String(quote))!==normalizedTitle||terseStatus)&&bodyEvidence(String(quote))))return null
  // Return only verified source excerpts. A genuine quote cannot launder an
  // unrelated or contradictory freeform answer into a successful result.
  const excerpts=[...new Set(result.evidence.map(quote=>String(quote).replace(/\s+/g,' ').trim()))].join('\n')
  return excerpts.length<=1800?excerpts:null
}
