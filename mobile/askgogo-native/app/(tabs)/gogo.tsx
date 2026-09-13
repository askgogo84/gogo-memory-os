import { useState } from 'react'
import { Ionicons } from '@expo/vector-icons'
import { useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { AskInput, QuietCard, StatusDot } from '../../src/design/components'
import { useTheme } from '../../src/theme'

export default function GogoHome(){
 const t=useTheme(); const r=useRouter(); const insets=useSafeAreaInsets(); const [q,setQ]=useState('')
 const send=()=>{ if(q.trim()) r.push('/agent-safe'); }
 return <ScrollView style={{flex:1,backgroundColor:t.paper}} contentContainerStyle={[s.wrap,{paddingTop:insets.top+24,paddingBottom:96+insets.bottom}]}> 
  <View style={s.wordmark}><View><Text style={[s.brand,{color:t.ink}]}>AskGogo</Text><Text style={[s.same,{color:t.ink3}]}>Same brain · WhatsApp + app</Text></View><Pressable onPress={()=>r.push('/agent-safe')}><Ionicons name="grid-outline" size={22} color={t.ink2}/></Pressable></View>
  <Text style={[s.hero,{color:t.ink}]}>Everything is handled.</Text>
  <View style={s.status}><StatusDot kind="done"/><Text style={[s.statusText,{color:t.ink2}]}>Gogo is ready</Text><Text style={[s.sep,{color:t.hairline}]}>•</Text><Text style={[s.statusText,{color:t.ink3}]}>Same brain connected</Text></View>
  <AskInput value={q} onChangeText={setQ} onSend={send} onAttach={()=>r.push('/capture')} onMic={()=>r.push('/capture')}/>
  <Text style={[s.label,{color:t.ink3}]}>YOUR GOGO</Text>
  <QuietCard onPress={()=>r.push('/agent-safe')}><View style={s.cardHead}><View style={[s.round,{backgroundColor:t.paper}]}><Ionicons name="sparkles-outline" size={20} color={t.ink}/></View><View style={{flex:1}}><Text style={[s.cardTitle,{color:t.ink}]}>Open Agent Hub</Text><Text style={[s.cardBody,{color:t.ink2}]}>Goals, approvals, active work and autonomous tasks stay exactly where they are while we move them into this new experience.</Text></View><Ionicons name="chevron-forward" size={18} color={t.ink3}/></View></QuietCard>
  <View style={{height:12}}/><QuietCard onPress={()=>r.push('/capture')}><View style={s.cardHead}><View style={[s.round,{backgroundColor:t.paper}]}><Ionicons name="add-outline" size={22} color={t.ink}/></View><View style={{flex:1}}><Text style={[s.cardTitle,{color:t.ink}]}>Capture anything</Text><Text style={[s.cardBody,{color:t.ink2}]}>Photo, document, voice or note. It goes to the same memory Gogo uses everywhere.</Text></View></View></QuietCard>
 </ScrollView>
}
const s=StyleSheet.create({wrap:{paddingHorizontal:20},wordmark:{flexDirection:'row',justifyContent:'space-between',alignItems:'center'},brand:{fontSize:20,fontWeight:'800',letterSpacing:-.4},same:{fontSize:11,marginTop:3},hero:{fontSize:40,lineHeight:44,fontWeight:'700',letterSpacing:-1.2,marginTop:54,maxWidth:330},status:{flexDirection:'row',alignItems:'center',gap:8,marginTop:18,marginBottom:28},statusText:{fontSize:12},sep:{fontSize:12},label:{fontSize:11,fontWeight:'700',letterSpacing:1.05,marginTop:32,marginBottom:10},cardHead:{flexDirection:'row',gap:13,alignItems:'flex-start'},round:{width:42,height:42,borderRadius:14,alignItems:'center',justifyContent:'center'},cardTitle:{fontSize:18,fontWeight:'700'},cardBody:{fontSize:13,lineHeight:19,marginTop:5}})
