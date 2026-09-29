import { timezoneFromCity, isValidTimezone, zonedLocalTimeToUtc, getLocalParts, getTimezoneOffsetMs } from '@/lib/timezone'

import airportData from '@/lib/data/airport-timezones.json'

// Pinned worldwide data; ambiguous duplicate city names are excluded at generation.
const airports=airportData as {iata:Record<string,string>;cities:Record<string,string>}
export function ticketTimezone(city?:string, explicit?:string):string|null {
  if(explicit&&isValidTimezone(explicit))return explicit
  const name=String(city||'').trim()
  const cityZone=airports.cities[name.toLowerCase()]||(name.toLowerCase()==='goa'&&name!=='GOA'?'Asia/Kolkata':null)
  const code=/^[A-Z]{3}$/.test(name)?airports.iata[name]:null
  const zone=code||cityZone||timezoneFromCity(name)
  return zone&&isValidTimezone(zone)?zone:null
}

/** Unknown zones and invalid/nonexistent local clocks must not silently become IST. */
export function ticketInstant(date?:string,time?:string,timezone='Asia/Kolkata'):Date|null {
  if(!date||!time||!isValidTimezone(timezone))return null
  const match=date.trim().match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/)
  const clock=time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if(!match||!clock)return null
  const month=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].indexOf(match[2].slice(0,3).toLowerCase())+1
  const year=Number(match[3]),day=Number(match[1]),hour=Number(clock[1]),minute=Number(clock[2])
  if(!month||day<1||day>31||hour>23||minute>59)return null
  const result=zonedLocalTimeToUtc({year,month,day,hour,minute,timezone})
  const matches=(instant:Date)=>{
    const local=getLocalParts(instant,timezone)
    return local.year===year&&local.month===month&&local.day===day&&local.hour===hour&&local.minute===minute
  }
  if(!matches(result))return null
  // A repeated local clock has two valid offsets. Never choose one silently.
  const wallClock=Date.UTC(year,month-1,day,hour,minute)
  for(const days of [-2,-1,1,2]){
    const offset=getTimezoneOffsetMs(new Date(result.getTime()+days*86400000),timezone)
    const alternative=new Date(wallClock-offset)
    if(alternative.getTime()!==result.getTime()&&matches(alternative))return null
  }
  return result
}

export function flightInstants(f:{from:string;to:string;date:string;departure:string;arrival?:string;arrivalDate?:string;departureTimezone?:string;arrivalTimezone?:string}){
  const departTz=ticketTimezone(f.from,f.departureTimezone)||''
  const arrivalTz=ticketTimezone(f.to,f.arrivalTimezone)||''
  const departAt=ticketInstant(f.date,f.departure,departTz)
  // An overnight/date-line itinerary cannot be dated from the clock alone.
  const arrivalDate=f.arrivalDate||(departTz&&departTz===arrivalTz?f.date:undefined)
  const candidate=ticketInstant(arrivalDate,f.arrival,arrivalTz)
  const arriveAt=departAt&&candidate&&candidate>departAt?candidate:null
  return {departAt,arriveAt,departTz,arrivalTz}
}
