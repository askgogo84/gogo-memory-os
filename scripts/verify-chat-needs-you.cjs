const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const repo=process.cwd();
const ts=require(path.join(repo,'node_modules/typescript'));
const flush=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));};
const reply=data=>({ok:true,json:async()=>structuredClone(data)});
const base={runs:[],watchers:[],approvals:[],serviceNotices:[],serviceNoticeCount:0,handoffs:[]};
const handoff=(id,title)=>({id,title,summary:'Complete the synthetic provider step yourself.',takeoverUrl:'SYNTHETIC_PRIVATE_TAKEOVER',repeats:0});
function harness(initial){
 const states=[],refs=[],effects=[],calls=[];let si=0,ri=0,mount=true,tick,fail=false,payload=initial;
 const jsx=(type,props)=>typeof type==='function'?type(props):({type,props});
 const cache={};
 const load=file=>{
  const full=path.join(repo,file);if(cache[full])return cache[full];const exports=cache[full]={};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   exports,require:id=>{
    if(id==='react')return {useState:initial=>{const n=si++;if(!(n in states))states[n]=initial;return[states[n],v=>{states[n]=typeof v==='function'?v(states[n]):v;}]},useRef:current=>{const n=ri++;return refs[n]||(refs[n]={current});},useEffect:fn=>{if(mount)effects.push(fn);},useMemo:fn=>fn()};
    if(id==='react/jsx-runtime')return{jsx,jsxs:jsx,Fragment:'fragment'};
    if(id==='next/navigation')return{useSearchParams:()=>({get:()=>null})};
    if(id==='next/link')return{default:'a'};
    if(id==='@/components/gogo/gogo-character')return{GogoCharacter:()=>null};
    if(id==='@/components/dashboard/mobile-nav')return{MobileMenuButton:()=>null};
    if(id==='./chat-channels')return{ChatChannels:()=>null,ChannelPill:()=>null};
    if(id.startsWith('@/')){
     const relative=id.slice(2),ext=relative.startsWith('components/')?'.tsx':'.ts';
     assert(/^(lib\/(dashboard|agent\/flight-choices)|components\/dashboard\/service-notice-cards)/.test(relative),'Unexpected dependency '+id);
     return load(relative+ext);
    }
    if(id.startsWith('.'))return load(path.relative(repo,path.resolve(path.dirname(full),id+'.ts')));
    throw Error('Unexpected dependency '+id);
   },fetch:async(url,options={})=>{calls.push({url,method:options.method||'GET'});if(url==='/api/agent/snapshot')return fail?{ok:false}:reply(payload);if(url==='/api/agent/threads')return reply({threads:[]});assert.equal(url,'/api/dashboard/chat');return reply(options.method==='POST'?{text:'Synthetic reply'}:{messages:[]});},
   document:{hidden:false,addEventListener:()=>{},removeEventListener:()=>{}},AbortSignal,
   setInterval:fn=>{tick=fn;return 1;},clearInterval:()=>{},setTimeout:()=>1,clearTimeout:()=>{},requestAnimationFrame:()=>{},
  });return exports;
 };
 const component=load('components/dashboard/gogo-chat.tsx');
 const render=()=>{si=0;ri=0;return component.GogoChat({});};
 let tree=render();mount=false;effects.forEach(fn=>fn());
 return{render,states,calls,tick:()=>tick(),setPayload:value=>{payload=value;},setFail:value=>{fail=value;},tree};
}
function walk(node,predicate){if(!node||typeof node!=='object')return null;if(predicate(node))return node;for(const child of Array.isArray(node)?node:[node.props?.children]){const result=walk(child,predicate);if(result)return result;}return null;}
function text(node){if(node==null||typeof node==='boolean')return '';if(typeof node!=='object')return String(node);return(Array.isArray(node)?node:[node.props?.children]).map(text).join(' ');}
const rail=tree=>walk(tree,node=>node.type==='section'&&text(node).includes('Needs you'));
const failures=[];
async function check(label,fn){try{await fn();console.log('PASS '+label);}catch(error){failures.push(label+': '+error.message);}}
(async()=>{
 await check('real chat refresh retains and renders browser handoffs in Needs you',async()=>{
  const h=harness({...base,handoffs:[handoff('run-a','Provider A'),handoff('run-b','Provider B'),handoff('run-c','Provider C')]});await flush();const view=rail(h.render());
  assert.match(text(view),/Needs you\s+3/);assert.match(text(view),/Provider A/);assert.match(text(view),/Provider B/);assert.match(text(view),/Provider C/);assert.doesNotMatch(text(view),/Nothing is waiting/);
  assert.ok(walk(view,node=>node.type==='a'&&node.props.href==='/dashboard/activity/run-a/browser'));assert.doesNotMatch(JSON.stringify(view),/SYNTHETIC_PRIVATE_TAKEOVER/);
  assert.ok(h.calls.every(call=>call.method==='GET'),'refresh must remain read-only');
 });
 await check('same-site repeats count once beside approvals and exact service notice totals',async()=>{
  const h=harness({...base,handoffs:[handoff('run-a','Provider A'),handoff('run-b','Provider A')],approvals:[{id:'approval-a',title:'Synthetic approval'}],serviceNotices:[{id:'notice-a',title:'Synthetic service warning',summary:'Review only',threadId:'synthetic-thread'}],serviceNoticeCount:5});await flush();
  const view=rail(h.render());assert.match(text(view),/Needs you\s+7/);assert.doesNotMatch(text(view),/Nothing is waiting/);assert.ok(walk(view,node=>node.type==='a'&&node.props.href==='/dashboard/agent?section=approvals'),'grouped repeats link to all earlier stops');
 });
 await check('post-reply snapshot retains newly returned browser handoffs',async()=>{
  const h=harness({...base});await flush();h.setPayload({...base,handoffs:[handoff('run-new','Provider New')]});
  const button=walk(h.render(),node=>node.type==='button'&&text(node).trim().startsWith('What do I have today?'));assert(button);button.props.onClick();await flush();
  const view=rail(h.render());assert.match(text(view),/Needs you\s+1/);assert.match(text(view),/Provider New/);assert.doesNotMatch(text(view),/Nothing is waiting/);
  assert.equal(h.calls.filter(call=>call.method==='POST').length,1,'only synthetic chat transport executes; no provider action');
 });
 await check('bounded handoff cards retain the complete count and safe task links',async()=>{
  const rows=Array.from({length:5},(_,i)=>handoff(i===0?'run/with?reserved#chars':'run-'+i,'Provider '+i));
  const h=harness({...base,handoffs:rows});await flush();const view=rail(h.render());
  assert.match(text(view),/Needs you\s+5/);assert.match(text(view),/Provider 0/);assert.match(text(view),/Provider 2/);assert.doesNotMatch(text(view),/Provider 3|Provider 4/);
  assert.ok(walk(view,node=>node.type==='a'&&node.props.href==='/dashboard/activity/run%2Fwith%3Freserved%23chars/browser'));
  assert.ok(walk(view,node=>node.type==='a'&&node.props.href==='/dashboard/agent?section=approvals'&&text(node).trim()==='5'),'complete count links to all waiting work');
  assert.doesNotMatch(JSON.stringify(view),/SYNTHETIC_PRIVATE_TAKEOVER/);
 });
 await check('collapsed earlier stops remain one waiting action',async()=>{
  const h=harness({...base,handoffs:[{...handoff('run-repeat','Provider Repeat'),repeats:4}]});await flush();const view=rail(h.render());
  assert.match(text(view),/Needs you\s+1/);assert.match(text(view),/Stopped here 5 times/);
  assert.ok(walk(view,node=>node.type==='a'&&node.props.href==='/dashboard/agent?section=approvals'));
 });
 await check('failed refresh stays explicitly unavailable and never reports empty success',async()=>{
  const h=harness({...base,handoffs:[handoff('run-a','Provider A')]});await flush();h.setFail(true);h.tick();await flush();const view=rail(h.render());assert.match(text(view),/Needs you\s+—/);assert.doesNotMatch(text(view),/Nothing is waiting/);
 });
 await check('empty legacy snapshot still reports an empty Needs you section',async()=>{
  const {handoffs,...legacy}=base;const h=harness(legacy);await flush();const view=rail(h.render());assert.match(text(view),/Needs you\s+0/);assert.match(text(view),/Nothing is waiting/);
 });
 if(failures.length){console.error(failures.join('\n'));process.exitCode=1;}else console.log('Actual chat Needs you handoffs: refresh, post-reply, grouping, links, totals, unavailable and empty states passed.');
})();
