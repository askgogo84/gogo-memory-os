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

/** A newsletter/email field beside a navigation Login link is not a login wall. */
export function isLoginFormPage(page:{url?:string;title?:string;text?:string;forms?:Array<{inputs?:Array<{name?:string;type?:string;label?:string}>}>}):boolean {
  if(isLoginUrl(page.url||''))return true
  const inputs=(page.forms||[]).flatMap(form=>form.inputs||[])
  const descriptors=inputs.map(input=>`${input.name||''} ${input.type||''} ${input.label||''}`)
  const copy=`${page.title||''} ${page.text||''}`
  const loginCopy=/\b(sign in|log in|login|account login)\b/i.test(copy)
  if(descriptors.some(value=>/\bpassword\b/i.test(value))&&loginCopy)return true
  const loginInput=descriptors.some(value=>/\b(username|email|phone|mobile|login)\b/i.test(value))
  const activePrompt=/\b(?:sign in|log in|login) (?:to continue|to your account|required)\b/i.test(copy)
    || /^(?:sign in|log in|login)(?:\s*[-–—|:]|$)/i.test(page.title?.trim()||'')
  return loginInput&&activePrompt
}

/** Preserve only observed public Croma product slugs; never exempt account URLs. */
export function publicCromaProductUrl(raw:unknown):string|null {
  try {
    const url=new URL(String(raw||''))
    if(url.protocol!=='https:'||url.username||url.password||url.port
      || !['croma.com','www.croma.com'].includes(url.hostname)
      || !/^\/[a-z0-9]+(?:-[a-z0-9]+){3,}-?\/p\/\d{6,7}\/?$/i.test(url.pathname)
      || url.pathname.length>260 || /(?:^|-)(?:token|session|secret|password|auth)(?:-|\/)/i.test(url.pathname))return null
    url.search='';url.hash=''
    return url.href
  }catch{return null}
}

export type BrowserEvidenceChoice={id:string;text:string}
/** Ignore prose after a leading JSON fence; only validated evidence is returned. */
export function parseBrowserEvidenceResponse(raw:string):unknown {
  const text=raw.trim()
  const fence=text.match(/^```(?:json)?\s*([\s\S]*?)\s*```(?:\s|$)/)
  return JSON.parse(fence?fence[1]:text)
}
/** Repair quoting by selecting bounded spans from the observation, not model prose. */
export function browserEvidenceChoices(pageText:string,title=''):BrowserEvidenceChoice[] {
  const text=pageText.replace(/\s+/g,' ').trim().slice(0,18000)
  const choices:BrowserEvidenceChoice[]=title?[{id:'title',text:title}]:[]
  for(let start=0;start<text.length;start+=100){
    const space=start?text.indexOf(' ',start-1):-1
    const left=space<0?start:space+1
    const cap=Math.min(text.length,left+180)
    const lastSpace=cap<text.length?text.lastIndexOf(' ',cap):cap
    const quote=text.slice(left,lastSpace>left?lastSpace:cap)
    if(quote.length>=12)choices.push({id:`p${start}`,text:quote})
  }
  return choices
}
export function selectedBrowserEvidence(value:unknown,choices:BrowserEvidenceChoice[],pageText:string,title=''):string|null {
  if(!value||typeof value!=='object')return null
  const result=value as {complete?:unknown;evidenceIds?:unknown}
  if(result.complete!==true||!Array.isArray(result.evidenceIds)||!result.evidenceIds.length||result.evidenceIds.length>6)return null
  const quotes:string[]=[]
  for(const id of result.evidenceIds){
    if(typeof id!=='string')return null
    const choice=choices.find(item=>item.id===id)
    if(!choice)return null
    quotes.push(choice.text)
  }
  return verifiedBrowserAnswer({complete:true,evidence:quotes},pageText,title)
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
