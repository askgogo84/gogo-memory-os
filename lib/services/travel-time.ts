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

const MONTHS=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec']
/**
 * Boarding passes print "12 Oct" with no year. Without one the leg can't be dated, so no alert,
 * tracking or brief entry exists. Choose the year that puts the date nearest `now`, allowing it
 * to be up to 60 days in the past (a pass forwarded after the trip) and otherwise the next
 * occurrence. A date that already carries a year is returned unchanged.
 */
export function withTicketYear(date:string|undefined,now:number,notBefore?:string):string|undefined{
  if(!date)return date
  const text=date.trim().replace(/,/g,' ').replace(/\s+/g,' ')
  const m=text.match(/^(\d{1,2})\s*([A-Za-z]{3,})$/)||text.match(/^([A-Za-z]{3,})\s*(\d{1,2})$/)
  if(!m)return date
  const [day,monthName]=/^\d/.test(m[1])?[Number(m[1]),m[2]]:[Number(m[2]),m[1]]
  const month=MONTHS.indexOf(monthName.slice(0,3).toLowerCase())
  if(month<0||day<1||day>31)return date
  const floor=notBefore?Date.parse(`${notBefore} 00:00 UTC`)-86400_000:now-60*86400_000
  const thisYear=new Date(now).getUTCFullYear()
  for(const year of [thisYear-1,thisYear,thisYear+1,thisYear+2]){
    const at=Date.UTC(year,month,day)
    if(new Date(at).getUTCDate()!==day)continue
    if(at>=floor)return `${day} ${MONTHS[month][0].toUpperCase()}${MONTHS[month].slice(1)} ${year}`
  }
  return date
}

/** Fills missing years on every date a ticket carries; arrival dates follow their departure. */
export function withTicketYears<T>(info:T,now:number):T{
  const t:any=info
  if(!t||typeof t!=='object')return info
  if(t.type==='flight'&&Array.isArray(t.flights)){
    return {...t,flights:t.flights.map((f:any)=>{
      const date=withTicketYear(f.date,now)
      return {...f,date,...(f.arrivalDate?{arrivalDate:withTicketYear(f.arrivalDate,now,date)}:{})}
    })}
  }
  if(t.type==='train'||t.type==='event')return {...t,date:withTicketYear(t.date,now)}
  return info
}
