/** Normalize identity for matching only; never rewrite the observed quotation. */
function packageIdentity(value:string,subject=false):{text:string;counts:number[]}{
  const text=subject?String(value||'').replace(/(?:[,;]\s*|\s+)(?:quantity|qty)\s*[:=]?\s*\d+\s*[,.;]?\s*$/i,''):String(value||'')
  const counts:number[]=[]
  const pack=(n:string)=>{counts.push(Number(n));return ' '}
  const normalized=text.replace(/(\d+(?:\.\d+)?)\s*kg\b/gi,(_,n)=>`${Number(n)*1000}g`)
    .replace(/(\d+(?:\.\d+)?)\s*l(?:itres?|iters?)?\b/gi,(_,n)=>`${Number(n)*1000}ml`)
    .replace(/(\d+)\s*(g|ml|gb|tb)\b/gi,'$1$2')
    // "AirPods Pro (2nd Generation)" is "AirPods Pro 2" (23 Oct live: Croma's page failed the identity check).
    .replace(/\(?\b(\d)(?:st|nd|rd|th)\s*gen(?:eration)?\b[^)]*\)?/gi,' $1 ')
    .replace(/\b(\d+(?:\.\d+)?(?:g|ml))\s*[x×]\s*(\d+)\b/gi,(_,weight,n)=>weight+pack(n))
    .replace(/\b(\d+)\s*[x×]\s*(\d+(?:\.\d+)?(?:g|ml))\b/gi,(_,n,weight)=>weight+pack(n))
    .replace(/\b(?:pack|set|bundle)\s*(?:of\s*)?(\d+)\b/gi,(_,n)=>pack(n))
    .replace(/\b(\d+)\s*[- ]?\s*(?:packs?|pcs?|pieces?|units?)\b/gi,(_,n)=>pack(n))
  if(/\b(?:multi[- ]?pack|combo)\b/i.test(normalized))counts.push(NaN)
  return {text:normalized.trim(),counts}
}
export function productIdentityText(value:string,subject=false):string{
  return packageIdentity(value,subject).text
}

export function productIdentityMatches(subject:string,evidence:string):boolean{
  const requestedPackage=packageIdentity(subject,true),observedPackage=packageIdentity(evidence)
  const count=(counts:number[])=>counts.length?counts.every(n=>Number.isSafeInteger(n)&&n>0&&n===counts[0])?counts[0]:null:1
  const requestedCount=count(requestedPackage.counts),observedCount=count(observedPackage.counts)
  if(requestedCount===null||observedCount===null||requestedCount!==observedCount)return false
  const requested=requestedPackage.text,observed=observedPackage.text
  const variants=/\b(?:iphone|ipad|galaxy|pixel|macbook)\b/i.test(requested)?['pro','max','plus','mini','ultra','air','lite','fe','se']
    :/\b(?:butter|milk|cheese|yogurt|curd)\b/i.test(requested)?['lite','spread','unsalted','skimmed','double']:[]
  if(variants.some(tier=>new RegExp('\\b'+tier+'\\b','i').test(observed)&&!new RegExp('\\b'+tier+'\\b','i').test(requested)))return false
  if(/\b(?:iphone|ipad|galaxy|pixel|macbook)\b/i.test(requested)){
    const capacity=requested.match(/\b\d+(?:gb|tb)\b/i)?.[0]?.toLowerCase()
    const capacities=(observed.match(/\b\d+(?:gb|tb)\b/gi)||[]).map(v=>v.toLowerCase())
    if(capacity&&capacities.some(v=>v!==capacity))return false
    if(!capacity&&/\biphone\b/i.test(requested)&&capacities.some(v=>/^(?:256|512)gb$|^[12]tb$/i.test(v)))return false
  }
  const tokens=requested.match(/[a-z0-9]+/gi)||[]
  if(!tokens.length)return false
  let cursor=0
  for(const token of tokens){
    const re=new RegExp((/^\d/.test(token)?'(?<![a-z0-9])':'')+token+'(?![a-z0-9])','gi');re.lastIndex=cursor
    const hit=re.exec(observed);if(!hit)return false;cursor=hit.index+hit[0].length
  }
  return true
}

/** 13 Nov live: Zepto titles a product "Amul Salted Butter" and states the pack ("Net Qty: 500 g") just below.
 *  When the asked pack size is missing from the heading, the page text right after the heading may supply it —
 *  only if exactly ONE pack size appears there and it equals the asked one (a variant list never qualifies).
 *  Returns the observed pack text (as written on the page) or null. Never invents a size. */
export function packFromPage(subject:string,heading:string,pageText:string):string|null{
  // gm/gms/grams and ltr/litre are normalised first, so a heading that already says "100gm" is never overridden.
  const unit=(v:string)=>String(v||'').replace(/(\d)\s*(?:gms?|grams?)\b/gi,'$1 g').replace(/(\d)\s*(?:ltrs?|litres?|liters?)\b/gi,'$1 l')
  const sizes=(v:string)=>[...new Set((packageIdentity(unit(v)).text.match(/(?<![\d.])\d+(?:\.\d+)?(?:g|ml)\b/gi)||[]).map(s=>s.toLowerCase()))]
  const asked=sizes(productIdentityText(subject,true))
  if(asked.length!==1||sizes(heading).length)return null
  const text=String(pageText||'').replace(/\s+/g,' ')
  const at=text.indexOf(heading.replace(/\s+/g,' '))
  if(at<0)return null
  const near=text.slice(at+heading.length,at+heading.length+240)
  // Review (PR #1518): a multipack or combo ("2 x 500 g", "Pack of 2", "2 pcs", "Combo") anywhere here is not the asked
  // single pack; and the size must come BEFORE the first price, so a recommended tile's size is never borrowed.
  // Only this product's own block counts: everything up to where another tile starts ("Similar", "You may also like",
  // the heading again…), so a count printed after the MRP ("₹650 MRP ₹700 Pack of 2") is still seen. A count of 1 is fine.
  const tile=near.search(new RegExp('\\b(?:similar|you may also like|related|customers also|frequently bought|more from)\\b|'+heading.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'))
  const own=tile>=0?near.slice(0,tile):near
  if(packageIdentity(unit(own)).counts.some(n=>n!==1))return null
  const beforePrice=near.split(/₹|\bRs\.?\s*\d|\bINR\b/i)[0]
  const found=[...beforePrice.matchAll(/(?:(?:net\s*(?:qty|quantity|wt|weight)|pack\s*size|quantity|weight)\s*:?\s*)?(?<![\d.])\d+(?:\.\d+)?\s*(?:kg|g|gm|gms|grams?|l|ltrs?|litres?|liters?|ml)\b/gi)]
  const observed=[...new Set(found.map(m=>sizes(m[0])[0]).filter(Boolean))]
  if(observed.length!==1||observed[0]!==asked[0])return null
  return unit(found[0][0].trim())
}
