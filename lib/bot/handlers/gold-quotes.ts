type Quote={karat:string;perGram:number;amount:number;grams:number;source:string;date:string|null;reportedToday:boolean;locationKnown:boolean}
type Unit={grams:number;explicit:boolean}
const KARAT=/\b(18|22|24)\s*(?:kt|karat|carat|ct|k)\b/gi
const MONEY=/(?:₹|\brs\.?|\binr)\s*([\d,]+(?:\.\d+)?)(?![\d.])/gi

function amount(text:string):number|null{
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text))return null
  const value=Number(text.replaceAll(',',''))
  return Number.isFinite(value)&&value>0?value:null
}

function units(text:string):Unit[]{
  const found:Unit[]=[]
  const pattern=/(?:\bper\s*|\/\s*)(?:(\d+(?:\.\d+)?)\s*)?(kg|grams?|g)\b|\b(\d+(?:\.\d+)?)\s*(kg|grams?|g)\b/gi
  for(const match of text.matchAll(pattern)){
    const weight=Number(match[1]||match[3]||1),name=match[2]||match[4]
    const grams=weight*(name.toLowerCase()==='kg'?1000:1)
    if(Number.isFinite(grams)&&grams>0)found.push({grams,explicit:Boolean(match[2])})
  }
  return found
}

function sourceDate(text:string):string|null{
  const iso=text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/)
  const named=text.match(/\b(\d{1,2})\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i)
  const numeric=text.match(/\b(\d{1,2})-(\d{2})-(20\d{2})\b/)
  if(!iso&&!named&&!numeric)return null
  const months=['january','february','march','april','may','june','july','august','september','october','november','december']
  const year=Number(iso?.[1]||named?.[3]||numeric?.[3]),month=iso?Number(iso[2]):named?months.indexOf(named[2].toLowerCase())+1:Number(numeric![2]),day=Number(iso?.[3]||named?.[1]||numeric?.[1])
  const date=new Date(Date.UTC(year,month-1,day))
  return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day?date.toISOString().slice(0,10):null
}

function sourceUrl(block:string):string{
  const raw=block.match(/^Source:\s*(\S+)/im)?.[1]||''
  try{const url=new URL(raw);return /^https?:$/.test(url.protocol)&&!url.username&&!url.password?url.href:''}catch{return ''}
}

function placeIsKnown(text:string,place:string):boolean{
  if(place.toLowerCase()==='india')return /\bindia\b/i.test(text)
  if(/^(?:bangalore|bengaluru)$/i.test(place))return /\b(?:bangalore|bengaluru)\b/i.test(text)
  return text.toLowerCase().includes(place.toLowerCase())
}

/** Preserve quote provenance before presentation; search snippets may have no line breaks. */
export function formatGoldQuotes(userText:string,searchContext:string,now=Date.now()):string{
  const today=new Date(now).toISOString().slice(0,10)
  const requested=userText.match(/\bin\s+([a-z][a-z ]{2,30}?)\s*(?:today|now|\?|$)/i)?.[1]?.trim()||'India'
  const place=requested.replace(/\b\w/g,c=>c.toUpperCase())
  const quotes:Quote[]=[],sources=new Set<string>(),warnings=new Set<string>()
  for(const block of searchContext.split(/\n\s*\n/).filter(Boolean)){
    const source=sourceUrl(block)
    if(source)sources.add(source)
    else{warnings.add('A source URL could not be verified.');continue}
    // Search result titles advertise several purities; they are not quote rows.
    const lines=block.split('\n').filter(line=>!/^Source:/i.test(line))
    if(/^\d+\./.test(lines[0]||''))lines.shift()
    const body=lines.join(' ').replace(/\s+/g,' ').trim()
    const current=body.split(/\b(?:gold\s+rate\s+history|price\s+history|historical\s+(?:gold\s+)?(?:rates?|prices?)|popular\s+coins|related\s+products)\b/i)[0]
    if(/\bgold\s+coins?\b|\badd to cart\b/i.test(current)){warnings.add('Retail coin prices are not metal-rate quotes.');continue}
    const labels=[...current.matchAll(KARAT)]
    const heading=current.slice(0,labels[0]?.index??current.length)
    const headingDate=sourceDate(heading),headingToday=/\btoday\b/i.test(heading)
    for(let i=0;i<labels.length;i++){
      const label=labels[i],start=label.index!+label[0].length,end=labels[i+1]?.index??current.length
      const span=current.slice(start,end)
      if(/\b(?:unavailable|not (?:available|stated|supplied)|not verified)\b/i.test(span))continue
      const date=sourceDate(span)||headingDate,reportedToday=/\btoday\b/i.test(span)||headingToday
      if(date&&date>today){warnings.add('A source reports a future date; it is not a current verified quote.');continue}
      const add=(raw:string,grams:number)=>{
        const value=amount(raw)
        if(value===null||!Number.isFinite(grams)||grams<=0)return
        const perGram=Math.round(value/grams*100)/100
        if(!Number.isFinite(perGram)||perGram<=0)return
        quotes.push({karat:label[1],perGram,amount:value,grams,source,date,reportedToday,locationKnown:placeIsKnown(block,requested)})
      }
      const rows=[...span.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|grams?|g)\s*\|/gi)]
      if(rows.length){
        const header=(heading+' '+span.slice(0,rows[0].index)).toLowerCase(),todayColumn=header.lastIndexOf('today'),yesterdayColumn=header.lastIndexOf('yesterday')
        for(let r=0;r<rows.length;r++){
          const row=rows[r],values=[...span.slice(row.index!+row[0].length,rows[r+1]?.index??span.length).matchAll(MONEY)]
          const index=values.length>1?(todayColumn>=0&&yesterdayColumn>=0?(yesterdayColumn<todayColumn?1:0):-1):0
          if(index<0){warnings.add('A multi-column rate row has an unverified date column.');continue}
          const value=values[index]
          if(value)add(value[1],Number(row[1])*(row[2].toLowerCase()==='kg'?1000:1))
        }
        continue
      }
      const money=[...span.matchAll(MONEY)][0]
      if(!money)continue
      const before=units(span.slice(0,money.index)),after=units(span.slice(money.index!+money[0].length,money.index!+money[0].length+45))
      const local=before.at(-1)||after[0]
      const inherited=units(current.slice(Math.max(0,label.index!-200),label.index)).filter(unit=>unit.explicit).at(-1)
      const unit=local||inherited
      if(!unit){warnings.add('A quote has no verified weight/unit, so a per-gram rate cannot be stated.');continue}
      if(before.length&&after.length&&before.at(-1)!.grams!==after[0].grams){warnings.add('A quote has conflicting weight units.');continue}
      add(money[1],unit.grams)
    }
  }
  const lines:string[]=[],details:string[]=[]
  const rupees=(value:number)=>value.toLocaleString('en-IN',{maximumFractionDigits:2})
  for(const karat of ['24','22','18']){
    const candidates=quotes.filter(q=>q.karat===karat)
    const current=candidates.filter(q=>q.date===today)
    const selected=current.length?current:candidates
    if(!selected.length)continue
    const values=[...new Set(selected.map(q=>q.perGram))].sort((a,b)=>a-b)
    lines.push(`${karat}K: ₹${values.map(rupees).join('–₹')}${values.length>1?' (sources differ)':''}`)
    for(const quote of selected){
      const timing=quote.date?`as of ${quote.date}`:quote.reportedToday?'source says today; date not independently verified':'source date unverified'
      details.push(`${karat}K — ${timing}; ${quote.grams} g quote ₹${rupees(quote.amount)}; ${quote.source}`)
      if(!quote.locationKnown)warnings.add(`The source does not verify applicability to ${place}.`)
    }
  }
  if(!lines.length)return `I couldn't verify a source-bound per-gram gold quote for ${place}. ${[...warnings].join(' ')}${sources.size?`\nSources:\n${[...sources].join('\n')}`:''}`
  return `*Gold rate quotes for ${place}:*\n${lines.join('\n')}\nPer gram in INR; converted from the stated weights.\n\n${[...new Set(details)].join('\n')}${warnings.size?`\n\n${[...warnings].join(' ')}`:''}`
}
