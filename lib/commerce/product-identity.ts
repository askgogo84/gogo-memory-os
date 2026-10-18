/** Normalize identity for matching only; never rewrite the observed quotation. */
function packageIdentity(value:string,subject=false):{text:string;counts:number[]}{
  const text=subject?String(value||'').replace(/(?:[,;]\s*|\s+)(?:quantity|qty)\s*[:=]?\s*\d+\s*[,.;]?\s*$/i,''):String(value||'')
  const counts:number[]=[]
  const pack=(n:string)=>{counts.push(Number(n));return ' '}
  const normalized=text.replace(/(\d+(?:\.\d+)?)\s*kg\b/gi,(_,n)=>`${Number(n)*1000}g`)
    .replace(/(\d+(?:\.\d+)?)\s*l(?:itres?|iters?)?\b/gi,(_,n)=>`${Number(n)*1000}ml`)
    .replace(/(\d+)\s*(g|ml|gb|tb)\b/gi,'$1$2')
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
