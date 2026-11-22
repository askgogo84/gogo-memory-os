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
/**
 * A signed-out page whose login sits behind a header link ("Log in", "Sign in"), as on Zomato and Swiggy.
 * 15 Oct live: Zomato's home page is not a login form, so a saved phone login was never tried.
 */
export function hasSignInEntry(page:{links?:Array<{text?:string}>;controls?:Array<{text?:string;label?:string;name?:string}>}):boolean {
  const labels=[...(page.links||[]).map(l=>l?.text),...(page.controls||[]).map(c=>c?.text||c?.label||c?.name)]
  return labels.some(value=>/^(?:log ?in|sign ?in)(?:\s*(?:\/|or)\s*sign ?up)?$/i.test(String(value||'').trim()))
}

export function isLoginFormPage(page:{url?:string;title?:string;text?:string;forms?:Array<{inputs?:Array<{name?:string;type?:string;label?:string}>}>}):boolean {
  if(isLoginUrl(page.url||''))return true
  const inputs=(page.forms||[]).flatMap(form=>form.inputs||[])
  const descriptors=inputs.map(input=>`${input.name||''} ${input.type||''} ${input.label||''}`)
  const copy=`${page.title||''} ${page.text||''}`
  const loginCopy=/\b(sign in|log in|login|account login)\b/i.test(copy)
  const registrationCopy=/\b(?:sign\s*up|create\s+(?:an?\s+)?account|register)\b/i.test(copy)
  // Registration forms asking for a password are auth barriers; newsletter/email
  // sign-up fields without a password are not.
  if(descriptors.some(value=>/\bpassword\b/i.test(value))&&(loginCopy||registrationCopy))return true
  const loginInput=descriptors.some(value=>/\b(username|email|phone|mobile|login)\b/i.test(value))
  const activePrompt=/\b(?:sign in|log in|login) (?:to continue|to your account|required)\b/i.test(copy)
    || /^(?:sign in|log in|login)(?:\s*[-–—|:]|$)/i.test(page.title?.trim()||'')
  return loginInput&&activePrompt
}

/**
 * Detect a signed-out content shell, not an ordinary page that merely links to Sign in.
 * A login/footer shell must never be treated as source evidence for the original task.
 * Only visible copy, a URL path, field metadata and narrow, fail-closed cues are used.
 */
export function isBrowserLoginShell(page:{
  url?:string; title?:string; text?:string;
  forms?:Array<{inputs?:Array<{name?:string;type?:string;label?:string}>}>
}):boolean {
  if(isLoginFormPage(page))return true
  // Instagram's registration route can render as an empty shell before controls load.
  // Restrict this check to its exact trusted host and path, not arbitrary /signup links.
  try {
    const url=new URL(page.url||'')
    if((url.hostname==='instagram.com'||url.hostname==='www.instagram.com')
      &&/^\/accounts\/emailsignup\/?$/i.test(url.pathname))return true
  }catch{}
  const title=String(page.title||'').replace(/\s+/g,' ').trim()
  const body=String(page.text||'').replace(/\s+/g,' ').trim()
  const leading=body.slice(0,1800)
  // Exact sign-in headers and explicit content access gates are not account navigation links.
  const loginTitle=/^(?:log\s*in|sign\s*in|login)(?:\s*[-–—|•:]\s*[^\n]{1,100})?$/i.test(title)
  const loginControls=/\b(?:log\s*in|sign\s*in|sign\s*up|username|password)\b/i.test(leading)
  if(loginTitle&&loginControls)return true

  // The active access prompt must appear at the beginning of a short signed-out page.
  // Quoted sign-in instructions in public articles or FAQs are not current auth gates.
  const opening=leading.replace(/^(?:instagram|meta)\s+/i,'')
  let host=''
  try{host=new URL(page.url||'').hostname.toLowerCase()}catch{}
  const instagram=host==='instagram.com'||host==='www.instagram.com'
  // The observer can see real post copy below a sign-in banner. Preserve the
  // already-supported caption/engagement evidence before classifying a shell.
  const visibleInstagramPost=instagram&&/\b(?:\d+\s+likes?|\d+\s+comments?|view all comments)\b|\bcaption\s*:/i.test(leading)
  // Sites may use a combined login/signup call-to-action instead of a standalone login button.
  const activeGate=/^(?:please\s+)?(?:log\s*in|sign\s*in)(?:\s+or\s+sign\s*up)?\s+(?:to|before)\s+(?:(?:continue|access|see|view|read|watch|browse|open)\s+(?:this\s+)?(?:post|reel|story|stories|photos?|videos?|content|profile|page|instagram|account)|continue|instagram)\b/i
  // Some signed-out Instagram pages show only a sign-up gate, with no "Log in".
  // Strip this gate before applying the existing real-caption evidence heuristic.
  const signupGate=/^(?:please\s+)?sign\s*up\s+(?:to|before)\s+(?:see|view|watch|access|read)\s+(?:(?:photos?\s+and\s+videos?)|(?:this\s+)?(?:post|reel|story|stories|photos?|videos?|content|profile|page))\b/i
  const instagramSignupGate=instagram&&signupGate.test(opening)
  // Signup-only marketing is an Instagram-specific observation, not a generic
  // rule for public articles that quote the same introductory sentence.
  const openingGate=body.length<900&&(activeGate.test(opening)||instagramSignupGate)
  if(openingGate&&!instagram)return true

  // Instagram's logged-out footer shell is short, sign-in-heavy and lacks post content.
  // A real post has raw unlabelled caption text; the observer does not supply "Caption:".
  if(!instagram||(!openingGate&&(body.length>=1100||!/\b(?:log\s*in|sign\s*in)\b/i.test(leading)
     ||!/\bsign\s*up\b/i.test(leading)
     ||!/\b(?:about|help|press|locations|threads|meta verified)\b/i.test(leading))))return false
  if(visibleInstagramPost)return false
  // Combined sign-in banners are not caption evidence. Remove the observed
  // access prompt and stock "and videos from friends" copy before evaluating
  // whether an unlabelled public caption is actually present below it.
  const evidenceBody=openingGate
    ?opening.replace(activeGate,'').replace(signupGate,'')
      .replace(/^\s*(?:and\s+videos?(?:\s+from\s+(?:your\s+)?friends)?|from\s+(?:your\s+)?friends)\b/i,'')
      // Login walls also carry account-creation marketing. It is not post copy.
      .replace(/\b(?:create\s+(?:(?:your|an?)\s+)?account|join\s+instagram)(?:\s+to\s+(?:see|view|watch|explore|share)\s+(?:more\s+)?(?:photos?(?:\s+and\s+videos?)?|videos?|posts?|content))?\b/gi,'')
    :leading
  const remaining=evidenceBody
    .replace(/\b(?:forgot\s+(?:your\s+)?password|don'?t\s+have\s+an\s+account|already\s+have\s+an\s+account|get\s+the\s+app|download\s+the\s+app|also\s+from\s+meta|meta\s+verified|from\s+meta|log\s*in|sign\s*in|sign\s*up|instagram|threads|locations|privacy|terms|about|help|press|api|jobs|language|english|copyright|home|explore|reels|messages|search|profile|meta)\b/gi,' ')
    .replace(/(?:©|\b20\d{2}\b)/g,' ')
    .toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu,' ').trim()
  // Treat real letters in any script as content: Indic, Arabic, CJK and more.
  // A single long CJK caption without spaces is still meaningful public evidence.
  const meaningful=new Set(remaining.split(/\s+/).filter(token=>Array.from(token).length>=3))
  const nonLatinLetters=[...remaining.matchAll(/[^\x00-\x7F]/g)].length>=4
    &&[...remaining.matchAll(/\p{L}/gu)].length>=4
  // Very short real captions can follow a signup banner without a label or
  // engagement count (for example "brandname Coming soon"). Only lower this
  // threshold for the Instagram-specific gate after removing stock signup copy.
  const minimumWords=instagramSignupGate?3:4
  return meaningful.size<minimumWords&&!nonLatinLetters
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
