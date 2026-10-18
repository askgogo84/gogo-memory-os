/** Normalize identity for matching only; never rewrite the observed quotation. */
export function productIdentityText(value:string,subject=false):string{
  const text=subject?String(value||'').replace(/(?:[,;]\s*|\s+)(?:quantity|qty)\s*[:=]?\s*\d+\s*[,.;]?\s*$/i,''):String(value||'')
  return text.replace(/(\d+(?:\.\d+)?)\s*kg\b/gi,(_,n)=>`${Number(n)*1000}g`)
    .replace(/(\d+(?:\.\d+)?)\s*l(?:itres?|iters?)?\b/gi,(_,n)=>`${Number(n)*1000}ml`)
    .replace(/(\d+)\s*(g|ml|gb|tb)\b/gi,'$1$2').trim()
}

export function productIdentityMatches(subject:string,evidence:string):boolean{
  const requested=productIdentityText(subject,true),observed=productIdentityText(evidence)
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
