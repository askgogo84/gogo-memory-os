import { useMemo, useState } from 'react'
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { agentPreview } from '../src/agent/preview-data'
import type { AgentApproval, AgentPermission, AgentRunStatus } from '../src/agent/types'

const C = {
  bg: '#F6F0E8', paper: '#FFFDF9', ink: '#3A2418', muted: '#8C7769',
  line: 'rgba(58,36,24,.10)', orange: '#F47B20', orangeSoft: '#FFF0E4',
  cocoa: '#3A2519', mint: '#EAF8EF', blue: '#EDF7FF', lavender: '#F0EDFF', red: '#A43B2E',
}
const GOGO = 'https://app.askgogo.in/gogo-float.gif'
type AgentView = 'activity' | 'goals' | 'ideas' | 'permissions'

const statusLabel: Record<AgentRunStatus, string> = {
  queued: 'Queued', running: 'Working', watching: 'Watching', waiting_approval: 'Needs approval',
  completed: 'Completed', failed: 'Needs attention', paused: 'Paused',
}

export default function AgentHub() {
  const [view, setView] = useState<AgentView>('activity')
  const [approvalState, setApprovalState] = useState<Record<string, 'approved' | 'draft'>>({})
  const [permissionLevels, setPermissionLevels] = useState<Record<string,string>>(
    Object.fromEntries(agentPreview.permissions.map(p => [p.capability, p.level]))
  )

  const activeRuns = useMemo(() => agentPreview.runs.filter(r => r.status !== 'completed'), [])

  const changeView = (next: AgentView) => {
    Haptics.selectionAsync()
    setView(next)
  }

  return <SafeAreaView style={s.safe}>
    <View style={s.header}>
      <View style={s.brand}><Image source={{uri:GOGO}} style={s.avatar}/><View><Text style={s.title}>Gogo Agent</Text><Text style={s.subtitle}>Remember · anticipate · act</Text></View></View>
      <View style={s.liveBadge}><View style={s.liveDot}/><Text style={s.liveText}>PREVIEW</Text></View>
    </View>

    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      <View style={s.hero}>
        <View style={{flex:1}}><Text style={s.heroKicker}>GOGO IS WORKING</Text><Text style={s.heroTitle}>{activeRuns.length} things moving without you chasing them.</Text><Text style={s.heroText}>You stay in control. Anything irreversible stops for approval.</Text></View>
        <Image source={{uri:GOGO}} style={s.heroGogo}/>
      </View>

      <View style={s.segment}>
        <Segment label="Activity" icon="pulse-outline" on={view==='activity'} onPress={()=>changeView('activity')}/>
        <Segment label="Goals" icon="flag-outline" on={view==='goals'} onPress={()=>changeView('goals')}/>
        <Segment label="Ideas" icon="sparkles-outline" on={view==='ideas'} onPress={()=>changeView('ideas')}/>
        <Segment label="Safe" icon="shield-checkmark-outline" on={view==='permissions'} onPress={()=>changeView('permissions')}/>
      </View>

      {view==='activity' && <>
        <Section title="Working now" right={`${activeRuns.length} active`}/>
        {agentPreview.runs.map(run => <View key={run.id} style={s.card}>
          <View style={s.rowTop}><View style={[s.iconBox,{backgroundColor:run.status==='waiting_approval'?C.orangeSoft:C.blue}]}><Ionicons name={run.status==='watching'?'eye-outline':run.status==='waiting_approval'?'hand-left-outline':'flash-outline'} size={18} color={run.status==='waiting_approval'?C.orange:'#4775A8'}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{run.title}</Text><Text style={s.cardText}>{run.summary}</Text></View><Status status={run.status}/></View>
          {typeof run.progress==='number' && <View style={s.progressTrack}><View style={[s.progressFill,{width:`${run.progress}%`} as any]}/></View>}
          {run.why && <View style={s.why}><Ionicons name="information-circle-outline" size={15} color={C.muted}/><Text style={s.whyText}>{run.why}</Text></View>}
        </View>)}

        <Section title="Waiting for you" right="approval gate"/>
        {agentPreview.approvals.map(a => <ApprovalCard key={a.id} approval={a} decision={approvalState[a.id]} onDecision={(d)=>{setApprovalState(x=>({...x,[a.id]:d}));Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)}}/>)}

        <Section title="Artifacts" right="durable, not lost in chat"/>
        <View style={s.twoCol}>{agentPreview.artifacts.map(a => <View key={a.id} style={s.miniCard}><Ionicons name={a.type==='trip'?'airplane-outline':'clipboard-outline'} size={20} color={C.orange}/><Text style={s.miniTitle}>{a.title}</Text><Text style={s.miniText}>{a.subtitle}</Text></View>)}</View>
      </>}

      {view==='goals' && <>
        <Section title="Goals" right="outcomes, not chores"/>
        {agentPreview.goals.map(goal => <View key={goal.id} style={s.card}>
          <View style={s.rowTop}><View style={[s.iconBox,{backgroundColor:C.lavender}]}><Ionicons name="flag-outline" size={18} color="#6658B5"/></View><View style={{flex:1}}><Text style={s.cardTitle}>{goal.title}</Text><Text style={s.cardText}>{goal.outcome}</Text></View><Text style={s.progressNumber}>{goal.progress}%</Text></View>
          <View style={s.progressTrack}><View style={[s.progressFill,{width:`${goal.progress}%`} as any]}/></View>
          <View style={s.detailRow}><Text style={s.detailLabel}>Next</Text><Text style={s.detailValue}>{goal.nextAction}</Text></View>
          {!!goal.deadline && <View style={s.detailRow}><Text style={s.detailLabel}>By</Text><Text style={s.detailValue}>{goal.deadline}</Text></View>}
          <View style={s.pills}><Pill>{goal.watchers || 0} background watches</Pill>{goal.blockers?.map((b,i)=><Pill key={i} warn>{b}</Pill>)}</View>
        </View>)}
        <Pressable style={s.primaryBtn}><Ionicons name="add" size={18} color="white"/><Text style={s.primaryText}>Give Gogo a new goal</Text></Pressable>
      </>}

      {view==='ideas' && <>
        <Section title="Ideas for you" right="because Gogo has context"/>
        {agentPreview.ideas.map(idea => <View key={idea.id} style={[s.card,{backgroundColor:'#FFF9F0'}]}>
          <View style={s.ideaHead}><View style={[s.iconBox,{backgroundColor:C.orangeSoft}]}><Ionicons name="sparkles" size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{idea.title}</Text><Text style={s.source}>{idea.sourceLabel}</Text></View></View>
          <Text style={[s.cardText,{marginTop:8}]}>{idea.reason}</Text>
          <View style={s.valueBox}><Text style={s.valueLabel}>WHY IT MAY HELP</Text><Text style={s.valueText}>{idea.expectedValue}</Text></View>
          <View style={s.actions}><Pressable style={s.actionSecondary}><Text style={s.actionSecondaryText}>Not now</Text></Pressable><Pressable style={s.actionPrimary}><Text style={s.actionPrimaryText}>{idea.actionLabel}</Text></Pressable></View>
        </View>)}
      </>}

      {view==='permissions' && <>
        <Section title="Gogo Safe Mode" right="least privilege"/>
        <View style={s.safetyCard}><Ionicons name="shield-checkmark" size={25} color="#41835A"/><View style={{flex:1}}><Text style={s.safetyTitle}>Consequential actions always stop.</Text><Text style={s.safetyText}>Sending, submitting, deleting, booking and paying require deterministic approval unless a narrowly scoped safe permission is explicitly enabled.</Text></View></View>
        {agentPreview.permissions.map(p => <PermissionCard key={p.capability} permission={p} level={permissionLevels[p.capability]} onChange={(level)=>setPermissionLevels(x=>({...x,[p.capability]:level}))}/>) }
      </>}

      <View style={s.previewNote}><Ionicons name="construct-outline" size={17} color={C.orange}/><Text style={s.previewText}><Text style={{fontWeight:'800'}}>Integration status:</Text> this screen is the Sprint-A native agent surface. The next sprint connects these cards to authenticated `/api/agent/*` persistence and background execution. Preview data is intentionally labelled and is not presented as live account state.</Text></View>
    </ScrollView>
  </SafeAreaView>
}

function Segment({label,icon,on,onPress}:{label:string;icon:any;on:boolean;onPress:()=>void}){return <Pressable style={[s.segmentBtn,on&&s.segmentOn]} onPress={onPress}><Ionicons name={icon} size={17} color={on?C.orange:C.muted}/><Text style={[s.segmentText,on&&{color:C.orange}]}>{label}</Text></Pressable>}
function Section({title,right}:{title:string;right?:string}){return <View style={s.section}><Text style={s.sectionTitle}>{title}</Text><Text style={s.sectionRight}>{right}</Text></View>}
function Status({status}:{status:AgentRunStatus}){const hot=status==='waiting_approval';return <View style={[s.status,hot&&{backgroundColor:C.orangeSoft}]}><Text style={[s.statusText,hot&&{color:C.orange}]}>{statusLabel[status]}</Text></View>}
function Pill({children,warn}:{children:any;warn?:boolean}){return <View style={[s.pill,warn&&{backgroundColor:'#FFF1EC'}]}><Text style={[s.pillText,warn&&{color:C.red}]}>{children}</Text></View>}

function ApprovalCard({approval,decision,onDecision}:{approval:AgentApproval;decision?:'approved'|'draft';onDecision:(d:'approved'|'draft')=>void}){
  if(decision) return <View style={[s.card,{backgroundColor:decision==='approved'?C.mint:'#F2EEE9'}]}><Text style={s.cardTitle}>{decision==='approved'?'Approved for execution':'Kept as draft'}</Text><Text style={s.cardText}>{approval.title}. In the live agent, this decision is server-validated and written to the audit log.</Text></View>
  return <View style={[s.card,s.approvalCard]}><View style={s.approvalHead}><View style={[s.iconBox,{backgroundColor:'#FFF0E9'}]}><Ionicons name="hand-left" size={19} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{approval.title}</Text><Text style={s.cardText}>{approval.description}</Text></View></View>{approval.preview.map((p,i)=><View key={i} style={s.previewRow}><Text style={s.previewLabel}>{p.label}</Text><Text style={s.previewValue}>{p.value}</Text></View>)}<View style={s.actions}><Pressable onPress={()=>onDecision('draft')} style={s.actionSecondary}><Text style={s.actionSecondaryText}>{approval.secondaryLabel}</Text></Pressable><Pressable onPress={()=>onDecision('approved')} style={s.actionPrimary}><Text style={s.actionPrimaryText}>{approval.primaryLabel}</Text></Pressable></View></View>
}

const permissionCycle = ['off','read','draft','ask'] as const
function PermissionCard({permission,level,onChange}:{permission:AgentPermission;level:string;onChange:(level:string)=>void}){
  const next=()=>{const i=permissionCycle.indexOf(level as any);onChange(permissionCycle[(i+1)%permissionCycle.length]);Haptics.selectionAsync()}
  return <Pressable onPress={next} style={s.permission}><View style={s.permissionIcon}><Ionicons name={permission.capability==='email'?'mail-outline':permission.capability==='calendar'?'calendar-outline':permission.capability==='browser'?'globe-outline':permission.capability==='payments'?'card-outline':'lock-closed-outline'} size={18} color={C.orange}/></View><View style={{flex:1}}><Text style={s.cardTitle}>{permission.label}</Text><Text style={s.cardText}>{permission.description}</Text>{permission.irreversibleAlwaysAsk&&<Text style={s.alwaysAsk}>Irreversible actions always ask</Text>}</View><View style={s.levelBadge}><Text style={s.levelText}>{level.toUpperCase()}</Text></View></Pressable>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg}, header:{height:70,paddingHorizontal:17,flexDirection:'row',alignItems:'center',justifyContent:'space-between',borderBottomWidth:1,borderBottomColor:C.line},brand:{flexDirection:'row',alignItems:'center',gap:9},avatar:{width:40,height:40},title:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},subtitle:{fontSize:8.5,color:C.muted,marginTop:1},liveBadge:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:'white',borderWidth:1,borderColor:C.line,paddingHorizontal:9,paddingVertical:6,borderRadius:999},liveDot:{width:6,height:6,borderRadius:3,backgroundColor:C.orange},liveText:{fontSize:7.5,fontWeight:'900',color:C.orange,letterSpacing:.6},content:{padding:15,paddingBottom:50},hero:{minHeight:166,borderRadius:27,backgroundColor:C.cocoa,padding:18,flexDirection:'row',overflow:'hidden'},heroKicker:{fontSize:8.5,letterSpacing:1.3,fontWeight:'900',color:'#F4A56D'},heroTitle:{fontFamily:'serif',fontSize:25,lineHeight:28,fontWeight:'700',color:'white',maxWidth:260,marginTop:7},heroText:{fontSize:10,lineHeight:15,color:'#D9C9BE',maxWidth:250,marginTop:6},heroGogo:{width:105,height:105,position:'absolute',right:0,bottom:0},segment:{marginTop:12,padding:4,borderRadius:17,backgroundColor:'#EDE4DC',flexDirection:'row'},segmentBtn:{flex:1,minHeight:52,alignItems:'center',justifyContent:'center',gap:3,borderRadius:14},segmentOn:{backgroundColor:'white'},segmentText:{fontSize:7.5,fontWeight:'800',color:C.muted},section:{marginTop:20,marginBottom:9,flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',paddingHorizontal:2},sectionTitle:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},sectionRight:{fontSize:8.5,color:C.muted},card:{borderRadius:21,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:14,marginBottom:9},rowTop:{flexDirection:'row',gap:10,alignItems:'flex-start'},iconBox:{width:38,height:38,borderRadius:13,alignItems:'center',justifyContent:'center'},cardTitle:{fontSize:11,fontWeight:'800',color:C.ink},cardText:{fontSize:9,lineHeight:14,color:C.muted,marginTop:2},status:{borderRadius:999,paddingHorizontal:8,paddingVertical:5,backgroundColor:'#EEF3F6'},statusText:{fontSize:7.5,fontWeight:'900',color:'#637985'},progressTrack:{height:6,borderRadius:99,backgroundColor:'#EEE6DF',overflow:'hidden',marginTop:12},progressFill:{height:'100%',backgroundColor:C.orange,borderRadius:99},progressNumber:{fontFamily:'serif',fontSize:19,fontWeight:'700',color:C.orange},why:{marginTop:10,padding:9,borderRadius:13,backgroundColor:'#F7F3EF',flexDirection:'row',gap:6,alignItems:'flex-start'},whyText:{flex:1,fontSize:8.5,lineHeight:13,color:C.muted},approvalCard:{borderColor:'rgba(244,123,32,.35)',backgroundColor:'#FFF9F4'},approvalHead:{flexDirection:'row',gap:10,marginBottom:10},previewRow:{flexDirection:'row',justifyContent:'space-between',gap:10,paddingVertical:7,borderTopWidth:1,borderTopColor:C.line},previewLabel:{fontSize:8,color:C.muted},previewValue:{fontSize:8.5,fontWeight:'800',color:C.ink,flex:1,textAlign:'right'},actions:{flexDirection:'row',gap:7,marginTop:11},actionSecondary:{flex:1,height:38,borderRadius:13,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center',backgroundColor:'white'},actionPrimary:{flex:1.35,height:38,borderRadius:13,alignItems:'center',justifyContent:'center',backgroundColor:C.orange},actionSecondaryText:{fontSize:8.5,fontWeight:'800',color:C.ink},actionPrimaryText:{fontSize:8.5,fontWeight:'900',color:'white'},twoCol:{flexDirection:'row',gap:8},miniCard:{flex:1,minHeight:112,borderRadius:19,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:12},miniTitle:{fontSize:10,fontWeight:'800',color:C.ink,marginTop:12},miniText:{fontSize:8.5,lineHeight:12,color:C.muted,marginTop:3},detailRow:{flexDirection:'row',gap:9,paddingTop:10},detailLabel:{width:32,fontSize:8,fontWeight:'900',color:C.muted,textTransform:'uppercase'},detailValue:{flex:1,fontSize:9,color:C.ink,fontWeight:'700'},pills:{flexDirection:'row',flexWrap:'wrap',gap:5,marginTop:10},pill:{paddingHorizontal:8,paddingVertical:5,borderRadius:999,backgroundColor:'#F1EDE8'},pillText:{fontSize:7.5,color:C.muted,fontWeight:'700'},primaryBtn:{height:48,borderRadius:16,backgroundColor:C.cocoa,flexDirection:'row',gap:7,alignItems:'center',justifyContent:'center',marginTop:3},primaryText:{fontSize:9.5,fontWeight:'900',color:'white'},ideaHead:{flexDirection:'row',gap:10,alignItems:'center'},source:{fontSize:7.5,color:C.orange,fontWeight:'800',marginTop:2},valueBox:{marginTop:10,padding:10,borderRadius:13,backgroundColor:C.orangeSoft},valueLabel:{fontSize:7,fontWeight:'900',color:C.orange,letterSpacing:.6},valueText:{fontSize:8.5,lineHeight:13,color:C.ink,marginTop:3},safetyCard:{borderRadius:21,backgroundColor:C.mint,borderWidth:1,borderColor:'rgba(65,131,90,.16)',padding:14,flexDirection:'row',gap:10,marginBottom:9},safetyTitle:{fontSize:11,fontWeight:'900',color:'#315F40'},safetyText:{fontSize:8.5,lineHeight:13,color:'#567060',marginTop:3},permission:{borderRadius:19,borderWidth:1,borderColor:C.line,backgroundColor:'white',padding:12,marginBottom:8,flexDirection:'row',gap:9,alignItems:'center'},permissionIcon:{width:37,height:37,borderRadius:12,backgroundColor:C.orangeSoft,alignItems:'center',justifyContent:'center'},alwaysAsk:{fontSize:7.5,fontWeight:'800',color:C.red,marginTop:4},levelBadge:{paddingHorizontal:8,paddingVertical:6,borderRadius:10,backgroundColor:'#F1EDE8'},levelText:{fontSize:7,fontWeight:'900',color:C.ink},previewNote:{marginTop:20,borderRadius:18,backgroundColor:'#FFF4E8',borderWidth:1,borderColor:'rgba(244,123,32,.18)',padding:13,flexDirection:'row',gap:8},previewText:{flex:1,fontSize:8.5,lineHeight:13,color:'#715849'}
})
