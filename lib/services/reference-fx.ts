// Public blended daily reference data, never authority for exchanging or paying money.
// API/terms: https://frankfurter.dev/ (v2; commercial blended rates permitted).
const CURRENCIES=new Set(['USD','INR','EUR','GBP','JPY','AUD','CAD','SGD','AED','CHF','NZD','HKD','CNY','THB'])
const MAX_ENTRIES=25,MAX_BYTES=64_000,CACHE_MS=15*60_000
type Rate={date:string;base:string;quote:string;rate:number;oldest:string;newest:string}
type Result={title:string;snippet:string;url:string;publishedDate:string}
const cache=new Map<string,{expires:number;value:Rate}>(),pending=new Map<string,Promise<Rate|null>>()

const FX_DETAIL='(?:the\\s+)?(?:sources?|(?:observation|as[\\s-]of|reference)\\s+dates?|dates?)'
const BENIGN_TAIL=new RegExp(`\\s*,?\\s+(?:and|with)\\s+(?:(?:give|show|include|cite|tell)\\s+(?:me\\s+)?)?${FX_DETAIL}(?:\\s*(?:,|and)\\s*${FX_DETAIL})*\\s*[.?]?$`,'i')
/** Sync check: is this exactly a supported currency conversion ask (so routing can hand it to the reference route)? */
export function isReferenceFxRequest(raw:string):boolean{return request(raw)!==null}
function request(raw:string){
  // Never accept a truncated prefix, extra clauses, payment instructions or implied currencies.
  if(typeof raw!=='string'||raw.length>160)return null
  // 22 Oct launch run (R33): "Convert 100 USD to INR and give the source and observation date." asks only for
  // what this reply always carries (source and dates), so that one trailing clause is dropped. Anything else extra
  // (fees, transfers, payments, other currencies) still fails the exact match below.
  const text=raw.replace(/\s+/g,' ').trim().replace(BENIGN_TAIL,'')
  const match=text.match(/^(?:(?:convert|exchange rate)\s+)?(?:((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,4})?)\s+)?([a-z]{3})\s+(?:to|in)\s+([a-z]{3})[?.]?$/i)
  if(!match)return null
  const amount=match[1]?Number(match[1].replace(/,/g,'')):1,base=match[2].toUpperCase(),quote=match[3].toUpperCase()
  return CURRENCIES.has(base)&&CURRENCIES.has(quote)&&base!==quote&&Number.isFinite(amount)&&amount>0&&amount<=1_000_000_000?{amount,base,quote}:null
}
function validDate(value:unknown):value is string{
  if(typeof value!=='string'||!/^20\d{2}-\d{2}-\d{2}$/.test(value))return false
  const at=Date.parse(value+'T00:00:00Z')
  return Number.isFinite(at)&&new Date(at).toISOString().slice(0,10)===value
}
function recent(date:string){const today=Date.parse(new Date().toISOString().slice(0,10)+'T00:00:00Z'),at=Date.parse(date+'T00:00:00Z');return at<=today&&today-at<=7*86400_000}
function validNumber(value:unknown):value is number{return typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=1e12}
function parse(data:unknown,base:string,quote:string):Rate|null{
  if(!Array.isArray(data)||data.length!==1)return null
  const r=data[0]
  if(!r||r.base!==base||r.quote!==quote||!validDate(r.date)||!recent(r.date)||!validNumber(r.rate)||!Array.isArray(r.providers)||!r.providers.length||r.providers.length>150)return null
  const dates:string[]=[]
  for(const p of r.providers){
    if(!p||typeof p.key!=='string'||!/^\w{1,16}$/.test(p.key)||!validDate(p.date)||p.date>r.date||!validNumber(p.rate)||p.excluded!==undefined&&typeof p.excluded!=='boolean')return null
    if(p.excluded!==true)dates.push(p.date)
  }
  if(!dates.length)return null
  dates.sort()
  return{date:r.date,base,quote,rate:r.rate,oldest:dates[0],newest:dates[dates.length-1]}
}
function source(base:string,quote:string){return`https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${quote}&expand=providers`}
async function load(base:string,quote:string):Promise<Rate|null>{
  try{
    const response=await fetch(source(base,quote),{headers:{accept:'application/json'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(3500)})
    if(!response.ok||!/^application\/json\b/i.test(response.headers.get('content-type')||'')||!response.body){await response.body?.cancel();return null}
    const reader=response.body.getReader(),decoder=new TextDecoder();let bytes=0,text=''
    for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){await reader.cancel();return null}text+=decoder.decode(value,{stream:true})}
    text+=decoder.decode()
    return parse(JSON.parse(text),base,quote)
  }catch{return null}
}
// 24 Oct live: "Convert 250 USD to INR" failed because the v2 response no longer passed the strict parser.
// Fallback: Frankfurter's stable v1 endpoint (ECB reference rates), same no-guess rules.
export function parseV1(data:any,base:string,quote:string):Rate|null{
  if(!data||data.base!==base||!validDate(data.date)||!recent(data.date))return null
  const r=data.rates?.[quote]
  return validNumber(r)?{date:data.date,base,quote,rate:r,oldest:data.date,newest:data.date}:null
}
async function loadV1(base:string,quote:string):Promise<Rate|null>{
  try{
    const response=await fetch(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`,{headers:{accept:'application/json'},cache:'no-store',signal:AbortSignal.timeout(3500)})
    if(!response.ok)return null
    const text=await response.text()
    if(text.length>MAX_BYTES)return null
    return parseV1(JSON.parse(text),base,quote)
  }catch{return null}
}
async function rate(base:string,quote:string){
  const key=base+'/'+quote,saved=cache.get(key)
  if(saved&&saved.expires>Date.now()&&recent(saved.value.date))return saved.value
  cache.delete(key)
  const running=pending.get(key);if(running)return running
  if(pending.size>=MAX_ENTRIES)return null
  const promise=load(base,quote).then(async value=>value||await loadV1(base,quote)).then(value=>{
    if(value){if(cache.size>=MAX_ENTRIES)cache.delete(cache.keys().next().value!);cache.set(key,{expires:Date.now()+CACHE_MS,value})}
    return value
  }).finally(()=>pending.delete(key))
  pending.set(key,promise);return promise
}

// null: unsupported query; []: recognized query whose provider result is unverified.
// Only the former may continue to ordinary search. No stale/guessed-rate fallback.
export async function searchReferenceFx(raw:string):Promise<Result[]|null>{
  const q=request(raw);if(!q)return null
  const r=await rate(q.base,q.quote);if(!r){console.error('REFERENCE_FX_UNAVAILABLE');return[]}
  const converted=q.amount*r.rate
  if(!Number.isFinite(converted))return[]
  const fmt=(n:number,digits=4)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:digits}).format(n)
  return[{title:`${q.base}/${q.quote} dated reference estimate`,snippet:`${fmt(q.amount)} ${q.base} ≈ ${fmt(converted,2)} ${q.quote}. 1 ${q.base} = ${r.rate} ${q.quote}. Frankfurter blended daily reference dated ${r.date}; contributing observations ${r.oldest} through ${r.newest}. Approximate reference only, not an executable bank or payment quote; fees and spreads are excluded.`,url:source(q.base,q.quote),publishedDate:r.date}]
}
