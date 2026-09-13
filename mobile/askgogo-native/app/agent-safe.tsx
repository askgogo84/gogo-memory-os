import { useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { agentApi } from '../src/agent/api'
import type { AgentConsumerHome, AgentHomeItem, AgentHomeSnapshot } from '../src/agent/types'

const C={bg:'#F7F2EC',paper:'#FFFDFC',ink:'#342319',muted:'#8A776A',line:'#E8DDD4',orange:'#F47B20',orangeSoft:'#FFF0E4',green:'#2E9B67',greenSoft:'#ECF8F1',blue:'#5A7FA8',blueSoft:'#EEF5FB',lav:'#6C5FB5',lavSoft:'#F1EEFF',red:'#B64A3A'}
type Tab='gogo'|'today'|'memory'|'activity'|'you'

export default function GogoHome(){
  const router=useRouter()
  const [tab,setTab]=useState<Tab>('gogo')
  const [home,setHome]=useState<AgentConsumerHome|null>(null)
  const [snap,setSnap]=useState<AgentHomeSnapshot|null>(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')
  const [command,setCommand]=useState('')
  const [running,setRunning]=useState(false)
  const [notificationState,setNotificationState]=useState<'idle'|'working'|'done'|'error'>('idle')

  useEffect(()=>{void refresh();const t=setInterval(()=>void refresh(false),12000);return()=>clearInterval(t)},[])

  async function refresh(showSpinner=true){
    if(showSpinner)setLoading(true)
    setError('')
    try{
      let nextHome:AgentConsumerHome
      try{ nextHome=await agentApi.home() }
      catch{
        const fallback=await agentApi.snapshot()
        setSnap(fallback)
        nextHome=homeFromSnapshot(fallback)
      }
      setHome(nextHome)
      if(!snap){ try{setSnap(await agentApi.snapshot())}catch{} }
    }catch(e:any){
      setError(String(e?.message||'Could not load Gogo right now.'))
    }finally{setLoading(false)}
  }

  async function run(){
    const text=command.trim();if(!text||running)return
    setRunning(true);setError('')
    try{
      await agentApi.run(text,{screen:'mobile-home'})
      setCommand('')
      await refresh(false)
    }catch(e:any){setError(String(e?.message||'Gogo could not start that.'))}
    finally{setRunning(false)}
  }

  async function enableNotifications(){
    if(notificationState==='working')return
    setNotificationState('working')
    try{
      const {registerForGogoNotifications}=await import('../src/native/notifications')
      const result=await registerForGogoNotifications()
      setNotificationState(result?.registered?'done':'error')
    }catch{setNotificationState('error')}
  }

  const topItems=useMemo(()=>home?.items.slice(0,4)||[],[home])
  const greeting=greetingForNow()

  if(loading&&!home)return <SafeAreaView style={s.safe}><View style={s.center}><View style={s.logo}><Text style={s.logoText}>G</Text></View><ActivityIndicator color={C.orange}/><Text style={s.muted}>Opening the same Gogo you use on WhatsApp…</Text></View></SafeAreaView>

  return <SafeAreaView style={s.safe}>
    <View style={s.topbar}><View><Text style={s.brand}>AskGogo</Text><Text style={s.same}>Same brain · WhatsApp + app</Text></View><Pressable onPress={()=>void refresh()} style={s.avatar}><Text style={s.avatarText}>G</Text></Pressable></View>

    <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
      {tab==='gogo'&&<>
        <Text style={s.greeting}>{greeting}</Text>
        <Text style={s.hero}>{home?.headline||'What can Gogo take off your plate?'}</Text>
        <Text style={s.subline}>{home?.subline||'Tell Gogo the outcome. It can work, watch and come back when you are needed.'}</Text>

        <View style={s.statusRow}>
          <StatusPill n={home?.counts.working||0} label="working" tone="orange"/>
          <StatusPill n={home?.counts.watching||0} label="watching" tone="blue"/>
          <StatusPill n={home?.counts.waiting||0} label="need you" tone="green"/>
        </View>

        <View style={s.composer}>
          <TextInput value={command} onChangeText={setCommand} multiline maxLength={1800} placeholder="What can I take off your plate?" placeholderTextColor="#A69589" style={s.input}/>
          <View style={s.composerActions}>
            <Pressable onPress={()=>router.push('/capture')} style={s.roundSecondary}><Text style={s.roundSecondaryText}>＋</Text></Pressable>
            <Pressable onPress={run} disabled={!command.trim()||running} style={[s.send,(!command.trim()||running)&&{opacity:.4}]}>{running?<ActivityIndicator size="small" color="white"/>:<Text style={s.sendText}>↑</Text>}</Pressable>
          </View>
        </View>

        {!!error&&<View style={s.error}><Text style={s.errorText}>{error}</Text></View>}

        <SectionTitle title="Gogo is on it" action="See today" onPress={()=>setTab('today')}/>
        {!topItems.length?<Empty title="Nothing urgent right now" body="Ask Gogo to handle something, watch a change, or remember something for later."/>:topItems.map(item=><FeedCard key={item.id} item={item} onOpen={()=>openItem(item,router,setTab)}/>)}

        <View style={s.promise}><Text style={s.promiseKicker}>ALWAYS WORKING, NEVER SILENTLY CONSEQUENTIAL</Text><Text style={s.promiseTitle}>Gogo can keep moving in the background.</Text><Text style={s.promiseBody}>Research, reminders, monitoring and organization can continue. Sending, booking, sharing or spending pauses for your approval.</Text></View>
      </>}

      {tab==='today'&&<>
        <PageHeader title="Today" body="What Gogo found, finished, is watching, or needs from you."/>
        {!home?.items.length?<Empty title="Quiet day" body="Meaningful changes and completed work will appear here."/>:home.items.map(item=><FeedCard key={item.id} item={item} onOpen={()=>openItem(item,router,setTab)}/>)}
      </>}

      {tab==='memory'&&<>
        <PageHeader title="Memory" body="One private context across WhatsApp, mobile and web."/>
        <View style={s.memoryHero}><Text style={s.memoryNumber}>{snap?.artifacts.length||0}</Text><Text style={s.memoryLabel}>recent things Gogo created or kept organized</Text></View>
        <Pressable onPress={()=>router.push('/capture')} style={s.actionCard}><Text style={s.actionIcon}>＋</Text><View style={{flex:1}}><Text style={s.cardTitle}>Give Gogo something to remember</Text><Text style={s.cardBody}>Photo, document, voice note or file.</Text></View><Text style={s.chev}>›</Text></Pressable>
        <Pressable onPress={()=>router.push('/workspaces')} style={s.actionCard}><Text style={s.actionIcon}>▦</Text><View style={{flex:1}}><Text style={s.cardTitle}>Open workspaces</Text><Text style={s.cardBody}>Trips, research, briefs and other persistent context.</Text></View><Text style={s.chev}>›</Text></Pressable>
        {(snap?.artifacts||[]).slice(0,6).map(a=><View key={a.id} style={s.simpleCard}><Text style={s.cardTitle}>{a.title}</Text><Text style={s.cardBody}>{a.subtitle||a.type.replaceAll('_',' ')}</Text></View>)}
      </>}

      {tab==='activity'&&<>
        <PageHeader title="Activity" body="A simple view of what Gogo is doing and what already happened."/>
        {(snap?.runs||[]).slice(0,10).map(r=><View key={r.id} style={s.simpleCard}><View style={s.cardTop}><Text style={s.cardTitle}>{r.title}</Text><Text style={s.miniBadge}>{r.status.replaceAll('_',' ')}</Text></View><Text style={s.cardBody}>{r.summary}</Text>{typeof r.progress==='number'&&<View style={s.progress}><View style={[s.progressFill,{width:`${Math.max(2,Math.min(100,r.progress))}%`}]}/></View>}</View>)}
        <Pressable onPress={()=>router.push('/agent')} style={s.outlineButton}><Text style={s.outlineText}>Open advanced Agent Hub</Text></Pressable>
      </>}

      {tab==='you'&&<>
        <PageHeader title="You" body="Control how Gogo reaches you and what it is allowed to do."/>
        <View style={s.simpleCard}><Text style={s.cardTitle}>Same Gogo connected</Text><Text style={s.cardBody}>This device shares your AskGogo identity and session with the same backend used by WhatsApp.</Text></View>
        <Pressable onPress={enableNotifications} style={s.actionCard}><Text style={s.actionIcon}>◉</Text><View style={{flex:1}}><Text style={s.cardTitle}>Notifications</Text><Text style={s.cardBody}>{notificationState==='working'?'Enabling…':notificationState==='done'?'Enabled on this device':notificationState==='error'?'Tap to retry':'Let Gogo reach you when something matters.'}</Text></View><Text style={s.chev}>›</Text></Pressable>
        <View style={s.simpleCard}><Text style={s.cardTitle}>Safety</Text><Text style={s.cardBody}>Consequential actions remain approval-gated. Secure Computer and Sentinel enforce the backend policy, not just the screen.</Text></View>
        <Pressable onPress={()=>router.push('/agent')} style={s.outlineButton}><Text style={s.outlineText}>Open permissions & Safe Mode</Text></Pressable>
      </>}
      <View style={{height:90}}/>
    </ScrollView>

    <View style={s.nav}><Nav label="Gogo" active={tab==='gogo'} onPress={()=>setTab('gogo')}/><Nav label="Today" active={tab==='today'} onPress={()=>setTab('today')}/><Nav label="Memory" active={tab==='memory'} onPress={()=>setTab('memory')}/><Nav label="Activity" active={tab==='activity'} onPress={()=>setTab('activity')}/><Nav label="You" active={tab==='you'} onPress={()=>setTab('you')}/></View>
  </SafeAreaView>
}

function homeFromSnapshot(snap:AgentHomeSnapshot):AgentConsumerHome{
  const active=snap.runs.filter(r=>['queued','running','watching','waiting_approval'].includes(r.status))
  const working=active.filter(r=>['queued','running'].includes(r.status)).length
  const watching=snap.watchers.length+active.filter(r=>r.status==='watching').length
  const waiting=snap.approvals.length
  const items:AgentHomeItem[]=[
    ...snap.approvals.map(a=>({id:`approval:${a.id}`,kind:'approval' as const,title:a.title,body:a.description,approvalId:a.id,runId:a.runId,actionLabel:'Review'})),
    ...active.slice(0,5).map(r=>({id:`run:${r.id}`,kind:'working' as const,title:r.title,body:r.summary,runId:r.id,progress:r.progress,actionLabel:'View activity'})),
    ...snap.watchers.slice(0,4).map(w=>({id:`watch:${w.id}`,kind:'watching' as const,title:w.title,body:'Gogo is watching this in the background.',watcherId:w.id,actionLabel:'Open watch'})),
    ...snap.ideas.slice(0,4).map(i=>({id:`idea:${i.id}`,kind:'idea' as const,title:i.title,body:i.reason,ideaId:i.id,actionLabel:i.actionLabel})),
    ...snap.runs.filter(r=>r.status==='completed').slice(0,3).map(r=>({id:`done:${r.id}`,kind:'done' as const,title:r.title,body:r.summary,runId:r.id,actionLabel:'See result'})),
  ]
  return {surface:snap.surface,state:waiting?'waiting':working?'working':watching?'watching':items.length?'ready':'idle',counts:{working,watching,waiting,ideas:snap.ideas.length},headline:waiting?`${waiting} ${waiting===1?'thing needs':'things need'} you.`:working?`Gogo is working on ${working} ${working===1?'thing':'things'}.`:watching?`Gogo is watching ${watching} ${watching===1?'thing':'things'} for you.`:'What can Gogo take off your plate?',subline:'Your memory, tools, approvals and activity stay shared with WhatsApp.',items}
}

function greetingForNow(){const h=new Date().getHours();return h<12?'Good morning.':h<17?'Good afternoon.':'Good evening.'}
function openItem(item:AgentHomeItem,router:any,setTab:(t:Tab)=>void){if(item.kind==='approval'||item.kind==='working'||item.kind==='done'){setTab('activity');return}if(item.kind==='watching'){setTab('today');return}if(item.kind==='idea'){setTab('gogo');return}router.push('/agent')}
function StatusPill({n,label,tone}:{n:number;label:string;tone:'orange'|'blue'|'green'}){const bg=tone==='orange'?C.orangeSoft:tone==='blue'?C.blueSoft:C.greenSoft;const fg=tone==='orange'?C.orange:tone==='blue'?C.blue:C.green;return <View style={[s.statusPill,{backgroundColor:bg}]}><Text style={[s.statusNum,{color:fg}]}>{n}</Text><Text style={s.statusLabel}>{label}</Text></View>}
function SectionTitle({title,action,onPress}:{title:string;action:string;onPress:()=>void}){return <View style={s.sectionHead}><Text style={s.sectionTitle}>{title}</Text><Pressable onPress={onPress}><Text style={s.sectionAction}>{action}</Text></Pressable></View>}
function PageHeader({title,body}:{title:string;body:string}){return <View style={{marginBottom:22}}><Text style={s.pageTitle}>{title}</Text><Text style={s.pageBody}>{body}</Text></View>}
function Empty({title,body}:{title:string;body:string}){return <View style={s.empty}><Text style={s.cardTitle}>{title}</Text><Text style={s.cardBody}>{body}</Text></View>}
function FeedCard({item,onOpen}:{item:AgentHomeItem;onOpen:()=>void}){const tone=item.kind==='approval'?C.orangeSoft:item.kind==='working'?C.blueSoft:item.kind==='watching'?C.lavSoft:item.kind==='idea'?'#FFF8E8':C.greenSoft;const glyph=item.kind==='approval'?'!':item.kind==='working'?'↗':item.kind==='watching'?'◌':item.kind==='idea'?'✦':'✓';return <Pressable onPress={onOpen} style={s.feedCard}><View style={[s.feedGlyph,{backgroundColor:tone}]}><Text style={s.feedGlyphText}>{glyph}</Text></View><View style={{flex:1}}><View style={s.cardTop}><Text style={s.cardTitle}>{item.title}</Text>{item.kind==='approval'&&<Text style={s.needYou}>NEEDS YOU</Text>}</View><Text style={s.cardBody}>{item.body}</Text>{typeof item.progress==='number'&&<View style={s.progress}><View style={[s.progressFill,{width:`${Math.max(2,Math.min(100,item.progress))}%`}]}/></View>}{item.actionLabel&&<Text style={s.cardAction}>{item.actionLabel} ›</Text>}</View></Pressable>}
function Nav({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}){return <Pressable onPress={onPress} style={s.navItem}><View style={[s.navDot,active&&s.navDotActive]}/><Text style={[s.navText,active&&s.navTextActive]}>{label}</Text></Pressable>}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},center:{flex:1,alignItems:'center',justifyContent:'center',padding:28,gap:14},logo:{width:58,height:58,borderRadius:20,backgroundColor:C.orange,alignItems:'center',justifyContent:'center'},logoText:{color:'white',fontSize:27,fontWeight:'900'},muted:{color:C.muted,fontSize:13,textAlign:'center'},topbar:{paddingHorizontal:22,paddingTop:10,paddingBottom:10,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{fontSize:18,fontWeight:'900',color:C.ink},same:{fontSize:10.5,color:C.muted,marginTop:2},avatar:{width:38,height:38,borderRadius:14,backgroundColor:C.orange,alignItems:'center',justifyContent:'center'},avatarText:{color:'white',fontWeight:'900',fontSize:18},content:{paddingHorizontal:22,paddingTop:24},greeting:{fontSize:14,color:C.muted,fontWeight:'700'},hero:{fontSize:36,lineHeight:40,fontWeight:'800',color:C.ink,letterSpacing:-1.2,marginTop:8,maxWidth:360},subline:{fontSize:14,lineHeight:21,color:C.muted,marginTop:12,maxWidth:350},statusRow:{flexDirection:'row',gap:8,marginTop:18},statusPill:{flex:1,borderRadius:18,paddingVertical:11,paddingHorizontal:12},statusNum:{fontSize:18,fontWeight:'900'},statusLabel:{fontSize:10.5,color:C.muted,fontWeight:'700',marginTop:2},composer:{marginTop:20,backgroundColor:C.paper,borderRadius:25,borderWidth:1,borderColor:C.line,padding:15,shadowColor:'#000',shadowOpacity:.04,shadowRadius:12,shadowOffset:{width:0,height:5},elevation:1},input:{minHeight:78,maxHeight:150,fontSize:17,lineHeight:24,color:C.ink,textAlignVertical:'top'},composerActions:{flexDirection:'row',justifyContent:'flex-end',gap:9,marginTop:8},roundSecondary:{width:42,height:42,borderRadius:21,backgroundColor:'#F3ECE6',alignItems:'center',justifyContent:'center'},roundSecondaryText:{fontSize:24,color:C.ink,fontWeight:'400'},send:{width:42,height:42,borderRadius:21,backgroundColor:C.ink,alignItems:'center',justifyContent:'center'},sendText:{color:'white',fontSize:22,fontWeight:'900',marginTop:-2},error:{marginTop:12,backgroundColor:'#FFF0ED',borderRadius:16,padding:13},errorText:{color:C.red,fontSize:12,lineHeight:18},sectionHead:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:28,marginBottom:11},sectionTitle:{fontSize:17,fontWeight:'900',color:C.ink},sectionAction:{fontSize:11.5,fontWeight:'800',color:C.orange},feedCard:{backgroundColor:C.paper,borderWidth:1,borderColor:C.line,borderRadius:22,padding:15,flexDirection:'row',gap:12,marginBottom:10},feedGlyph:{width:40,height:40,borderRadius:14,alignItems:'center',justifyContent:'center'},feedGlyphText:{fontSize:17,fontWeight:'900',color:C.ink},cardTop:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between',gap:8},cardTitle:{flex:1,fontSize:14,fontWeight:'900',color:C.ink},cardBody:{fontSize:12.5,lineHeight:18.5,color:C.muted,marginTop:5},cardAction:{fontSize:11.5,fontWeight:'800',color:C.orange,marginTop:9},needYou:{fontSize:8,fontWeight:'900',color:C.orange,letterSpacing:.8},progress:{height:5,borderRadius:3,backgroundColor:'#EEE5DF',overflow:'hidden',marginTop:10},progressFill:{height:5,borderRadius:3,backgroundColor:C.orange},promise:{marginTop:20,borderRadius:26,backgroundColor:C.ink,padding:22},promiseKicker:{fontSize:8.5,fontWeight:'900',letterSpacing:1.2,color:'#F8A15F'},promiseTitle:{fontSize:23,lineHeight:28,fontWeight:'800',color:'white',marginTop:9},promiseBody:{fontSize:12.5,lineHeight:19,color:'#DCCFC6',marginTop:9},pageTitle:{fontSize:34,lineHeight:39,fontWeight:'800',color:C.ink,letterSpacing:-1},pageBody:{fontSize:14,lineHeight:21,color:C.muted,marginTop:8,maxWidth:340},empty:{borderWidth:1,borderColor:C.line,borderRadius:22,padding:20,backgroundColor:C.paper},memoryHero:{backgroundColor:C.ink,borderRadius:28,padding:23,marginBottom:13},memoryNumber:{fontSize:42,fontWeight:'900',color:'white'},memoryLabel:{fontSize:13,lineHeight:19,color:'#DCCFC6',marginTop:4,maxWidth:260},actionCard:{backgroundColor:C.paper,borderWidth:1,borderColor:C.line,borderRadius:20,padding:15,flexDirection:'row',alignItems:'center',gap:12,marginBottom:10},actionIcon:{width:38,textAlign:'center',fontSize:23,color:C.orange,fontWeight:'700'},chev:{fontSize:25,color:'#B3A397'},simpleCard:{backgroundColor:C.paper,borderWidth:1,borderColor:C.line,borderRadius:20,padding:16,marginBottom:10},miniBadge:{fontSize:9,fontWeight:'800',color:C.muted,textTransform:'uppercase'},outlineButton:{minHeight:50,borderRadius:17,borderWidth:1,borderColor:'#D8CCC3',alignItems:'center',justifyContent:'center',marginTop:8},outlineText:{fontSize:12.5,fontWeight:'800',color:C.ink},nav:{position:'absolute',left:12,right:12,bottom:8,minHeight:64,borderRadius:24,backgroundColor:'#FFFDFC',borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingHorizontal:5,shadowColor:'#000',shadowOpacity:.08,shadowRadius:14,shadowOffset:{width:0,height:6},elevation:4},navItem:{alignItems:'center',justifyContent:'center',minWidth:58,gap:5,paddingVertical:8},navDot:{width:5,height:5,borderRadius:3,backgroundColor:'transparent'},navDotActive:{backgroundColor:C.orange},navText:{fontSize:9.5,fontWeight:'700',color:'#A08E82'},navTextActive:{color:C.ink,fontWeight:'900'}
})
