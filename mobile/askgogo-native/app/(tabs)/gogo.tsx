import { useCallback, useEffect, useMemo, useState } from 'react'
import { ActivityIndicator, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AskInput, StatusDot } from '../../src/design/components'
import { agentApi } from '../../src/agent/api'
import type { AgentConsumerHome, AgentHomeItem } from '../../src/agent/types'
import { useTheme } from '../../src/theme'

const GOGO='https://app.askgogo.in/gogo-float.gif'
const iconFor={approval:'hand-left-outline',working:'sparkles-outline',watching:'eye-outline',idea:'bulb-outline',done:'checkmark-circle-outline'} as const
const labelFor={approval:'NEEDS YOU',working:'WORKING',watching:'WATCHING',idea:'FOUND',done:'DONE'} as const

export default function GogoHome(){
  const t=useTheme(); const r=useRouter(); const insets=useSafeAreaInsets()
  const [q,setQ]=useState(''); const [home,setHome]=useState<AgentConsumerHome|null>(null)
  const [busy,setBusy]=useState(false); const [refreshing,setRefreshing]=useState(false); const [error,setError]=useState('')
  const refresh=useCallback(async()=>{try{setHome(await agentApi.home());setError('')}catch(e:any){setError(e?.message||'Could not reach Gogo right now.')}finally{setRefreshing(false)}},[])
  useEffect(()=>{void refresh();const id=setInterval(()=>void refresh(),10000);return()=>clearInterval(id)},[refresh])
  const top=useMemo(()=>home?.items.slice(0,2)||[],[home])
  async function send(){const text=q.trim();if(!text||busy)return;setBusy(true);setError('');try{await agentApi.run(text,{screen:'gogo-home'});setQ('');await refresh()}catch(e:any){setError(e?.message||'Gogo could not start that action.')}finally{setBusy(false)}}
  const greeting=greetingForNow()
  const stateKind=home?.state==='waiting'?'needsYou':home?.state==='working'?'working':home?.state==='watching'?'watching':'done'
  const hero=home?.headline||'Everything is handled.'
  return <ScrollView style={{flex:1,backgroundColor:t.paper}} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);void refresh()}}/>} contentContainerStyle={[s.wrap,{paddingTop:insets.top+14,paddingBottom:96+insets.bottom}]}> 
    <View style={s.header}><Text style={[s.brand,{color:t.ink}]}>AskGogo</Text><Text style={[s.same,{color:t.ink3}]}>Same brain · WhatsApp + app</Text></View>
    <Text style={[s.greeting,{color:t.ink2}]}>{greeting}</Text>
    <Image source={{uri:GOGO}} style={s.gogo}/>
    <Text style={[s.hero,{color:t.ink}]}>{hero}</Text>
    <View style={s.summary}>
      <SummaryDot color="#F26B1D" text={`${home?.counts.waiting||0} approval${(home?.counts.waiting||0)===1?'':'s'}`}/>
      <SummaryDot color="#5B8DD6" text={`Watching ${home?.counts.watching||0}`}/>
      <SummaryDot color="#3DB283" text={`${Math.max(0,home?.items.filter(i=>i.kind==='done').length||0)} done today`}/>
    </View>
    <View style={{opacity:busy?0.72:1}}><AskInput value={q} onChangeText={setQ} onSend={send} onAttach={()=>r.push('/capture')} onMic={()=>r.push('/capture')}/></View>
    {busy?<View style={s.inline}><ActivityIndicator size="small" color="#F26B1D"/><Text style={[s.inlineText,{color:t.ink3}]}>Gogo is starting that…</Text></View>:null}
    {error?<Text style={s.error}>{error}</Text>:null}
    <View style={s.sectionRow}><Text style={[s.sectionTitle,{color:t.ink}]}>Right now</Text><Pressable onPress={()=>r.push('/(tabs)/today')}><Text style={s.link}>See today</Text></Pressable></View>
    {top.length?top.map((item,i)=><View key={item.id} style={{marginBottom:i===top.length-1?0:10}}><PriorityCard item={item}/></View>):<View style={[s.empty,{borderColor:t.hairline}]}><Text style={[s.emptyTitle,{color:t.ink}]}>All quiet.</Text><Text style={[s.emptyBody,{color:t.ink2}]}>Nothing needs your attention right now.</Text></View>}
  </ScrollView>
}

function PriorityCard({item}:{item:AgentHomeItem}){const t=useTheme();const r=useRouter();const tone=item.kind==='approval'?'#FFF4EA':item.kind==='watching'?'#EEF4FF':item.kind==='done'?'#EEF9F4':'#F7F4F0';const accent=item.kind==='watching'?'#5B8DD6':item.kind==='done'?'#3DB283':'#F26B1D';return <Pressable onPress={()=>r.push('/(tabs)/activity')} style={[s.card,{borderColor:t.hairline,backgroundColor:t.paper}]}><View style={[s.iconBox,{backgroundColor:tone}]}><Ionicons name={iconFor[item.kind]} size={20} color={accent}/></View><View style={{flex:1}}><Text style={[s.meta,{color:accent}]}>{labelFor[item.kind]}</Text><Text style={[s.cardTitle,{color:t.ink}]}>{item.title}</Text><Text style={[s.cardBody,{color:t.ink2}]} numberOfLines={3}>{item.body}</Text>{typeof item.progress==='number'?<View style={[s.track,{backgroundColor:t.surface}]}><View style={[s.fill,{width:`${Math.max(2,Math.min(100,item.progress))}%`} as any]}/></View>:null}<Text style={s.cardAction}>{item.actionLabel||'Open'} ›</Text></View></Pressable>}
function SummaryDot({color,text}:{color:string;text:string}){return <View style={s.summaryItem}><View style={[s.dot,{backgroundColor:color}]}/><Text style={s.summaryText}>{text}</Text></View>}
function greetingForNow(){const h=new Date().getHours();return h<12?'Good morning.':h<17?'Good afternoon.':'Good evening.'}

const s=StyleSheet.create({wrap:{paddingHorizontal:20},header:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{fontSize:16,fontWeight:'800',letterSpacing:-.2},same:{fontSize:10},greeting:{fontSize:13,marginTop:34},gogo:{width:54,height:54,marginTop:18},hero:{fontSize:36,lineHeight:39,fontWeight:'700',letterSpacing:-1.15,marginTop:14,maxWidth:325},summary:{flexDirection:'row',flexWrap:'wrap',gap:12,marginTop:13,marginBottom:22},summaryItem:{flexDirection:'row',alignItems:'center',gap:5},dot:{width:5,height:5,borderRadius:99},summaryText:{fontSize:10,color:'#8F8983'},inline:{flexDirection:'row',alignItems:'center',gap:7,marginTop:8},inlineText:{fontSize:11},error:{fontSize:11,lineHeight:16,color:'#B34B3E',marginTop:8},sectionRow:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:26,marginBottom:9},sectionTitle:{fontSize:15,fontWeight:'700'},link:{fontSize:12,fontWeight:'700',color:'#F26B1D'},card:{flexDirection:'row',gap:12,borderWidth:1,borderRadius:18,padding:14},iconBox:{width:40,height:40,borderRadius:14,alignItems:'center',justifyContent:'center'},meta:{fontSize:9,fontWeight:'800',letterSpacing:.75,marginBottom:5},cardTitle:{fontSize:17,lineHeight:21,fontWeight:'700'},cardBody:{fontSize:13,lineHeight:18,marginTop:5},cardAction:{fontSize:12,fontWeight:'700',color:'#F26B1D',marginTop:10},track:{height:4,borderRadius:99,overflow:'hidden',marginTop:10},fill:{height:'100%',borderRadius:99,backgroundColor:'#F26B1D'},empty:{borderWidth:1,borderRadius:18,padding:18},emptyTitle:{fontSize:17,fontWeight:'700'},emptyBody:{fontSize:13,marginTop:5}})
