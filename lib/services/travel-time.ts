import { timezoneFromCity, isValidTimezone, zonedLocalTimeToUtc, getLocalParts } from '@/lib/timezone'

const airports:Record<string,string>={BLR:'Bengaluru',AUH:'Abu Dhabi',JFK:'New York',DEL:'Delhi',BOM:'Mumbai',DXB:'Dubai',LHR:'London',SIN:'Singapore'}
export function ticketTimezone(city?:string, explicit?:string):string|null {
  if(explicit&&isValidTimezone(explicit))return explicit
  const name=String(city||'').trim()
  return timezoneFromCity(airports[name.toUpperCase()]||name)
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
  const local=getLocalParts(result,timezone)
  return local.year===year&&local.month===month&&local.day===day&&local.hour===hour&&local.minute===minute?result:null
}

export function flightInstants(f:{from:string;to:string;date:string;departure:string;arrival?:string;arrivalDate?:string;departureTimezone?:string;arrivalTimezone?:string}){
  const departTz=ticketTimezone(f.from,f.departureTimezone)||''
  const arrivalTz=ticketTimezone(f.to,f.arrivalTimezone)||''
  const departAt=ticketInstant(f.date,f.departure,departTz)
  // An overnight/date-line itinerary cannot be dated from the clock alone.
  const candidate=ticketInstant(f.arrivalDate,f.arrival,arrivalTz)
  const arriveAt=departAt&&candidate&&candidate>departAt?candidate:null
  return {departAt,arriveAt,departTz,arrivalTz}
}
