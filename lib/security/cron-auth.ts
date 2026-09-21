import { timingSafeEqual } from 'crypto'

function safeEqual(a:string,b:string){
  const left=Buffer.from(a)
  const right=Buffer.from(b)
  return left.length===right.length&&timingSafeEqual(left,right)
}

export function isCronAuthorized(request:Request, env:Record<string,string|undefined>=process.env){
  const expected=String(env.CRON_SECRET||'').trim()
  if(!expected){
    console.error('CRON_SECRET_MISSING')
    return false
  }
  const auth=(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  let query=''
  try{query=new URL(request.url).searchParams.get('secret')||''}catch{}
  return safeEqual(auth,expected)||safeEqual(query,expected)
}
