import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { EmptyState, QuietCard, ScreenTitle, SectionLabel, StatusDot } from '../../src/design/components'
import { agentApi } from '../../src/agent/api'
import type { AgentConsumerHome, AgentHomeItem } from '../../src/agent/types'
import { useTheme } from '../../src/theme'

export default function Today(){
 const t=useTheme();const r=useRouter();const i=useSafeAreaInsets();const [home,setHome]=useState<AgentConsumerHome|null>(null);const [refreshing,setRefreshing]=useState(false);const [error,setError]=useState('')
 const refresh=useCallback(async()=>{try{setHome(await agentApi.home());setError('')}catch(e:any){setError(e?.message||'Could not load today.')}finally{setRefreshing(false)}},[])
 useEffect(()=>{refresh();const id=setInterval(refresh,12000);return()=>clearInterval(id)},[refresh])
 const updates=(home?.items||[]).filter(x=>x.kind==='done'||x.kind==='idea'||x.kind==='watching'||x.kind==='approval')
 return <ScrollView style={{flex:1,backgroundColor:t.paper}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);refresh()}}/>} contentContainerStyle={[s.wrap,{paddingTop:i.top+28,paddingBottom:96+i.bottom}]}>
  <ScreenTitle eyebrow="Today" title="What Gogo found." body="Reminders, watcher changes, ideas and completed work collect here without turning Home into a feed."/>
  {error?<Text style={s.error}>{error}</Text>:null}
  {updates.length?<><SectionLabel>Latest</SectionLabel>{updates.map(x=><TodayCard key={x.id} item={x} onPress={()=>r.push('/agent-safe')}/>)}</>:<EmptyState icon="sunny-outline" title="All quiet for now" body="New findings, reminders and completed work will appear here as Gogo handles your day."/>}
 </ScrollView>
}
function TodayCard({item,onPress}:{item:AgentHomeItem;onPress:()=>void}){const t=useTheme();const kind=item.kind==='approval'?'needsYou':item.kind==='watching'?'watching':item.kind==='done'?'done':'working';return <View style={s.gap}><QuietCard onPress={onPress}><View style={s.row}><StatusDot kind={kind}/><View style={{flex:1}}><Text style={[s.kind,{color:t.ink3}]}>{item.kind.toUpperCase()}</Text><Text style={[s.title,{color:t.ink}]}>{item.title}</Text><Text style={[s.body,{color:t.ink2}]}>{item.body}</Text>{item.timestamp?<Text style={[s.time,{color:t.ink3}]}>{new Date(item.timestamp).toLocaleString()}</Text>:null}</View></View></QuietCard></View>}
const s=StyleSheet.create({wrap:{paddingHorizontal:20},error:{fontSize:12,color:'#B34B3E',marginBottom:10},gap:{marginBottom:10},row:{flexDirection:'row',gap:12,alignItems:'flex-start'},kind:{fontSize:9,fontWeight:'800',letterSpacing:.7},title:{fontSize:17,fontWeight:'700',marginTop:3},body:{fontSize:13,lineHeight:19,marginTop:5},time:{fontSize:10,marginTop:9}})
