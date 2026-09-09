import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { agentApi } from '../src/agent/api'
import type { AgentApproval, AgentCommandResult, AgentHomeSnapshot, AgentPermission, AgentRun, AgentStep, AgentRunStatus, PermissionLevel } from '../src/agent/types'

const C={bg:'#F6F0E8',paper:'#FFFDF9',ink:'#3A2418',muted:'#8C7769',line:'rgba(58,36,24,.10)',orange:'#F47B20',orangeSoft:'#FFF0E4',cocoa:'#3A2519',mint:'#EAF8EF',blue:'#EDF7FF',lav:'#F0EDFF',red:'#A43B2E',green:'#2E9B67'}
const GOGO='https://app.askgogo.in/gogo-float.gif'
type ViewKey='activity'|'goals'|'ideas'|'safe'
const runLabel:Record<AgentRunStatus,string>={queued:'Queued',running:'Working',watching:'Watching',waiting_approval:'Needs approval',completed:'Done',failed:'Failed',paused:'Paused'}

export default function AgentHub(){
  const [view,setView]=useState<ViewKey>('activity')
  const [snapshot,setSnapshot]=useState<AgentHomeSnapshot|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [command,setCommand]=useState('')
  const [running,setRunning]=useState(false)
  const [latest,setLatest]=useState<AgentCommandResult|null>(null)
  const [busyApproval,setBusyApproval]=useState<string|null>(null)
  const [busyPermission,setBusyPermission]=useState<string|null>(null)
  const [busyWatcher,setBusyWatcher]=useState<string|null>(null)

  const refresh=useCallback(async()=>{
    try{setSnapshot(await agentApi.snapshot());setError('')}
    catch(e:any){setError(e?.message||'Could not load Gogo Agent.')}
    finally{setLoading(false)}
  },[])
  useEffect(()=>{refresh();const t=setInterval(refresh,8000);return()=>clearInterval(t)},[refresh])

  const runs=snapshot?.runs||[]
  const active=useMemo(()=>runs.filter(r=>['queued','running','watching','waiting_approval'].includes(r.status)),[runs])

  async function runCommand(){
    const text=command.trim();if(!text||running)return
    setRunning(true);setLatest(null);setError('')
    try{
      const result=await agentApi.run(text,{screen:'agent'})
      setLatest(result);setCommand('');setView('activity')
      await Haptics.notificationAsync(result.status==='completed'?Haptics.NotificationFeedbackType.Success:Haptics.NotificationFeedbackType.Warning)
      await refresh()
    }catch(e:any){setError(e?.message||'Gogo could not start that action.')}
    finally{setRunning(false)}
  }

  async function approvalDecision(a:AgentApproval,decision:'approve'|'reject'){
    if(busyApproval)return
    setBusyApproval(a.id);setError('')
    try{
      if(decision==='approve'){
        const out=await agentApi.approveAndExecute(a);setLatest(out.result)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }else{await agentApi.resolveApproval(a.id,'reject');await Haptics.selectionAsync()}
      await refresh()
    }catch(e:any){setError(e?.message||'Could not update approval.')}
    finally{setBusyApproval(null)}
  }

  async function changePermission(p:AgentPermission){
    if(busyPermission)return
    const consequential=new Set(['email','calendar','browser','travel','payments'])
    const cycle:PermissionLevel[]=consequential.has(p.capability)?['off','read','draft','ask']:['off','read','draft','ask','auto']
    const next=cycle[(cycle.indexOf(p.level)+1)%cycle.length]
    setBusyPermission(p.capability)
    try{await agentApi.updatePermission(p.capability,next);await Haptics.selectionAsync();await refresh()}
    catch(e:any){setError(e?.message||'Could not change permission.')}
    finally{setBusyPermission(null)}
  }

  async function stopWatcher(id:string){
    if(busyWatcher)return
    setBusyWatcher(id)
    try{await agentApi.stopWatcher(id);await Haptics.selectionAsync();await refresh()}
    catch(e:any){setError(e?.message||'Could not stop that watch.')}
    finally{setBusyWatcher(null)}
  }

  if(loading)return <SafeAreaView style={s.safe}><View style={s.center}><ActivityIndicator color={C.orange}/><Text style={s.muted}>Loading the same Gogo you use on WhatsApp…</Text></View></SafeAreaView>

  return <SafeAreaView style={s.safe}>
    <View style={s.header}>
      <View style={s.brand}><Image source={{uri:GOGO}} style={s.avatar}/><View><Text style={s.title}>Gogo Agent</Text><Text style={s.sub}>Same brain · WhatsApp + app</Text></View></View>
      <View style={s.headerRight}><Pressable onPress={refresh} style={s.iconBtn}><Ionicons name="refresh" size={16} color={C.muted}/></Pressable><View style={s.live}><View style={s.liveDot}/><Text style={s.liveText}>LIVE</Text></View></View>
    </View>

    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <Text style={s.heroKicker}>GOGO CAN PLAN · ACT · WATCH</Text>
        <Text style={s.heroTitle}>{active.length?`${active.length} things are moving.`:'Tell Gogo the outcome.'}</Text>
        <Text style={s.heroText}>One request can use several tools. You can see every step. Sending, booking, paying and consequential changes stop for approval.</Text>
        <Image source={{uri:GOGO}} style={s.heroGogo}/>
      </View>

      <View style={s.commandCard}>
        <Text style={s.commandLabel}>ASK GOGO NATURALLY</Text>
        <View style={s.commandRow}><TextInput value={command} onChangeText={setCommand} placeholder="Find my passport and remind me six months before it expires" placeholderTextColor="#A49387" style={s.commandInput} multiline maxLength={2000}/><Pressable onPress={runCommand} disabled={!command.trim()||running} style={[s.send,(!command.trim()||running)&&{opacity:.4}]}>{running?<ActivityIndicator size="small" color="white"/>:<Ionicons name="arrow-up" size={19} color="white"/>}</Pressable></View>
        <View style={s.chips}>{['Find my passport and remind me six months before it expires','Add milk to groceries','What is on my calendar?'].map(x=><Pressable key={x} onPress={()=>setCommand(x)} style={s.chip}><Text numberOfLines={1} style={s.chipText}>{x}</Text></Pressable>)}</View>
      </View>

      {!!latest&&<View style={[s.result,latest.status==='completed'?s.resultGood:s.resultWarn]}><Ionicons name={latest.status==='completed'?'checkmark-circle':'hand-left'} size={21} color={latest.status==='completed'?C.green:C.orange}/><View style={{flex:1}}><Text style={s.cardTitle}>{latest.status==='completed'?'Completed':'Gogo needs attention'}</Text><Text style={s.cardText}>{latest.text||latest.blockedReason||`${latest.capability} · ${latest.risk}`}</Text>{latest.steps?.map(st=><StepLine key={`${st.ordinal}-${st.toolName}`} step={st}/>)}</View></View>}
      {!!error&&<View style={s.error}><Ionicons name="alert-circle-outline" size={18} color={C.red}/><Text style={s.errorText}>{error}</Text></View>}

      <View style={s.tabs}>
        <Tab label="Activity" icon="pulse-outline" on={view==='activity'} tap={()=>setView('activity')}/>
        <Tab label="Goals" icon="flag-outline" on={view==='goals'} tap={()=>setView('goals')}/>
        <Tab label="Ideas" icon="sparkles-outline" on={view==='ideas'} tap={()=>setView('ideas')}/>
        <Tab label="Safe" icon="shield-checkmark-outline" on={view==='safe'} tap={()=>setView('safe')}/>
      </View>

      {view==='activity'&&<>
        <Section title="Gogo Activity" right={`${runs.length} recent`}/>
        {!runs.length&&<Empty icon="pulse-outline" title="No agent runs yet" text="Give Gogo a command. Multi-step work will appear here."/>}
        {runs.map(run=><RunCard key={run.id} run={run}/>) }

        <Section title="Background Gogo" right={`${snapshot?.watchers?.length||0} watching`}/>
        {!snapshot?.watchers?.length&&<Empty icon="eye-outline" title="Nothing being watched" text="Background watches will track deadlines and, next, calendar changes, replies, prices, travel and web changes."/>}
        {snapshot?.watchers?.map(w=><View key={w.id} style={s.card}><View style={s.row}><View style={[s.box,{backgroundColor:C.lav}]}><Ionicons name="eye-outline" size={18} color="#6658B5"/></View><View style={{flex:1}}><Text style={s.cardTitle}>{w.title}</Text><Text style={s.cardText}>{w.type.replaceAll('_',' ')} · next check {formatTime(w.nextCheckAt)}</Text></View><Pressable onPress={()=>stopWatcher(w.id)} disabled={busyWatcher===w.id} style={s.stopBtn}>{busyWatcher===w.id?<ActivityIndicator size="small" color={C.red}/>:<Text style={s.stopText}>Stop</Text>}</Pressable></View></View>)}

        <Section title="Waiting for you" right={`${snapshot?.approvals?.length||0} approvals`}/>
        {!snapshot?.approvals?.length&&<View style={s.clear}><Ionicons name="shield-checkmark" size={16} color={C.green}/><Text style={s.clearText}>Nothing is waiting for approval.</Text></View>}
        {snapshot?.approvals?.map(a=><Approval key={a.id} a={a} busy={busyApproval===a.id} decide={d=>approvalDecision(a,d)}/>)}
      </>}

      {view==='goals'&&<>
        <Section title="Goals" right="outcomes, not chores"/>
        {!snapshot?.goals.length&&<Empty icon="flag-outline" title="No goals yet" text="Goals will coordinate plans, approvals, artifacts and background watches toward one outcome."/>}
        {snapshot?.goals.map(g=><View key={g.id} style={s.card}><View style={s.row}><View style={[s.box,{backgroundColor:C.lav}]}><Ionicons name="flag-outline" size={18} color="#6658B5"/></View><View style={{flex:1}}><Text style={s.cardTitle}>{g.title}</Text><Text style={s.cardText}>{g.outcome}</Text></View><Text style={s.percent}>{g.progress}%</Text></View><Progress value={g.progress}/>{g.nextAction&&<Text style={s.next}>Next · {g.nextAction}</Text>}</View>)}
      </>}

      {view==='ideas'&&<>
        <Section title="Ideas for you" right="proactive, not noisy"/>
        {!snapshot?.ideas.length&&<Empty icon="sparkles-outline" title="No proactive ideas right now" text="Gogo will surface a useful change, opportunity or blocker only when there is enough context."/>}
        {snapshot?.ideas.map(i=><View key={i.id} style={[s.card,{backgroundColor:'#FFF9F0'}]}><View style={s.row}><View style={[s.box,{backgroundColor:C.orangeSoft}]}><Ionicons name="sparkles" size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{i.title}</Text><Text style={s.cardText}>{i.reason}</Text></View></View><View style={s.ideaWhy}><Text style={s.ideaLabel}>WHY IT MAY HELP</Text><Text style={s.ideaText}>{i.expectedValue}</Text></View></View>)}
      </>}

      {view==='safe'&&<>
        <Section title="Gogo Safe Mode" right="server enforced"/>
        <View style={s.safeCard}><Ionicons name="shield-checkmark" size={25} color={C.green}/><View style={{flex:1}}><Text style={s.cardTitle}>The model cannot grant itself permission.</Text><Text style={s.cardText}>Consequential actions require a deterministic server check and one-shot approval. Credentials never belong in the activity log.</Text></View></View>
        {snapshot?.permissions.map(p=><Pressable key={p.capability} onPress={()=>changePermission(p)} disabled={!!busyPermission} style={s.permission}><View style={[s.box,{backgroundColor:C.orangeSoft}]}><Ionicons name={capIcon(p.capability)} size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{p.label}</Text><Text style={s.cardText}>{p.description}</Text>{p.irreversibleAlwaysAsk&&<Text style={s.always}>Consequential actions always ask</Text>}</View><View style={s.level}>{busyPermission===p.capability?<ActivityIndicator size="small" color={C.orange}/>:<Text style={s.levelText}>{p.level.toUpperCase()}</Text>}</View></Pressable>)}
      </>}

      <View style={s.footer}><Ionicons name="git-merge-outline" size={17} color={C.green}/><Text style={s.footerText}><Text style={{fontWeight:'900'}}>Same Gogo:</Text> this app uses the same WhatsApp identity, memory, reminder engine and safety policy. No mobile-only brain.</Text></View>
    </ScrollView>
  </SafeAreaView>
}

function RunCard({run}:{run:AgentRun}){return <View style={s.card}><View style={s.row}><View style={[s.box,{backgroundColor:run.status==='waiting_approval'?C.orangeSoft:C.blue}]}><Ionicons name={run.status==='watching'?'eye-outline':run.status==='waiting_approval'?'hand-left-outline':'flash-outline'} size={18} color={run.status==='waiting_approval'?C.orange:'#4775A8'}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{run.title}</Text><Text style={s.cardText}>{run.summary}</Text></View><View style={s.badge}><Text style={s.badgeText}>{runLabel[run.status]}</Text></View></View>{typeof run.progress==='number'&&<Progress value={run.progress}/>} {!!run.steps?.length&&<View style={s.steps}>{run.steps.map(step=><StepLine key={step.id||`${run.id}-${step.ordinal}`} step={step}/>)}</View>}{run.why&&<Text style={s.why}>Why · {run.why}</Text>}</View>}
function StepLine({step}:{step:AgentStep}){const done=step.status==='completed',bad=step.status==='failed',working=step.status==='running';return <View style={s.step}><View style={[s.stepDot,done&&{backgroundColor:C.green},bad&&{backgroundColor:C.red},working&&{backgroundColor:C.orange}]}>{done&&<Ionicons name="checkmark" size={10} color="white"/>}</View><View style={{flex:1}}><Text style={s.stepTitle}>{step.title}</Text><Text style={s.stepTool}>{step.toolName} · {step.status}</Text></View></View>}
function Approval({a,busy,decide}:{a:AgentApproval;busy:boolean;decide:(d:'approve'|'reject')=>void}){return <View style={[s.card,{borderColor:'rgba(244,123,32,.35)',backgroundColor:'#FFF9F4'}]}><Text style={s.cardTitle}>{a.title}</Text><Text style={s.cardText}>{a.description}</Text>{(a.preview||[]).map((x,i)=><View style={s.preview} key={i}><Text style={s.previewLabel}>{x.label}</Text><Text style={s.previewValue}>{x.value}</Text></View>)}<View style={s.actions}><Pressable disabled={busy} onPress={()=>decide('reject')} style={s.secondary}><Text style={s.secondaryText}>Not now</Text></Pressable><Pressable disabled={busy} onPress={()=>decide('approve')} style={s.primary}>{busy?<ActivityIndicator size="small" color="white"/>:<Text style={s.primaryText}>Approve & run</Text>}</Pressable></View></View>}
function Progress({value}:{value:number}){return <View style={s.track}><View style={[s.fill,{width:`${Math.max(0,Math.min(100,value))}%`} as any]}/></View>}
function Tab({label,icon,on,tap}:{label:string;icon:any;on:boolean;tap:()=>void}){return <Pressable onPress={()=>{Haptics.selectionAsync();tap()}} style={[s.tab,on&&s.tabOn]}><Ionicons name={icon} size={17} color={on?C.orange:C.muted}/><Text style={[s.tabText,on&&{color:C.orange}]}>{label}</Text></Pressable>}
function Section({title,right}:{title:string;right?:string}){return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text><Text style={s.sectionRight}>{right}</Text></View>}
function Empty({icon,title,text}:{icon:any;title:string;text:string}){return <View style={s.empty}><Ionicons name={icon} size={20} color={C.orange}/><View style={{flex:1}}><Text style={s.cardTitle}>{title}</Text><Text style={s.cardText}>{text}</Text></View></View>}
function capIcon(c:string):any{if(c==='email')return'mail-outline';if(c==='calendar')return'calendar-outline';if(c==='browser')return'globe-outline';if(c==='payments')return'card-outline';if(c==='reminders')return'alarm-outline';if(c==='lists')return'list-outline';if(c==='tasks')return'checkbox-outline';if(c==='files')return'document-outline';return'lock-closed-outline'}
function formatTime(v?:string|null){if(!v)return'when needed';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'when needed'}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},center:{flex:1,alignItems:'center',justifyContent:'center',gap:10,padding:24},muted:{fontSize:11,color:C.muted,textAlign:'center'},header:{height:70,paddingHorizontal:17,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line},brand:{flexDirection:'row',alignItems:'center',gap:9},avatar:{width:40,height:40},title:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},sub:{fontSize:8.5,color:C.muted,marginTop:1},headerRight:{flexDirection:'row',gap:7,alignItems:'center'},iconBtn:{width:34,height:34,borderRadius:17,backgroundColor:'white',borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},live:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'white',borderWidth:1,borderColor:C.line,paddingHorizontal:9,paddingVertical:7,borderRadius:999},liveDot:{width:6,height:6,borderRadius:3,backgroundColor:C.green},liveText:{fontSize:7.5,fontWeight:'900',color:C.green,letterSpacing:.6},content:{padding:15,paddingBottom:55},hero:{minHeight:178,borderRadius:27,backgroundColor:C.cocoa,padding:18,overflow:'hidden'},heroKicker:{fontSize:8.5,letterSpacing:1.2,fontWeight:'900',color:'#F4A56D'},heroTitle:{fontFamily:'serif',fontSize:26,lineHeight:29,fontWeight:'700',color:'white',maxWidth:260,marginTop:8},heroText:{fontSize:10,lineHeight:15,color:'#D9C9BE',maxWidth:255,marginTop:7},heroGogo:{width:112,height:112,position:'absolute',right:-3,bottom:-2},commandCard:{marginTop:11,borderRadius:22,backgroundColor:C.paper,borderWidth:1,borderColor:C.line,padding:13},commandLabel:{fontSize:8,fontWeight:'900',letterSpacing:1.1,color:C.orange,marginBottom:8},commandRow:{minHeight:54,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:'white',flexDirection:'row',alignItems:'center',paddingLeft:12},commandInput:{flex:1,minHeight:48,maxHeight:100,fontSize:11,color:C.ink,paddingVertical:9},send:{width:39,height:39,borderRadius:13,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',marginRight:6},chips:{flexDirection:'row',gap:5,flexWrap:'wrap',marginTop:8},chip:{maxWidth:'100%',paddingHorizontal:8,paddingVertical:6,borderRadius:999,backgroundColor:'#F5EFE8'},chipText:{fontSize:7.5,color:C.muted,fontWeight:'700'},result:{marginTop:10,borderRadius:18,padding:12,flexDirection:'row',gap:9,alignItems:'flex-start'},resultGood:{backgroundColor:C.mint},resultWarn:{backgroundColor:C.orangeSoft},error:{marginTop:10,borderRadius:16,padding:11,backgroundColor:'#FFF0EC',flexDirection:'row',gap:7},errorText:{flex:1,fontSize:9,lineHeight:14,color:C.red},tabs:{marginTop:12,padding:4,borderRadius:17,backgroundColor:'#EDE4DC',flexDirection:'row'},tab:{flex:1,minHeight:52,alignItems:'center',justifyContent:'center',gap:3,borderRadius:14},tabOn:{backgroundColor:'white'},tabText:{fontSize:7.5,fontWeight:'800',color:C.muted},section:{marginTop:20,marginBottom:9,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',paddingHorizontal:2},sectionTitle:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},sectionRight:{fontSize:8.5,color:C.muted},card:{borderRadius:21,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:14,marginBottom:9},row:{flexDirection:'row',gap:10,alignItems:'flex-start'},box:{width:38,height:38,borderRadius:13,alignItems:'center',justifyContent:'center'},cardTitle:{fontSize:11,fontWeight:'800',color:C.ink},cardText:{fontSize:9,lineHeight:14,color:C.muted,marginTop:2},badge:{borderRadius:999,paddingHorizontal:8,paddingVertical:5,backgroundColor:'#EEF3F6'},badgeText:{fontSize:7.5,fontWeight:'900',color:'#637985'},track:{height:6,borderRadius:99,backgroundColor:'#EEE6DF',overflow:'hidden',marginTop:12},fill:{height:'100%',backgroundColor:C.orange,borderRadius:99},steps:{marginTop:11,borderTopWidth:1,borderTopColor:C.line,paddingTop:8,gap:7},step:{flexDirection:'row',alignItems:'center',gap:8},stepDot:{width:18,height:18,borderRadius:9,backgroundColor:'#D8D0C8',alignItems:'center',justifyContent:'center'},stepTitle:{fontSize:9,fontWeight:'800',color:C.ink},stepTool:{fontSize:7.5,color:C.muted,marginTop:1},why:{fontSize:8,color:C.muted,backgroundColor:'#F7F3EF',padding:8,borderRadius:12,marginTop:9},stopBtn:{paddingHorizontal:10,paddingVertical:7,borderRadius:10,backgroundColor:'#FFF0EC'},stopText:{fontSize:8,fontWeight:'900',color:C.red},clear:{padding:11,borderRadius:16,backgroundColor:C.mint,flexDirection:'row',gap:7,alignItems:'center',marginBottom:8},clearText:{fontSize:9,color:C.green,fontWeight:'700'},preview:{flexDirection:'row',justifyContent:'space-between',gap:10,paddingVertical:7,borderTopWidth:1,borderTopColor:C.line,marginTop:8},previewLabel:{fontSize:8,color:C.muted},previewValue:{fontSize:8.5,fontWeight:'800',color:C.ink,maxWidth:'70%',textAlign:'right'},actions:{flexDirection:'row',gap:8,marginTop:10},secondary:{flex:1,minHeight:38,borderRadius:13,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},secondaryText:{fontSize:9,fontWeight:'800',color:C.ink},primary:{flex:1.25,minHeight:38,borderRadius:13,backgroundColor:C.cocoa,alignItems:'center',justifyContent:'center'},primaryText:{fontSize:9,fontWeight:'800',color:'white'},percent:{fontFamily:'serif',fontSize:19,fontWeight:'700',color:C.orange},next:{fontSize:8.5,color:C.muted,marginTop:8},ideaWhy:{marginTop:10,padding:10,borderRadius:14,backgroundColor:C.orangeSoft},ideaLabel:{fontSize:7,fontWeight:'900',letterSpacing:.8,color:C.orange},ideaText:{fontSize:9,lineHeight:14,color:C.ink,marginTop:3},safeCard:{borderRadius:20,backgroundColor:C.mint,padding:14,flexDirection:'row',gap:10,marginBottom:10},permission:{borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:12,marginBottom:7,flexDirection:'row',gap:9,alignItems:'center'},always:{fontSize:7.5,color:C.orange,fontWeight:'800',marginTop:4},level:{minWidth:54,minHeight:29,paddingHorizontal:7,borderRadius:10,backgroundColor:'#F3EEE9',alignItems:'center',justifyContent:'center'},levelText:{fontSize:7,fontWeight:'900',color:C.ink},empty:{borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:13,flexDirection:'row',gap:10,marginBottom:8},footer:{marginTop:20,borderRadius:18,padding:12,backgroundColor:'#EFF8F2',flexDirection:'row',gap:8},footerText:{flex:1,fontSize:8.5,lineHeight:13,color:C.muted}
})
