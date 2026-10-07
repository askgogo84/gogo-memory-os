import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'

// Execute the shipped component's effects and send callbacks with a controlled
// clock/network. This reproduces a worker finishing while chat stays open.
const states:any[]=[]
const effects:Array<()=>any>=[]
let tick:(()=>void)|undefined
let cleared=false
let removed=false
let chatReads=0
let history:any[]=[{role:'user',content:'Compare the test item'}]
let pendingRead:Promise<any>|null=null
let resolvePost:(value:any)=>void=()=>{}
const post=new Promise(resolve=>{resolvePost=resolve})
const reply=(data:any)=>({ok:true,json:async()=>data})
const doc={hidden:false,addEventListener:()=>{},removeEventListener:()=>{removed=true}}
const exports:any={}
runInNewContext(ts.transpileModule(readFileSync('components/dashboard/gogo-chat.tsx','utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},
}).outputText,{
  exports,document:doc,AbortSignal,
  setInterval:(fn:()=>void)=>{tick=fn;return 1},clearInterval:()=>{cleared=true},
  requestAnimationFrame:()=>{},
  fetch:async(url:string,options:any={})=>{
    if(options.method==='POST')return post
    if(url==='/api/dashboard/chat'){chatReads++;return pendingRead||reply({messages:history.slice()})}
    // A stalled activity request must never hold chat history or its poll open.
    return new Promise(()=>{})
  },
  require:(id:string)=>{
    if(id==='react')return {
      useState:(initial:any)=>{const i=states.length;states.push(initial);return [initial,(v:any)=>{states[i]=typeof v==='function'?v(states[i]):v}]},
      useRef:(current:any)=>({current}),useEffect:(fn:()=>any)=>effects.push(fn),useMemo:(fn:()=>any)=>fn(),
    }
    if(id==='react/jsx-runtime')return {jsx:(type:any,props:any)=>({type,props}),jsxs:(type:any,props:any)=>({type,props})}
    if(id==='next/navigation')return {useSearchParams:()=>({get:()=>null})}
    if(id.includes('run-state'))return {summarizeActiveRunState:()=>({label:'Ready',tone:'ready'})}
    return {}
  },
})
const tree=exports.GogoChat({})
const cleanups=effects.map(fn=>fn())
const flush=async()=>{for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve))}
await flush()
assert.equal(states[0].length,1)
assert.equal(states[2],false,'history finishes loading even when the activity rail stalls')
assert.ok(tick,'an already-open chat must refresh completed background tasks')
history.push({role:'assistant',content:'Comparison finished. Saved comparison: /report'})
tick!();await flush()
assert.equal(states[0].at(-1).content,history.at(-1).content,'worker result arrives without reload or new prompt')
const same=states[0]
tick!();await flush()
assert.equal(states[0],same,'unchanged poll does not append duplicates or trigger scrolling')
const reads=chatReads
doc.hidden=true;tick!();await flush()
assert.equal(chatReads,reads,'hidden chat does not poll')
doc.hidden=false

// Delayed background history must not erase a newer optimistic send/reply.
let releaseRead:(value:any)=>void=()=>{}
pendingRead=new Promise(resolve=>{releaseRead=resolve})
tick!();await flush()
const findButton=(node:any):any=>{
  if(!node||typeof node!=='object')return null
  if(node.type==='button'&&node.props.children==='What do I have today?')return node
  const children=Array.isArray(node)?node:Array.isArray(node.props?.children)?node.props.children:[node.props?.children]
  for(const child of children){const found=findButton(child);if(found)return found}
  return null
}
const button=findButton(tree)
assert.ok(button)
button.props.onClick();await flush()
releaseRead(reply({messages:history.slice()}));await flush()
assert.equal(states[0].at(-1).content,'What do I have today?','stale poll cannot overwrite an in-flight message')
pendingRead=null
const sendingReads=chatReads
tick!();await flush()
assert.equal(chatReads,sendingReads,'poll skips an active send')
resolvePost(reply({text:'Your schedule'}));await flush()
assert.equal(states[0].at(-1).content,'Your schedule')
for(const cleanup of cleanups)if(typeof cleanup==='function')cleanup()
assert.ok(cleared&&removed,'unmount removes timer and visibility listener')
console.log('PASS: live background delivery, stable refresh, hidden-tab pause and in-flight send isolation')

const historyRoute:any={}
runInNewContext(ts.transpileModule(readFileSync('app/api/dashboard/chat/route.ts','utf8')+'\nexport {cleanHistory}',{
  compilerOptions:{module:ts.ModuleKind.CommonJS},
}).outputText,{exports:historyRoute,require:(id:string)=>id==='@/lib/bot/memory-redaction'?{redactSecretShapedText:(text:string)=>text}:{}})
for(const marker of ['pending_friend','pending_friend_confirm','pending_skin_check']){
  assert.equal(historyRoute.cleanHistory('user',`[${marker}] {"task":"internal state"}`),null)
}
assert.equal(historyRoute.cleanHistory('user','Remind Matthew tomorrow at 11am.'),'Remind Matthew tomorrow at 11am.')
assert.equal(historyRoute.cleanHistory('assistant','Flipkart ₹1,34,900. Product page: https://www.flipkart.com/product/p/example'),'Flipkart ₹1,34,900. Product page: https://www.flipkart.com/product/p/example')
console.log('PASS: internal pending records stay out of chat while real requests and retailer results remain visible')
