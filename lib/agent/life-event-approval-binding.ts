import { createHash } from 'node:crypto'

function sha(value:string){
  return createHash('sha256').update(String(value||'')).digest('hex')
}

export function checkinApprovalFingerprintInput(params:{
  runId:string
  lifeEventId:string
  lifeEventActionId:string
  checkinUrl:string
  seatPolicy:string
  provider?:string|null
  title?:string|null
  confirmationRef?:string|null
}){
  let target='airline-checkin'
  try{
    const u=new URL(params.checkinUrl)
    target='airline-checkin:'+u.hostname+u.pathname
  }catch{}
  return {
    missionId:params.runId,
    stepId:String(params.lifeEventActionId),
    capability:'travel',
    actionType:'booking',
    target,
    payload:{
      action:'submit_web_checkin',
      lifeEventId:String(params.lifeEventId),
      provider:String(params.provider||''),
      title:String(params.title||''),
      seatPolicy:String(params.seatPolicy||''),
      checkin_url_sha256:sha(params.checkinUrl),
      confirmation_ref_sha256:sha(String(params.confirmationRef||'')),
    },
  }
}
