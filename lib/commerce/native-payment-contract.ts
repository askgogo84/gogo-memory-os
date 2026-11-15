import {PurchaseBoundaryError} from './purchase-contract'

export type NativePaymentChoice = {
  mode:'upi_intent'|'upi_qr'|'cash_on_delivery'|'swiggy_money'
  methodId:string
  label:string
}
/**
 * Normalize only choices explicitly supplied by the authorized merchant's
 * get_payment_options result. No guessed card, VPA or wallet instructions.
 * This module prepares a read-only choice list. It NEVER pays or checks out.
 */
export function verifiedInstamartPaymentChoices(data:any): {
  choices:NativePaymentChoice[];agenticEligible:boolean
} {
  const problem=()=>{throw new PurchaseBoundaryError('payment_options_unverified')}
  if (!data || data.placeOrderToolName!=='checkout' ||
      !Array.isArray(data.allMethods) || data.allMethods.length>40) return problem()
  const legal=(s:any)=>typeof s==='string' && s.length>0 && s.length<=200 && !/[\r\n\u0000-\u001f]/.test(s)
  const methods=new Map<string,any>()
  for(const x of data.allMethods){
    if(!x || !legal(x.id) || !legal(x.displayName || x.id) ||
      (x.kind!==undefined && !['intent','qr'].includes(x.kind)) ||
      (x.enabled!==undefined && typeof x.enabled!=='boolean') ||
      methods.has(x.id)) return problem()
    methods.set(x.id,x)
  }
  const choices:NativePaymentChoice[]=[]
  const add=(item:any, mode:NativePaymentChoice['mode'])=>{
    if(!item || !legal(item.id) || !methods.has(item.id)) return
    const listed=methods.get(item.id)
    if(listed.enabled===false || item.enabled===false) return
    const label=legal(item.displayName)?item.displayName:
      legal(listed.displayName)?listed.displayName:item.id
    if(!choices.some(choice=>choice.methodId===item.id))
      choices.push({mode,methodId:item.id,label})
  }
  if(data.cod?.available===true) add(data.cod,'cash_on_delivery')
  if(data.swiggyMoney?.available===true) add(data.swiggyMoney,'swiggy_money')
  const mobile=data.platforms?.mobile?.methods
  if(mobile!==undefined && (!Array.isArray(mobile)||mobile.length>40)) return problem()
  for(const item of mobile||[]) if(item?.kind==='intent') add(item,'upi_intent')
  const desktop=data.platforms?.desktop?.methods
  if(desktop!==undefined && (!Array.isArray(desktop)||desktop.length>40)) return problem()
  for(const item of desktop||[]) if(item?.kind==='qr') add(item,'upi_qr')
  if(!choices.length) return problem()
  return {choices,agenticEligible:data.agenticPaymentEligible===true}
}
