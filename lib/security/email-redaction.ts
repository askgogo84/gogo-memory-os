import {redactSecretShapedText} from '@/lib/bot/memory-redaction'

export function decodeHtmlEntities(value:string) {
  return String(value || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#(?:39|x27);/gi, "'")
    .replace(/&#(\d+);/g, (_m, n) => {
      const cp = Number(n)
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ''
    })
}

function clean(value: unknown, max = 1200) {
  return redactSecretShapedText(decodeHtmlEntities(String(value ?? '')).replace(/\s+/g, ' ').trim().slice(0, max))
}

// Gmail is an account-recovery channel for other services. Filter auth
// material before a snippet can reach WhatsApp, LLM context, Activity or memory.
export function redactEmailAuthSecrets(value:string) {
  let out=String(value||'')

  out=out.replace(
    /\b((?:one[ -]?time\s+(?:password|code)|otp|verification\s+code|security\s+code|login\s+code|sign[ -]?in\s+code|passcode)(?:\s*(?:is|:|=)\s*|\s+))([A-Z0-9-]{4,12})\b/gi,
    (_m,label)=>`${label}[authentication detail withheld]`
  )

  out=out.replace(
    /\b((?:use|enter|type)\s+(?:this\s+)?code(?:\s+(?:to|for)\s+[^\s,.!?]+)?(?:\s*(?:is|:|=)\s*|\s+))([A-Z0-9-]{4,12})\b/gi,
    (_m,label)=>`${label}[authentication detail withheld]`
  )

  out=out.replace(/https?:\/\/[^\s<>"']+/gi,(url)=>{
    const lower=url.toLowerCase()
    const sensitivePath=/\/(?:reset(?:-password)?|password-reset|forgot(?:-password)?|magic(?:-link)?|verify(?:-email)?|verification|account-recovery|recover-account)(?:[/?#]|$)/i.test(lower)
    const sensitiveParam=/[?&](?:token|reset_token|reset-token|code|otp|magic|key|secret|auth|verification_token|verification-token)=/i.test(lower)
    return sensitivePath||sensitiveParam?'[authentication link withheld]':url
  })

  return out
}

export function formatEmailSnippet(value:unknown,max=260) {
  const decoded=decodeHtmlEntities(String(value??'')).replace(/(?:[\u200B-\u200F\uFEFF]\s*){3,}/g,' ')
  const text=clean(redactEmailAuthSecrets(decoded), Math.max(max * 2, max))
  if(text.length<=max)return text
  const slice=text.slice(0,max+1)
  const sentence=[...slice.matchAll(/[.!?](?=\s|$)/g)].pop()
  if(sentence && sentence.index >= Math.floor(max*0.55))return slice.slice(0,sentence.index+1).trim()
  const cut=slice.lastIndexOf(' ')
  return (cut>Math.floor(max*0.7)?slice.slice(0,cut):slice.slice(0,max)).trim()+'…'
}

