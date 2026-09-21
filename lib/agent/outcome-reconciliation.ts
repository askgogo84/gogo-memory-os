export type OutcomeReconciliation =
  | { state:'verified_completed'; evidence:Record<string,unknown> }
  | { state:'verified_absent'; evidence:Record<string,unknown> }
  | { state:'still_unknown'; evidence:Record<string,unknown>; reason:string }

export async function reconcileGoogleCalendarEvent(params:{
  accessToken:string
  eventId:string
  calendarId?:string
}):Promise<OutcomeReconciliation>{
  const calendarId=encodeURIComponent(params.calendarId||'primary')
  const eventId=encodeURIComponent(String(params.eventId||'').trim())
  if(!eventId)return {state:'still_unknown',evidence:{},reason:'missing_event_id'}
  try{
    const response=await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${calendarId}/events/${eventId}`,
      {headers:{Authorization:`Bearer ${params.accessToken}`},cache:'no-store'}
    )
    if(response.status===404){
      return {state:'verified_absent',evidence:{provider:'google_calendar',eventId:params.eventId,httpStatus:404}}
    }
    if(response.status===401||response.status===403){
      return {state:'still_unknown',evidence:{provider:'google_calendar',eventId:params.eventId,httpStatus:response.status},reason:'calendar_reconnect_required'}
    }
    if(!response.ok){
      return {state:'still_unknown',evidence:{provider:'google_calendar',eventId:params.eventId,httpStatus:response.status},reason:'calendar_reconcile_failed'}
    }
    const data:any=await response.json().catch(()=>({}))
    return {
      state:'verified_completed',
      evidence:{
        provider:'google_calendar',
        eventId:String(data?.id||params.eventId),
        htmlLink:String(data?.htmlLink||''),
        status:String(data?.status||'confirmed'),
      },
    }
  }catch(error:any){
    return {
      state:'still_unknown',
      evidence:{provider:'google_calendar',eventId:params.eventId},
      reason:String(error?.message||'calendar_reconcile_network_failed').slice(0,180),
    }
  }
}

export function shouldTreatMutationFailureAsUnknown(status:number|null|undefined){
  if(status==null)return true
  return status>=500 || status===408 || status===425 || status===429
}
