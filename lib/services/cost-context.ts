import { AsyncLocalStorage } from 'node:async_hooks'

export type CostContext = {
  telegramId:string
  surface?:'whatsapp'|'telegram'|'web'|'agent'|'system'
}

const storage = new AsyncLocalStorage<CostContext>()

/**
 * Attach the resolved user to the current async request chain. Provider services
 * can enforce per-user COGS without every feature handler having to thread an id.
 */
export function enterCostContext(telegramId:string|number,surface?:CostContext['surface']){
  const id=String(telegramId ?? '').trim()
  if(!id)return
  storage.enterWith({telegramId:id,surface})
}

export function currentCostContext(){
  return storage.getStore() || null
}

export async function withCostContext<T>(context:CostContext,fn:()=>Promise<T>):Promise<T>{
  return storage.run(context,fn)
}
