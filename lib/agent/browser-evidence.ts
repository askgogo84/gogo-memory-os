/** Pure, fail-closed boundary between page observations and completion. */
export function isLoginDestination(page:{url?:string;text?:string;title?:string}):boolean {
  try {
    const path=new URL(page.url||'').pathname
    return /^\/(?:accounts\/)?(?:login|signin|sign-in)(?:\/|$)/i.test(path)
  }catch{return false}
}

export function verifiedBrowserAnswer(value:unknown,pageText:string):string|null {
  if(!value||typeof value!=='object')return null
  const result=value as {complete?:unknown;answer?:unknown;evidence?:unknown}
  if(result.complete!==true||typeof result.answer!=='string'||!result.answer.trim())return null
  const normalize=(text:string)=>text.replace(/\s+/g,' ').trim().toLowerCase()
  const observed=normalize(pageText)
  if(observed.length<40||!Array.isArray(result.evidence)||!result.evidence.length)return null
  if(!result.evidence.every(quote=>typeof quote==='string'&&normalize(quote).length>=12&&observed.includes(normalize(quote))))return null
  return result.answer.trim().slice(0,1800)
}
