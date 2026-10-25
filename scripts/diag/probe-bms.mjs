// Investigation only: resolve the BMS short link, inspect Cloudflare posture and
// legitimate structured data. Read-only GETs with a normal UA. NO bypass.
const START = process.argv[2] || 'https://bmsurl.co/BMSTNY/5Mjc6DKmzL'
const UA = 'Mozilla/5.0 AskGogo/1.0'
function pick(h, keys){ const o={}; for(const k of keys){ const v=h.get(k); if(v) o[k]=v } return o }
let url = START
for (let i=0;i<6;i++){
  const ctrl=new AbortController(); const t=setTimeout(()=>ctrl.abort(),12000)
  let res
  try { res = await fetch(url,{redirect:'manual',signal:ctrl.signal,headers:{'User-Agent':UA,Accept:'text/html,application/xhtml+xml'}}) }
  catch(e){ console.log(`STEP ${i} ${url} -> FETCH_ERROR ${e.message}`); break }
  finally { clearTimeout(t) }
  const status=res.status
  const hdr=pick(res.headers,['server','cf-mitigated','cf-ray','location','content-type','set-cookie'])
  console.log(`\nSTEP ${i}: ${url}`)
  console.log(`  status=${status}`)
  console.log(`  headers=${JSON.stringify(hdr)}`)
  if([301,302,303,307,308].includes(status)){ const loc=res.headers.get('location'); if(!loc){console.log('  (redirect w/o location)');break} url=new URL(loc,url).toString(); continue }
  // terminal response — inspect body for challenge markers + structured data
  const body=(await res.text())
  const lower=body.toLowerCase()
  const cf = {
    attentionRequired: /attention required/i.test(body),
    cloudflareWord: /cloudflare/i.test(body),
    checkingBrowser: /checking your browser before accessing/i.test(body),
    cfChl: /__cf_chl|cf-browser-verification|challenges\.cloudflare\.com|cf_chl_opt/i.test(body),
    blockedMsg: /sorry, you have been blocked/i.test(body),
    rayId: /ray id/i.test(body),
    enableCookies: /please enable cookies/i.test(body),
  }
  const og = Array.from(body.matchAll(/<meta[^>]+(?:property|name)=["'](og:[^"']+|twitter:[^"']+)["'][^>]*content=["']([^"']*)["']/gi)).map(m=>[m[1],m[2].slice(0,160)])
  const ld = Array.from(body.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)).map(m=>m[1].trim().slice(0,400))
  const title=(body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]||'').trim()
  console.log(`  bodyBytes=${body.length}`)
  console.log(`  <title>=${JSON.stringify(title.slice(0,160))}`)
  console.log(`  cloudflareSignals=${JSON.stringify(cf)}`)
  console.log(`  ogTags(${og.length})=${JSON.stringify(og.slice(0,8))}`)
  console.log(`  jsonLd(${ld.length}) first=${JSON.stringify(ld[0]||'')}`)
  break
}
