import { useCallback, useEffect, useMemo, useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AskInput, QuietCard, StatusDot } from '../../src/design/components'
import { agentApi } from '../../src/agent/api'
import type { AgentConsumerHome, AgentHomeItem } from '../../src/agent/types'
import { useTheme } from '../../src/theme'

const kinds={approval:'needs you',working:'working',watching:'watching',idea:'idea',done:'done'} as const
const icons={approval:'hand-left-outline',working:'sparkles-outline',watching:'eye-outline',idea:'bulb-outline',done:'checkmark-circle-outline'} as const

export default function GogoHome(){
 const t=useTheme(); const r=useRouter(); const insets=useSafeAreaInsets()
 const [q,setQ]=useState(''); const [home,setHome]=useState<AgentConsumerHome|null>(null); const [busy,setBusy]=useState(false); const [refreshing,setRefreshing]=useState(false); const [error,setError]=useState('')
 const refresh=useCallback(async()=>{try{setHome(await agentApi.home());setError('')}catch(e:any){setError(e?.message||'Could not reach Gogo right now.')}finally{setRefreshing(false)}},[])
 useEffect(()=>{refresh();const id=setInterval(refresh,10000);return()=>clearInterval(id)},[refresh])
 const top=useMemo(()=>home?.items.slice(0,2)||[],[home])
 async function send(){const text=q.trim();if(!text||busy)return;setBusy(true);setError('');try{await agentApi.run(text,{screen:'gogo-home'});setQ('');await refresh()}catch(e:any){setError(e?.message||'Gogo could not start that action.')}finally{setBusy(false)}}
 const stateKind=home?.state==='waiting'?'needsYou':home?.state==='working'?'working':home?.state==='watching'?'watching':'done'
 return <ScrollView style={{flex:1,backgroundColor:t.paper}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);refresh()}}/>} contentContainerStyle={[s.wrap,{paddingTop:insets.top+24,paddingBottom:96+insets.bottom}]}> 
  <View style={s.wordmark}><View><Text style={[s.brand,{color:t.ink}]}>AskGogo</Text><Text style={[s.same,{color:t.ink3}]}>Same brain · WhatsApp + app</Text></View><Pressable onPress={()=>r.push('/agent-safe')}><Ionicons name="grid-outline" size={22} color={t.ink2}/></Pressable></View>
  <Text style={[s.hero,{color:t.ink}]}>{home?.headline||'Everything is handled.'}</Text>
  <View style={s.status}><StatusDot kind={stateKind}/><Text style={[s.statusText,{color:t.ink2}]}>{home?.subline||'Gogo is ready'}</Text></View>
  <View style={{opacity:busy?.72/100:1}}><AskInput value={q} onChangeText={setQ} onSend={send} onAttach={()=>r.push('/capture')} onMic={()=>r.push('/capture')}/></View>
  {busy?<View style={s.running}><ActivityIndicator size="small" color="#F26B1D"/><Text style={[s.runningText,{color:t.ink2}]}>Gogo is starting that now…</Text></View>:null}
  {error?<Text style={s.error}>{error}</Text>:null}
  <View style={s.countRow}><Count n={home?.counts.waiting||0} label="Needs you"/><Count n={home?.counts.working||0} label="Working"/><Count n={home?.counts.watching||0} label="Watching"/></View>
  <Text style={[s.label,{color:t.ink3}]}>RIGHT NOW</Text>
  {top.length?top.map((item,index)=><View key={item.id} style={{marginBottom:index===top.length-1?0:12}}><HomeCard item={item} onPress={()=>r.push('/agent-safe')}/></View>):<QuietCard onPress={()=>r.push('/capture')}><View style={s.cardHead}><View style={[s.round,{backgroundColor:t.paper}]}><Ionicons name="add-outline" size={22} color={t.ink}/></View><View style={{flex:1}}><Text style={[s.cardTitle,{color:t.ink}]}>Capture anything</Text><Text style={[s.cardBody,{color:t.ink2}]}>Photo, document, voice or note. It goes to the same memory Gogo uses everywhere.</Text></View></View></QuietCard>}
 </ScrollView>
}
function Count({n,label}:{n:number;label:string}){const t=useTheme();return <View style={[s.count,{borderColor:t.hairline}]}><Text style={[s.countN,{color:t.ink}]}>{n}</Text><Text style={[s.countL,{color:t.ink3}]}>{label}</Text></View>}
function HomeCard({item,onPress}:{item:AgentHomeItem;onPress:()=>void}){const t=useTheme();return <QuietCard onPress={onPress}><View style={s.cardHead}><View style={[s.round,{backgroundColor:t.paper}]}><Ionicons name={icons[item.kind]} size={20} color={t.ink}/></View><View style={{flex:1}}><Text style={[s.meta,{color:t.ink3}]}>{kinds[item.kind].toUpperCase()}</Text><Text style={[s.cardTitle,{color:t.ink}]}>{item.title}</Text><Text style={[s.cardBody,{color:t.ink2}]}>{item.body}</Text>{typeof item.progress==='number'?<View style={[s.track,{backgroundColor:t.paper}]}><View style={[s.fill,{width:`${Math.max(0,Math.min(100,item.progress))}%`} as any]}/></View>:null}</View><Ionicons name="chevron-forward" size={18} color={t.ink3}/></View></QuietCard>}
const s=StyleSheet.create({wrap:{paddingHorizontal:20},wordmark:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brand:{fontSize:20,fontWeight:'800',letterSpacing:-.4},same:{fontSize:11,marginTop:3},hero:{fontSize:40,lineHeight:44,fontWeight:'700',letterSpacing:-1.2,marginTop:54,maxWidth:340},status:{flexDirection:'row',alignItems:'center',gap:8,marginTop:18,marginBottom:28},statusText:{fontSize:12,flex:1},running:{flexDirection:'row',gap:8,alignItems:'center',marginTop:10},runningText:{fontSize:12},error:{fontSize:12,lineHeight:18,color:'#B34B3E',marginTop:10},countRow:{flexDirection:'row',gap:8,marginTop:18},count:{flex:1,borderWidth:1,borderRadius:14,paddingHorizontal:10,paddingVertical:11},countN:{fontSize:18,fontWeight:'800'},countL:{fontSize:10,marginTop:2},label:{fontSize:11,fontWeight:'700',letterSpacing:1.05,marginTop:30,marginBottom:10},cardHead:{flexDirection:'row',gap:13,alignItems:'flex-start'},round:{width:42,height:42,borderRadius:14,alignItems:'center',justifyContent:'center'},meta:{fontSize:9,fontWeight:'800',letterSpacing:.7,marginBottom:4},cardTitle:{fontSize:18,fontWeight:'700'},cardBody:{fontSize:13,lineHeight:19,marginTop:5},track:{height:5,borderRadius:99,overflow:'hidden',marginTop:12},fill:{height:'100%',backgroundColor:'#F26B1D',borderRadius:99}})
