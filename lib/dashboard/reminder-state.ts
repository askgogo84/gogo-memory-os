export function reminderStateLabel(row:{status?:string|null;delivery_state?:string|null;sent?:boolean|null}){
  if(row.status==='completed')return 'Done'
  if(row.delivery_state==='read')return 'Read'
  if(row.delivery_state==='delivered')return 'Delivered'
  if(row.delivery_state==='outcome_unknown')return 'Delivery unverified'
  if(row.delivery_state==='failed')return 'Delivery failed'
  if(row.delivery_state==='cancelled')return 'Cancelled'
  return row.sent?'Sent — delivery unconfirmed':'Scheduled'
}
