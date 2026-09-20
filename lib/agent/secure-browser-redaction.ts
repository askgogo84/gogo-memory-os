import { redactSecretShapedText } from '@/lib/bot/memory-redaction'

const HTTP_URL_RE = /https?:\/\/[^\s"'<>]+/gi
const LONG_OPAQUE_TOKEN_RE = /\b[A-Za-z0-9+/_=-]{80,}\b/g

function redactUrl(raw:string){
  try{
    const url=new URL(raw)
    if(url.username)url.username='[redacted]'
    if(url.password)url.password='[redacted]'
    for(const key of Array.from(url.searchParams.keys())){
      url.searchParams.set(key,'[redacted]')
    }
    if(url.hash)url.hash='#[redacted]'
    return url.toString()
  }catch{
    return '[sensitive url withheld]'
  }
}

/**
 * Secure Computer redaction boundary.
 *
 * Provider URLs can contain one-time signatures, booking/session tokens, auth
 * payloads and fragments whose parameter names are not predictable. Redact the
 * complete URL before generic secret redaction so later parameters cannot leak.
 */
export function redactBrowserSensitiveText(content:string):string{
  if(!content)return content
  let out=String(content).replace(HTTP_URL_RE,(raw)=>redactUrl(raw))
  out=redactSecretShapedText(out)
  out=out.replace(LONG_OPAQUE_TOKEN_RE,'[sensitive token withheld]')
  return out
}
