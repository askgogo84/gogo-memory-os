// Async scope for inspected nested calls, not a global mutable owner.
import {AsyncLocalStorage} from 'node:async_hooks'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import type {GovernedRuntime} from './governed-runtime'
type ActiveRun={owner:string;runtime:GovernedRuntime;inTime:()=>boolean}
const store=new AsyncLocalStorage<ActiveRun>()
export function currentGovernedRun():ActiveRun|null{return store.getStore()||null}
export async function withGovernedPersonalRun<T>(owner:string,runtime:GovernedRuntime,inTime:()=>boolean,work:()=>Promise<T>):Promise<T>{
  const parent=store.getStore()
  if(exactSessionOwnerId(owner)!==owner||parent&&(parent.owner!==owner||parent.runtime!==runtime))throw Error('governed_nested_identity_mismatch')
  let closed=false
  const scope={owner,runtime,inTime:()=>!closed&&inTime()&&(!parent||parent.inTime())}
  if(!scope.inTime())throw Error('governed_nested_deadline')
  try{return await store.run(scope,work)}finally{closed=true}
}
