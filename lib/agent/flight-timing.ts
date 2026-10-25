// Flight departure and arrival as readable clock times ("10:20 am → 5:40 pm (+1)"), not raw ISO strings.
export function formatFlightTiming(departure?:string|null,arrival?:string|null){
  const parse=(v?:string|null)=>{const m=String(v||'').match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/);return m?{day:m[1],h:Number(m[2]),min:m[3]}:null}
  const clock=(t:{h:number;min:string})=>`${t.h%12||12}:${t.min} ${t.h<12?'am':'pm'}`
  const d=parse(departure),a=parse(arrival)
  if(!d||!a)return [departure,arrival].filter(Boolean).join(' → ')
  const days=Math.round((Date.parse(a.day)-Date.parse(d.day))/86400000)
  return `${clock(d)} → ${clock(a)}${days>0?` (+${days})`:''}`
}
