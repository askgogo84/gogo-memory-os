type Quote={karat:string;perGram:number;amount:number;grams:number;source:string;date:string|null;reportedToday:boolean;locationKnown:boolean}
type Unit={grams:number;explicit:boolean}
type Label={index:number;length:number;karat:string|null}
// Every purity marker bounds the previous purity's span, even when it is written
// as a hyphenated/plural karat, a hallmark fineness, a spelled-out number or an
// unknown-purity phrase. Otherwise the next row bleeds into the previous purity.
const KARAT=/\b(18|22|24)\s*[-–]?\s*(?:kts?|karats?|carats?|ct|k)\b/gi
const SPELLED=/\b(twenty[\s-]?four|twenty[\s-]?two|eighteen)[\s-]*(?:kts?|karats?|carats?|k)\b/gi
const FINENESS=/(?<![\d,.₹])(?<!(?:₹|\brs\.?|\binr)\s{0,3})\b(999|916|750)\b(?=\s*(?:fine\b|purity\b|gold\b|hallmark|\())/gi
const FINENESS_TEXT=/^(?:999|916|750)$/
const UNKNOWN_PURITY=/\b(?:pure|fine)\s+gold\b|\b995\b(?=\s*(?:fine\b|purity\b|gold\b))/gi
const PURITY_ORDER:Record<string,number>={'18':1,'22':2,'24':3}

function purityLabels(text:string):Label[]{
  const found:Label[]=[]
  for(const m of text.matchAll(KARAT))found.push({index:m.index!,length:m[0].length,karat:m[1]})
  for(const m of text.matchAll(SPELLED))found.push({index:m.index!,length:m[0].length,karat:/four/i.test(m[1])?'24':/two/i.test(m[1])?'22':'18'})
  for(const m of text.matchAll(FINENESS))found.push({index:m.index!,length:m[0].length,karat:m[1]==='999'?'24':m[1]==='916'?'22':'18'})
  const known=[...found]
  for(const m of text.matchAll(UNKNOWN_PURITY)){
    // "24K pure gold" / "999 fine gold" qualify the known label; they are not a new purity.
    if(known.some(k=>k.index<=m.index!&&m.index!-(k.index+k.length)<=12))continue
    found.push({index:m.index!,length:m[0].length,karat:null})
  }
  found.sort((a,b)=>a.index-b.index||b.length-a.length)
  const distinct=found.filter((label,i)=>!found.slice(0,i).some(prior=>label.index<prior.index+prior.length))
  const kept:Label[]=[]
  for(const label of distinct){
    // Words before the first purity ("Pure gold price today…") are heading text.
    if(label.karat===null&&!kept.some(k=>k.karat!==null))continue
    // A hallmark fineness that restates the preceding karat ("22K … (916 purity)",
    // "24K 999 gold") qualifies that quote; only a different purity is a new label.
    const previous=kept.at(-1)
    if(previous?.karat&&label.karat===previous.karat&&FINENESS_TEXT.test(text.slice(label.index,label.index+label.length)))continue
    kept.push(label)
  }
  return kept
}
const MONEY=/(?:₹|\brs\.?|\binr)\s*(\d(?:[\d,]*\d)?(?:\.\d+)?)(?!\d|,[\d,]|\.\d)/gi
const MONTH_NAME='Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?'

function quoteClauses(text:string):string[]{
  // Date punctuation and Indian/international amount grouping are not clause
  // boundaries. Other commas separate quote qualifiers just like semicolons.
  const dateComma=new RegExp(`(\\b(?:\\d{1,2}\\s+(?:${MONTH_NAME})|(?:${MONTH_NAME})\\s+\\d{1,2})),\\s*(20\\d{2})\\b`,'gi')
  return text.replace(dateComma,'$1 $2').split(/;|\band\b|(?<!\d),|,(?!\d)/i)
}

function amount(text:string):number|null{
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(text))return null
  const value=Number(text.replaceAll(',',''))
  return Number.isFinite(value)&&value>0?value:null
}

function units(text:string):Unit[]{
  const found:Unit[]=[]
  const pattern=/(?:\bper\s*|\/\s*)(?:(\d+(?:\.\d+)?)\s*)?(kg|grams?|gms?|g)\b|\b(\d+(?:\.\d+)?)\s*(kg|grams?|gms?|g)\b/gi
  for(const match of text.matchAll(pattern)){
    const weight=Number(match[1]||match[3]||1),name=match[2]||match[4]
    const grams=weight*(name.toLowerCase()==='kg'?1000:1)
    if(Number.isFinite(grams)&&grams>0)found.push({grams,explicit:Boolean(match[2])})
  }
  return found
}

function sourceDate(text:string):string|null|undefined{
  const months=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
  const monthName=MONTH_NAME
  const formats:Array<{pattern:RegExp;parts:(match:RegExpMatchArray)=>number[]}>= [
    {pattern:/\b(20\d{2})-(\d{2})-(\d{2})\b/g,parts:m=>[Number(m[1]),Number(m[2]),Number(m[3])]},
    {pattern:/\b(\d{1,2})-(\d{2})-(20\d{2})\b/g,parts:m=>[Number(m[3]),Number(m[2]),Number(m[1])]},
    {pattern:new RegExp(`\\b(\\d{1,2})\\s+(${monthName}),?\\s+(20\\d{2})\\b`,'gi'),parts:m=>[Number(m[3]),months.indexOf(m[2].slice(0,3).toLowerCase())+1,Number(m[1])]},
    {pattern:new RegExp(`\\b(${monthName})\\s+(\\d{1,2}),?\\s+(20\\d{2})\\b`,'gi'),parts:m=>[Number(m[3]),months.indexOf(m[1].slice(0,3).toLowerCase())+1,Number(m[2])]},
  ]
  const dates=new Set<string>()
  for(const {pattern,parts}of formats)for(const match of text.matchAll(pattern)){
    const [year,month,day]=parts(match),date=new Date(Date.UTC(year,month-1,day))
    if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return null
    dates.add(date.toISOString().slice(0,10))
  }
  if(dates.size>1)return null
  return dates.size?[...dates][0]:/\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/.test(text)?null:undefined
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
  const dateParts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(now))
  const today=['year','month','day'].map(kind=>dateParts.find(part=>part.type===kind)?.value||'').join('-')
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
    const labels=purityLabels(current)
    const heading=current.slice(0,labels[0]?.index??current.length)
    const headingDate=sourceDate(heading),headingToday=/\btoday\b/i.test(heading)
    for(let i=0;i<labels.length;i++){
      const label=labels[i],start=label.index+label.length,end=labels[i+1]?.index??current.length
      const span=current.slice(start,end)
      const previousEnd=i?labels[i-1].index+labels[i-1].length:0
      const preceding=current.slice(previousEnd,label.index),precedingMoney=[...preceding.matchAll(MONEY)].at(-1)
      const precedingTail=precedingMoney?preceding.slice(precedingMoney.index!+precedingMoney[0].length):''
      const reverse=Boolean(precedingMoney&&precedingTail.length<=90&&/(?:\bfor|\bof|\()\s*$/i.test(precedingTail))
      const spanMonies=[...span.matchAll(MONEY)],nextMoney=spanMonies[0]
      // A reverse quote can have its date after the purity. Stop before the next
      // amount or coordinated clause so that quote's qualifiers cannot leak back.
      const suffix=quoteClauses(span.slice(0,nextMoney?.index??span.length))[0]
      const prefixClauses=quoteClauses(preceding),reversePrefix=prefixClauses.at(-1)||''
      const firstAmountEnd=nextMoney?nextMoney.index!+nextMoney[0].length:0
      if(label.karat===null)continue
      const karat=label.karat
      const table=/\b\d+(?:\.\d+)?\s*(?:kg|grams?|gms?|g)\s*\|/i.test(span)
      const forwardText=spanMonies.length>1&&!table?span.slice(0,firstAmountEnd)+quoteClauses(span.slice(firstAmountEnd,spanMonies[1].index))[0]:span
      const quoteText=reverse?reversePrefix+' '+suffix:forwardText
      if(/\b(?:unavailable|not (?:available|stated|supplied)|not verified)\b/i.test(quoteText))continue
      const suffixDate=reverse?sourceDate(suffix):undefined
      const ownDate=suffixDate===undefined?sourceDate(reverse?reversePrefix:quoteText):suffixDate,date=ownDate===undefined?headingDate:ownDate
      const reportedToday=date!==null&&(/\btoday\b/i.test(quoteText)||headingToday)
      if(date===null)warnings.add('A quote date is invalid and unverified.')
      if(date&&date>today){warnings.add('A source reports a future date; it is not a current verified quote.');continue}
      const add=(raw:string,grams:number)=>{
        const value=amount(raw)
        if(value===null||!Number.isFinite(grams)||grams<=0)return
        const perGram=Math.round(value/grams*100)/100
        if(!Number.isFinite(perGram)||perGram<=0)return
        quotes.push({karat,perGram,amount:value,grams,source,date:date||null,reportedToday,locationKnown:placeIsKnown(block,requested)})
      }
      const addInline=(text:string,money:RegExpMatchArray,allowBefore=true)=>{
        const before=allowBefore?units(text.slice(0,money.index)):[],after=units(text.slice(money.index!+money[0].length,money.index!+money[0].length+45))
        const local=before.at(-1)||after[0]
        // Only a common heading or an explicitly coordinated price predicate
        // shares a unit. A neighbouring purity alone establishes no weight.
        const sharedHeading=[...heading.matchAll(MONEY)].length?undefined:units(heading).filter(unit=>unit.explicit).at(-1)
        const coordinated=precedingMoney&&/^\s*and(?:\s+the)?\s*$/i.test(precedingTail)?units(preceding.slice(0,precedingMoney.index)).filter(unit=>unit.explicit).at(-1):undefined
        const inherited=sharedHeading||coordinated
        const unit=local||inherited
        if(!unit){warnings.add('A candidate quote was omitted because its weight/unit is unverified.');return}
        if(before.length&&after.length&&before.at(-1)!.grams!==after[0].grams){warnings.add('A quote has conflicting weight units.');return}
        add(money[1],unit.grams)
      }
      if(reverse){
        if(/\byesterday\b/i.test(quoteText)){warnings.add('A historical inline day label is unverified.');continue}
        const localMoney=[...quoteText.matchAll(MONEY)].at(-1)
        // A unit before a reverse amount needs an isolated clause. When there
        // is an earlier amount or no boundary after the previous purity, only
        // this amount's suffix can establish its unit.
        const isolatedPrefix=[...reversePrefix.matchAll(MONEY)].length===1&&(i===0||prefixClauses.length>1)
        if(localMoney)addInline(quoteText,localMoney,isolatedPrefix)
        continue
      }
      const rows=[...span.matchAll(/\b(\d+(?:\.\d+)?)\s*(kg|grams?|gms?|g)\s*\|/gi)]
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
      const allMonies=spanMonies
      let monies=allMonies
      // Currency immediately before the next purity belongs to its reverse
      // quote, not to this forward quote's daily columns.
      const last=monies.at(-1)
      if(labels[i+1]&&last&&/(?:\bfor|\bof|\()\s*$/i.test(span.slice(last.index!+last[0].length)))monies=monies.slice(0,-1)
      if(monies.length>1||/\byesterday\b/i.test(span.slice(0,monies[0]?.index??span.length))){warnings.add('An inline quote has an unverified day or ambiguous multiple amounts.');continue}
      const money=monies[0]
      if(!money)continue
      const afterMoney=span.slice(money.index!+money[0].length,allMonies[1]?.index??span.length)
      if(/(?:\bfor|\bof|\()\s*$/i.test(afterMoney))continue
      addInline(span.slice(0,money.index!+money[0].length)+quoteClauses(afterMoney)[0],money)
    }
  }
  // Within one source and date, a lower purity can never cost at least as much
  // as a higher purity per gram. Such a pair is a misattribution, not a quote.
  const contradicted=new Set<Quote>()
  for(const low of quotes)for(const high of quotes){
    if(low.source!==high.source||low.date!==high.date||PURITY_ORDER[low.karat]>=PURITY_ORDER[high.karat])continue
    if(low.perGram>=high.perGram){contradicted.add(low);contradicted.add(high)}
  }
  if(contradicted.size){
    warnings.add('A source listed a lower gold purity at or above a higher purity, so those quotes were not used.')
    for(let i=quotes.length-1;i>=0;i--)if(contradicted.has(quotes[i]))quotes.splice(i,1)
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
