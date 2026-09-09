import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { agentApi } from '../src/agent/api'
import type { AgentApproval, AgentCommandResult, AgentHomeSnapshot, AgentPermission, AgentRunStatus, PermissionLevel } from '../src/agent/types'

const C = {
  bg:'#F6F0E8', paper:'#FFFDF9', ink:'#3A2418', muted:'#8C7769', line:'rgba(58,36,24,.10)',
  orange:'#F47B20', orangeSoft:'#FFF0E4', cocoa:'#3A2519', mint:'#EAF8EF', blue:'#EDF7FF',
  lavender:'#F0EDFF', red:'#A43B2E', green:'#2E9B67',
}
const GOGO='https://app.askgogo.in/gogo-float.gif'
type AgentView='activity'|'goals'|'ideas'|'permissions'

const statusLabel:Record<AgentRunStatus,string>={queued:'Queued',running:'Working',watching:'Watching',waiting_approval:'Needs approval',completed:'Completed',failed:'Needs attention',paused:'Paused'}

export default function AgentHub(){
  const [view,setView]=useState<AgentView>('activity')
  const [snapshot,setSnapshot]=useState<AgentHomeSnapshot|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [command,setCommand]=useState('')
  const [runningCommand,setRunningCommand]=useState(false)
  const [latest,setLatest]=useState<AgentCommandResult|null>(null)
  const [busyApproval,setBusyApproval]=useState<string|null>(null)
  const [busyPermission,setBusyPermission]=useState<string|null>(null)

  const refresh=useCallback(async()=>{
    try{
      const next=await agentApi.snapshot()
      setSnapshot(next);setError('')
    }catch(e:any){setError(e?.message||'Could not load Gogo Agent.')}
    finally{setLoading(false)}
  },[])

  useEffect(()=>{refresh()},[refresh])

  const runs=snapshot?.runs||[]
  const activeRuns=useMemo(()=>runs.filter(r=>r.status!=='completed'&&r.status!=='failed'&&r.status!=='paused'),[runs])

  async function run(){
    const text=command.trim();if(!text||runningCommand)return
    setRunningCommand(true);setError('');setLatest(null)
    try{
      const result=await agentApi.run(text,{screen:'agent'})
      setLatest(result);setCommand('');setView('activity')
      await Haptics.notificationAsync(result.status==='completed'?Haptics.NotificationFeedbackType.Success:Haptics.NotificationFeedbackType.Warning)
      await refresh()
    }catch(e:any){setError(e?.message||'Gogo could not start that action.')}
    finally{setRunningCommand(false)}
  }

  async function decide(approval:AgentApproval,decision:'approve'|'reject'){
    if(busyApproval)return
    setBusyApproval(approval.id);setError('')
    try{
      if(decision==='approve'){
        const outcome=await agentApi.approveAndExecute(approval)
        setLatest(outcome.result)
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      }else{
        await agentApi.resolveApproval(approval.id,'reject')
        await Haptics.selectionAsync()
      }
      await refresh()
    }catch(e:any){setError(e?.message||'Could not update that approval.')}
    finally{setBusyApproval(null)}
  }

  async function changePermission(permission:AgentPermission){
    if(busyPermission)return
    const consequential=new Set(['email','calendar','browser','travel','payments'])
    const cycle:PermissionLevel[]=consequential.has(permission.capability)
      ? ['off','read','draft','ask']
      : ['off','read','draft','ask','auto']
    const current=cycle.indexOf(permission.level)
    const next=cycle[(current+1)%cycle.length]
    setBusyPermission(permission.capability)
    try{
      await agentApi.updatePermission(permission.capability,next)
      await Haptics.selectionAsync();await refresh()
    }catch(e:any){setError(e?.message||'Could not change that permission.')}
    finally{setBusyPermission(null)}
  }

  return <SafeAreaView style={s.safe}>
    <View style={s.header}>
      <View style={s.brand}><Image source={{uri:GOGO}} style={s.avatar}/><View><Text style={s.title}>Gogo Agent</Text><Text style={s.subtitle}>Same brain · WhatsApp + app</Text></View></View>
      <View style={s.headActions}><Pressable onPress={refresh} style={s.refresh}><Ionicons name="refresh" size={16} color={C.muted}/></Pressable><View style={s.liveBadge}><View style={s.liveDot}/><Text style={s.liveText}>LIVE</Text></View></View>
    </View>

    {loading?<View style={s.center}><ActivityIndicator color={C.orange}/><Text style={s.loadingText}>Loading your Gogo…</Text></View>:
    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <View style={{flex:1}}><Text style={s.heroKicker}>GOGO CAN ACT</Text><Text style={s.heroTitle}>{activeRuns.length?`${activeRuns.length} things are moving.`:'Tell Gogo what outcome you want.'}</Text><Text style={s.heroText}>One command can use Memory, Reminders, Lists, Tasks and Calendar. Consequential actions stop for approval.</Text></View>
        <Image source={{uri:GOGO}} style={s.heroGogo}/>
      </View>

      <View style={s.commandCard}>
        <Text style={s.commandLabel}>ASK GOGO TO DO SOMETHING</Text>
        <View style={s.commandRow}><TextInput value={command} onChangeText={setCommand} placeholder="e.g. Remind me Friday at 8 AM to book the hotel" placeholderTextColor="#A49387" style={s.commandInput} multiline maxLength={2000}/><Pressable onPress={run} disabled={!command.trim()||runningCommand} style={[s.runBtn,(!command.trim()||runningCommand)&&{opacity:.45}]}>{runningCommand?<ActivityIndicator size="small" color="white"/>:<Ionicons name="arrow-up" size={19} color="white"/>}</Pressable></View>
        <View style={s.suggestions}>{['Find my passport','Add milk to groceries','Remind me tomorrow 9 AM'].map(x=><Pressable key={x} onPress={()=>setCommand(x)} style={s.suggestion}><Text style={s.suggestionText}>{x}</Text></Pressable>)}</View>
      </View>

      {!!latest&&<View style={[s.resultCard,latest.status==='completed'?{backgroundColor:C.mint}:{backgroundColor:C.orangeSoft}]}><Ionicons name={latest.status==='completed'?'checkmark-circle':'hand-left'} size={21} color={latest.status==='completed'?C.green:C.orange}/><View style={{flex:1}}><Text style={s.resultTitle}>{latest.status==='completed'?'Done':'Gogo needs your approval'}</Text><Text style={s.resultText}>{latest.text||latest.blockedReason||`${latest.capability} · ${latest.risk} risk`}</Text></View></View>}
      {!!error&&<View style={s.errorCard}><Ionicons name="alert-circle-outline" size={18} color={C.red}/><Text style={s.errorText}>{error}</Text></View>}

      <View style={s.segment}>
        <Segment label="Activity" icon="pulse-outline" on={view==='activity'} onPress={()=>setView('activity')}/>
        <Segment label="Goals" icon="flag-outline" on={view==='goals'} onPress={()=>setView('goals')}/>
        <Segment label="Ideas" icon="sparkles-outline" on={view==='ideas'} onPress={()=>setView('ideas')}/>
        <Segment label="Safe" icon="shield-checkmark-outline" on={view==='permissions'} onPress={()=>setView('permissions')}/>
      </View>

      {view==='activity'&&<>
        <Section title="Gogo Activity" right={`${runs.length} recent`}/>
        {!runs.length&&<Empty icon="pulse-outline" title="No agent runs yet" text="Give Gogo a command above. The same action history will be visible across the app and WhatsApp-backed account."/>}
        {runs.map(run=><View key={run.id} style={s.card}><View style={s.rowTop}><View style={[s.iconBox,{backgroundColor:run.status==='waiting_approval'?C.orangeSoft:C.blue}]}><Ionicons name={run.status==='watching'?'eye-outline':run.status==='waiting_approval'?'hand-left-outline':'flash-outline'} size={18} color={run.status==='waiting_approval'?C.orange:'#4775A8'}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{run.title}</Text><Text style={s.cardText}>{run.summary}</Text></View><Status status={run.status}/></View>{typeof run.progress==='number'&&<View style={s.progressTrack}><View style={[s.progressFill,{width:`${run.progress}%`} as any]}/></View>}{run.why&&<View style={s.why}><Ionicons name="information-circle-outline" size={15} color={C.muted}/><Text style={s.whyText}>{run.why}</Text></View>}</View>)}

        <Section title="Waiting for you" right={`${snapshot?.approvals.length||0} approvals`}/>
        {!snapshot?.approvals.length&&<View style={s.clearLine}><Ionicons name="shield-checkmark" size={16} color={C.green}/><Text style={s.clearText}>Nothing is waiting for approval.</Text></View>}
        {snapshot?.approvals.map(a=><ApprovalCard key={a.id} approval={a} busy={busyApproval===a.id} onDecision={(d)=>decide(a,d)}/>)}

        {!!snapshot?.artifacts.length&&<><Section title="Artifacts" right="durable outputs"/><View style={s.twoCol}>{snapshot.artifacts.map(a=><View key={a.id} style={s.miniCard}><Ionicons name={a.type==='trip'?'airplane-outline':'clipboard-outline'} size={20} color={C.orange}/><Text style={s.miniTitle}>{a.title}</Text><Text style={s.miniText}>{a.subtitle||a.type.replaceAll('_',' ')}</Text></View>)}</View></>}
      </>}

      {view==='goals'&&<>
        <Section title="Goals" right="outcomes, not chores"/>
        {!snapshot?.goals.length&&<Empty icon="flag-outline" title="No goals yet" text="Goals will let Gogo coordinate several actions and background watches toward one outcome."/>}
        {snapshot?.goals.map(goal=><View key={goal.id} style={s.card}><View style={s.rowTop}><View style={[s.iconBox,{backgroundColor:C.lavender}]}><Ionicons name="flag-outline" size={18} color="#6658B5"/></View><View style={{flex:1}}><Text style={s.cardTitle}>{goal.title}</Text><Text style={s.cardText}>{goal.outcome}</Text></View><Text style={s.progressNumber}>{goal.progress}%</Text></View><View style={s.progressTrack}><View style={[s.progressFill,{width:`${goal.progress}%`} as any]}/></View>{goal.nextAction&&<View style={s.detailRow}><Text style={s.detailLabel}>Next</Text><Text style={s.detailValue}>{goal.nextAction}</Text></View>}</View>)}
      </>}

      {view==='ideas'&&<>
        <Section title="Ideas for you" right="proactive, not noisy"/>
        {!snapshot?.ideas.length&&<Empty icon="sparkles-outline" title="No proactive ideas right now" text="Gogo will only surface useful opportunities or blockers when there is enough context."/>}
        {snapshot?.ideas.map(idea=><View key={idea.id} style={[s.card,{backgroundColor:'#FFF9F0'}]}><View style={s.rowTop}><View style={[s.iconBox,{backgroundColor:C.orangeSoft}]}><Ionicons name="sparkles" size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{idea.title}</Text><Text style={s.cardText}>{idea.reason}</Text></View></View><View style={s.valueBox}><Text style={s.valueLabel}>WHY IT MAY HELP</Text><Text style={s.valueText}>{idea.expectedValue}</Text></View></View>)}
      </>}

      {view==='permissions'&&<>
        <Section title="Gogo Safe Mode" right="server enforced"/>
        <View style={s.safetyCard}><Ionicons name="shield-checkmark" size={25} color="#41835A"/><View style={{flex:1}}><Text style={s.safetyTitle}>The model cannot grant itself permission.</Text><Text style={s.safetyText}>Sending, submitting, destructive calendar changes, booking and paying remain approval-gated. Tap a capability to cycle its allowed level.</Text></View></View>
        {snapshot?.permissions.map(p=><Pressable key={p.capability} onPress={()=>changePermission(p)} disabled={!!busyPermission} style={s.permission}><View style={s.permissionIcon}><Ionicons name={capabilityIcon(p.capability)} size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{p.label}</Text><Text style={s.cardText}>{p.description}</Text>{p.irreversibleAlwaysAsk&&<Text style={s.alwaysAsk}>Consequential actions always ask</Text>}</View><View style={s.levelBadge}>{busyPermission===p.capability?<ActivityIndicator size="small" color={C.orange}/>:<Text style={s.levelText}>{p.level.toUpperCase()}</Text>}</View></Pressable>)}
      </>}

      <View style={s.liveNote}><Ionicons name="git-merge-outline" size={17} color={C.green}/><Text style={s.liveNoteText}><Text style={{fontWeight:'800'}}>Same-brain mode:</Text> native commands are routed through the same AskGogo feature router and message engine used by WhatsApp. There is no separate mobile memory or reminder engine.</Text></View>
    </ScrollView>}
  </SafeAreaView>
}

function capabilityIcon(c:string):any{if(c==='email')return'mail-outline';if(c==='calendar')return'calendar-outline';if(c==='browser')return'globe-outline';if(c==='payments')return'card-outline';if(c==='reminders')return'alarm-outline';if(c==='lists')return'list-outline';if(c==='tasks')return'checkbox-outline';if(c==='files')return'document-outline';return'lock-closed-outline'}
function Segment({label,icon,on,onPress}:{label:string;icon:any;on:boolean;onPress:()=>void}){return <Pressable style={[s.segmentBtn,on&&s.segmentOn]} onPress={()=>{Haptics.selectionAsync();onPress()}}><Ionicons name={icon} size={17} color={on?C.orange:C.muted}/><Text style={[s.segmentText,on&&{color:C.orange}]}>{label}</Text></Pressable>}
function Section({title,right}:{title:string;right?:string}){return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text><Text style={s.sectionRight}>{right}</Text></View>}
function Status({status}:{status:AgentRunStatus}){const hot=status==='waiting_approval';return <View style={[s.status,hot&&{backgroundColor:C.orangeSoft}]}><Text style={[s.statusText,hot&&{color:C.orange}]}>{statusLabel[status]}</Text></View>}
function Empty({icon,title,text}:{icon:any;title:string;text:string}){return <View style={s.empty}><Ionicons name={icon} size={21} color={C.orange}/><View style={{flex:1}}><Text style={s.cardTitle}>{title}</Text><Text style={s.cardText}>{text}</Text></View></View>}
function ApprovalCard({approval,busy,onDecision}:{approval:AgentApproval;busy:boolean;onDecision:(d:'approve'|'reject')=>void}){return <View style={[s.card,s.approvalCard]}><View style={s.rowTop}><View style={[s.iconBox,{backgroundColor:C.orangeSoft}]}><Ionicons name="hand-left" size={19} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{approval.title}</Text><Text style={s.cardText}>{approval.description}</Text></View></View>{(approval.preview||[]).map((p,i)=><View key={i} style={s.previewRow}><Text style={s.previewLabel}>{p.label}</Text><Text style={s.previewValue}>{p.value}</Text></View>)}<View style={s.actions}><Pressable disabled={busy} onPress={()=>onDecision('reject')} style={s.secondary}><Text style={s.secondaryText}>Not now</Text></Pressable><Pressable disabled={busy} onPress={()=>onDecision('approve')} style={s.primary}>{busy?<ActivityIndicator size="small" color="white"/>:<Text style={s.primaryText}>Approve & run</Text>}</Pressable></View></View>}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},center:{flex:1,alignItems:'center',justifyContent:'center',gap:10},loadingText:{fontSize:11,color:C.muted},header:{height:70,paddingHorizontal:17,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line},brand:{flexDirection:'row',alignItems:'center',gap:9},avatar:{width:40,height:40},title:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},subtitle:{fontSize:8.5,color:C.muted,marginTop:1},headActions:{flexDirection:'row',gap:7,alignItems:'center'},refresh:{width:34,height:34,borderRadius:17,backgroundColor:'white',borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},liveBadge:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'white',borderWidth:1,borderColor:C.line,paddingHorizontal:9,paddingVertical:7,borderRadius:999},liveDot:{width:6,height:6,borderRadius:3,backgroundColor:C.green},liveText:{fontSize:7.5,fontWeight:'900',color:C.green,letterSpacing:.6},content:{padding:15,paddingBottom:55},hero:{minHeight:166,borderRadius:27,backgroundColor:C.cocoa,padding:18,flexDirection:'row',overflow:'hidden'},heroKicker:{fontSize:8.5,letterSpacing:1.3,fontWeight:'900',color:'#F4A56D'},heroTitle:{fontFamily:'serif',fontSize:25,lineHeight:28,fontWeight:'700',color:'white',maxWidth:260,marginTop:7},heroText:{fontSize:10,lineHeight:15,color:'#D9C9BE',maxWidth:250,marginTop:6},heroGogo:{width:105,height:105,position:'absolute',right:0,bottom:0},commandCard:{marginTop:11,borderRadius:22,backgroundColor:C.paper,borderWidth:1,borderColor:C.line,padding:13},commandLabel:{fontSize:8,fontWeight:'900',letterSpacing:1.1,color:C.orange,marginBottom:8},commandRow:{minHeight:50,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:'white',flexDirection:'row',alignItems:'center',paddingLeft:12},commandInput:{flex:1,minHeight:46,maxHeight:96,fontSize:11,color:C.ink,paddingVertical:9},runBtn:{width:38,height:38,borderRadius:13,backgroundColor:C.orange,alignItems:'center',justifyContent:'center',marginRight:5},suggestions:{flexDirection:'row',gap:5,flexWrap:'wrap',marginTop:8},suggestion:{paddingHorizontal:8,paddingVertical:6,borderRadius:999,backgroundColor:'#F5EFE8'},suggestionText:{fontSize:7.5,color:C.muted,fontWeight:'700'},resultCard:{marginTop:10,borderRadius:18,padding:12,flexDirection:'row',gap:9,alignItems:'flex-start'},resultTitle:{fontSize:11,fontWeight:'900',color:C.ink},resultText:{fontSize:9,lineHeight:14,color:C.muted,marginTop:2},errorCard:{marginTop:10,borderRadius:16,padding:11,backgroundColor:'#FFF0EC',flexDirection:'row',gap:7},errorText:{flex:1,fontSize:9,lineHeight:14,color:C.red},segment:{marginTop:12,padding:4,borderRadius:17,backgroundColor:'#EDE4DC',flexDirection:'row'},segmentBtn:{flex:1,minHeight:52,alignItems:'center',justifyContent:'center',gap:3,borderRadius:14},segmentOn:{backgroundColor:'white'},segmentText:{fontSize:7.5,fontWeight:'800',color:C.muted},section:{marginTop:20,marginBottom:9,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',paddingHorizontal:2},sectionTitle:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},sectionRight:{fontSize:8.5,color:C.muted},card:{borderRadius:21,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:14,marginBottom:9},rowTop:{flexDirection:'row',gap:10,alignItems:'flex-start'},iconBox:{width:38,height:38,borderRadius:13,alignItems:'center',justifyContent:'center'},cardTitle:{fontSize:11,fontWeight:'800',color:C.ink},cardText:{fontSize:9,lineHeight:14,color:C.muted,marginTop:2},status:{borderRadius:999,paddingHorizontal:8,paddingVertical:5,backgroundColor:'#EEF3F6'},statusText:{fontSize:7.5,fontWeight:'900',color:'#637985'},progressTrack:{height:6,borderRadius:99,backgroundColor:'#EEE6DF',overflow:'hidden',marginTop:12},progressFill:{height:'100%',backgroundColor:C.orange,borderRadius:99},progressNumber:{fontFamily:'serif',fontSize:19,fontWeight:'700',color:C.orange},why:{marginTop:10,padding:9,borderRadius:13,backgroundColor:'#F7F3EF',flexDirection:'row',gap:6,alignItems:'flex-start'},whyText:{flex:1,fontSize:8.5,lineHeight:13,color:C.muted},approvalCard:{borderColor:'rgba(244,123,32,.35)',backgroundColor:'#FFF9F4'},previewRow:{flexDirection:'row',justifyContent:'space-between',gap:10,paddingVertical:7,borderTopWidth:1,borderTopColor:C.line},previewLabel:{fontSize:8,color:C.muted},previewValue:{fontSize:8.5,fontWeight:'800',color:C.ink,maxWidth:'70%',textAlign:'right'},actions:{flexDirection:'row',gap:8,marginTop:10},secondary:{flex:1,minHeight:38,borderRadius:13,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},secondaryText:{fontSize:9,fontWeight:'800',color:C.ink},primary:{flex:1.25,minHeight:38,borderRadius:13,backgroundColor:C.cocoa,alignItems:'center',justifyContent:'center'},primaryText:{fontSize:9,fontWeight:'800',color:'white'},clearLine:{padding:11,borderRadius:16,backgroundColor:C.mint,flexDirection:'row',gap:7,alignItems:'center',marginBottom:8},clearText:{fontSize:9,color:C.green,fontWeight:'700'},twoCol:{flexDirection:'row',flexWrap:'wrap',gap:8},miniCard:{width:'48.7%',minHeight:94,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:12},miniTitle:{fontSize:10,fontWeight:'800',color:C.ink,marginTop:10},miniText:{fontSize:8,lineHeight:12,color:C.muted,marginTop:3},detailRow:{flexDirection:'row',gap:8,marginTop:10},detailLabel:{fontSize:8,fontWeight:'900',color:C.orange,width:32},detailValue:{flex:1,fontSize:9,color:C.muted},valueBox:{marginTop:10,padding:10,borderRadius:14,backgroundColor:C.orangeSoft},valueLabel:{fontSize:7,fontWeight:'900',letterSpacing:.8,color:C.orange},valueText:{fontSize:9,lineHeight:14,color:C.ink,marginTop:3},safetyCard:{borderRadius:20,backgroundColor:C.mint,padding:14,flexDirection:'row',gap:10,marginBottom:10},safetyTitle:{fontSize:11,fontWeight:'900',color:C.ink},safetyText:{fontSize:8.5,lineHeight:13,color:C.muted,marginTop:3},permission:{borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:12,marginBottom:7,flexDirection:'row',gap:9,alignItems:'center'},permissionIcon:{width:37,height:37,borderRadius:12,backgroundColor:C.orangeSoft,alignItems:'center',justifyContent:'center'},alwaysAsk:{fontSize:7.5,color:C.orange,fontWeight:'800',marginTop:4},levelBadge:{minWidth:54,minHeight:29,paddingHorizontal:7,borderRadius:10,backgroundColor:'#F3EEE9',alignItems:'center',justifyContent:'center'},levelText:{fontSize:7,fontWeight:'900',color:C.ink},empty:{borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:13,flexDirection:'row',gap:10,marginBottom:8},liveNote:{marginTop:20,borderRadius:18,padding:12,backgroundColor:'#EFF8F2',flexDirection:'row',gap:8},liveNoteText:{flex:1,fontSize:8.5,lineHeight:13,color:C.muted}
})
