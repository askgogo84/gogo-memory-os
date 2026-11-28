// Async scope for inspected nested calls, not a global mutable owner.
import {AsyncLocalStorage} from 'node:async_hooks'
import {exactSessionOwnerId} from '@/lib/dashboard/owner-identity'
import type {GovernedRuntime} from './governed-runtime'
type ActiveRun={owner:string;runtime:GovernedRuntime;inTime:()=>boolean}
const store:AsyncLocalStorage<ActiveRun>=(globalThis as any).__gogoGovernedRunStore||new AsyncLocalStorage<ActiveRun>()
;(globalThis as any).__gogoGovernedRunStore=store
export function currentGovernedRun():ActiveRun|null{return store.getStore()||null}
export async function withGovernedPersonalRun<T>(owner:string,runtime:GovernedRuntime,inTime:()=>boolean,work:()=>Promise<T>):Promise<T>{
  const parent=store.getStore()
  if(exactSessionOwnerId(owner)!==owner||parent&&(parent.owner!==owner||parent.runtime!==runtime))throw Error('governed_nested_identity_mismatch')
  let closed=false
  const scope={owner,runtime,inTime:()=>!closed&&inTime()&&(!parent||parent.inTime())}
  if(!scope.inTime())throw Error('governed_nested_deadline')
  try{return await store.run(scope,work)}finally{closed=true}
}

// A lazy foreground scope begins before routing and is bound only after the
// signed-in or signature-verified owner has been resolved. One promise, one
// ledger run per request, shared by all model calls and search fallbacks.
// A failed open remains failed; it never grants a fresh budget later.
type Foreground={owner:string|null;closed:boolean;deadline:number;runtime?:Promise<GovernedRuntime|null>}
const foregroundStore:AsyncLocalStorage<Foreground>=(globalThis as any).__gogoGovernedForegroundStore||new AsyncLocalStorage<Foreground>()
;(globalThis as any).__gogoGovernedForegroundStore=foregroundStore
export function currentGovernedForeground():Foreground|null{return foregroundStore.getStore()||null}
export async function withGovernedForeground<T>(work:()=>Promise<T>,maxMs=120_000):Promise<T>{
  const old=foregroundStore.getStore()
  if(old){if(old.closed||Date.now()>=old.deadline)throw Error('governed_foreground_closed');return work()}
  const scope:Foreground={owner:null,closed:false,deadline:Date.now()+Math.max(1000,Math.min(300_000,maxMs))}
  try{return await foregroundStore.run(scope,work)}finally{scope.closed=true}
}
export function bindGovernedForegroundOwner(raw:string|number):void{
  const scope=foregroundStore.getStore(),owner=exactSessionOwnerId(raw)
  if(!scope||scope.closed||!owner||scope.owner!==null&&scope.owner!==owner)throw Error('governed_foreground_identity')
  scope.owner=owner
}
export function foregroundInTime(owner:string):boolean{
  const s=foregroundStore.getStore()
  return !!s&&s.owner===owner&&!s.closed&&Date.now()<s.deadline
}
export async function foregroundRuntime(owner:string,open:()=>Promise<GovernedRuntime|null>):Promise<GovernedRuntime|null>{
  const scope=foregroundStore.getStore()
  if(!scope||!foregroundInTime(owner))return null
  scope.runtime ||= Promise.resolve().then(open).catch(()=>null)
  const value=await scope.runtime
  return foregroundInTime(owner)?value:null
}
