import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'expo-router'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EmptyState, QuietCard, ScreenTitle, SectionLabel, StatusDot } from '../../src/design/components'
import { agentApi } from '../../src/agent/api'
import type { AgentHomeSnapshot, AgentRun } from '../../src/agent/types'
import { useTheme } from '../../src/theme'

export default function Activity(){
 const t=useTheme();const r=useRouter();const i=useSafeAreaInsets();const [snap,setSnap]=useState<AgentHomeSnapshot|null>(null);const [refreshing,setRefreshing]=useState(false);const [error,setError]=useState('')
 const refresh=useCallback(async()=>{try{setSnap(await agentApi.snapshot());setError('')}catch(e:any){setError(e?.message||'Could not load activity.')}finally{setRefreshing(false)}},[])
 useEffect(()=>{refresh();const id=setInterval(refresh,10000);return()=>clearInterval(id)},[refresh])
 const working=useMemo(()=>(snap?.runs||[]).filter(x=>['queued','running','waiting_approval','paused'].includes(x.status)),[snap])
 const done=useMemo(()=>(snap?.runs||[]).filter(x=>x.status==='completed').slice(0,10),[snap])
 return <ScrollView style={{flex:1,backgroundColor:t.paper}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);refresh()}}/>} contentContainerStyle={[s.wrap,{paddingTop:i.top+28,paddingBottom:96+i.bottom}]}>
  <ScreenTitle eyebrow="Activity" title="What Gogo is doing." body="Active work, watchers, approvals and completed actions update here from the same live agent state."/>
  {error?<Text style={s.error}>{error}</Text>:null}
  <SectionLabel>Working · {working.length}</SectionLabel>{working.length?working.map(x=><RunCard key={x.id} run={x} onPress={()=>r.push('/agent-safe')}/>):<EmptyState icon="sparkles-outline" title="Nothing running" body="Ask Gogo for an outcome and the live steps will appear here."/>}
  <SectionLabel>Watching · {snap?.watchers.length||0}</SectionLabel>{snap?.watchers.length?snap.watchers.map(w=><View key={w.id} style={s.gap}><QuietCard onPress={()=>r.push('/agent-safe')}><View style={s.row}><StatusDot kind="watching"/><View style={{flex:1}}><Text style={[s.title,{color:t.ink}]}>{w.title}</Text><Text style={[s.body,{color:t.ink2}]}>{w.type.replaceAll('_',' ')} · checks every {w.cadenceMinutes} min</Text><Text style={[s.time,{color:t.ink3}]}>Next {format(w.nextCheckAt)}</Text></View></View></QuietCard></View>):null}
  <SectionLabel>Done · {done.length}</SectionLabel>{done.length?done.map(x=><RunCard key={x.id} run={x} onPress={()=>r.push('/agent-safe')}/>):null}
 </ScrollView>
}
function RunCard({run,onPress}:{run:AgentRun;onPress:()=>void}){const t=useTheme();const kind=run.status==='waiting_approval'?'needsYou':run.status==='completed'?'done':'working';return <View style={s.gap}><QuietCard onPress={onPress}><View style={s.row}><StatusDot kind={kind}/><View style={{flex:1}}><Text style={[s.kind,{color:t.ink3}]}>{run.status.replaceAll('_',' ').toUpperCase()}</Text><Text style={[s.title,{color:t.ink}]}>{run.title}</Text><Text style={[s.body,{color:t.ink2}]}>{run.summary}</Text>{typeof run.progress==='number'?<View style={[s.track,{backgroundColor:t.paper}]}><View style={[s.fill,{width:`${Math.max(0,Math.min(100,run.progress))}%`} as any]}/></View>:null}<Text style={[s.time,{color:t.ink3}]}>Updated {format(run.updatedAt)}</Text></View></View></QuietCard></View>}
function format(v?:string|null){if(!v)return'when needed';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString():'when needed'}
const s=StyleSheet.create({wrap:{paddingHorizontal:20},error:{fontSize:12,color:'#B34B3E',marginBottom:10},gap:{marginBottom:10},row:{flexDirection:'row',gap:12,alignItems:'flex-start'},kind:{fontSize:9,fontWeight:'800',letterSpacing:.7},title:{fontSize:17,fontWeight:'700',marginTop:3},body:{fontSize:13,lineHeight:19,marginTop:5},time:{fontSize:10,marginTop:9},track:{height:5,borderRadius:99,overflow:'hidden',marginTop:12},fill:{height:'100%',backgroundColor:'#F26B1D',borderRadius:99}})
