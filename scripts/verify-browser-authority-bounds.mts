import * as sentinel from '../lib/agent/sentinel'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {runInNewContext} from 'node:vm'
import ts from 'typescript'
import * as trust from '../lib/agent/trust'

// Actual planner/vision/entrypoint exports, inert model and browser transports.
// This script cannot open a browser, call a model or submit anything externally.
const prompts:string[]=[]
let browserStarts=0
const actual:any={}
const source=readFileSync('lib/agent/secure-computer.ts','utf8')+'\nexport const fixturePlanActions=planActions;'
runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:actual,require:(name:string)=>name==='./sentinel'?sentinel:name==='./planner-provider'?{
  completeAgentPlanPrompt:async(prompt:string)=>{prompts.push(prompt);return JSON.stringify({approvedOperation:'booking',actions:[]})},
  completeVisionPrompt:async(prompt:string)=>{prompts.push(prompt);return JSON.stringify({action:'none'})},
 }:name==='./trust'?trust:name==='./secure-browser-redaction'?{redactBrowserSensitiveText:(value:string)=>value}:name==='./browser-owner-lock'?{acquireBrowserOwnerLock:async()=>{browserStarts++;throw new Error('Unexpected browser launch')}}:{},
 console,URL,Buffer,process:{env:{}},setTimeout,clearTimeout,AbortSignal,
})
const tail='FINAL APPROVED LIMIT: fee/deposit ₹0. Do not submit a dining interval overlapping the last Calendar window.'
const objective='Book one table at Synthetic Restaurant. '+Array.from({length:70},(_,i)=>`Calendar busy window ${i}: 2026-10-22T14:00:00Z through 2026-10-22T17:00:00Z.`).join(' ')+' '+tail
assert.ok(objective.length>1600&&objective.length<32000)
const page={url:'https://example.test/reserve',title:'Synthetic provider',text:'No slots',controls:[],forms:[],links:[]}
for(const mode of ['execute','draft']){
 prompts.length=0
 await actual.fixturePlanActions(objective,page,mode,'USER_INSTRUCTION')
 assert.ok(prompts[0]?.includes(tail),mode+' must retain the complete approved constraints, including the tail')
}
prompts.length=0
await actual.visionPlan(objective,'inert-screenshot',{w:800,h:600},{phoneAvailable:false,otpAvailable:false,loginFirst:false,tried:[]})
assert.ok(prompts[0]?.includes(tail),'A screenshot fallback cannot discard approved constraints')
const before=prompts.length
await assert.rejects(()=>actual.fixturePlanActions('x'.repeat(32001),page,'execute','USER_INSTRUCTION'),/browser_objective_too_long/)
assert.equal(prompts.length,before,'Oversized authority must stop before model planning')
await assert.rejects(()=>actual.runSecureBrowser({userId:'fixture-owner',url:page.url,objective:'x'.repeat(32001),mode:'execute'}),/browser_objective_too_long/)
assert.equal(browserStarts,0,'Oversized authority must stop before browser acquisition')
console.log('Actual browser planner and entrypoint preserve bounded execution authority and reject overflow before I/O; inert transports only.')
