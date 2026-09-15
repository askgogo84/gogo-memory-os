import { useEffect, useMemo, useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { SettingRow } from '../../src/design/components'
import { Gogo } from '../../src/design/Gogo'
import { agentApi } from '../../src/agent/api'
import type { AgentHomeSnapshot, AgentCapability } from '../../src/agent/types'
import { clearMobileSession } from '../../src/auth/session'
import { useTheme } from '../../src/theme'

const GUARDED:AgentCapability[]=['email','calendar','browser','travel','payments']

export default function You(){
  const t=useTheme(), i=useSafeAreaInsets(), r=useRouter(); const [snap,setSnap]=useState<AgentHomeSnapshot|null>(null); const [saving,setSaving]=useState(false)
  useEffect(()=>{void agentApi.snapshot().then(setSnap).catch(()=>{})},[])
  const safeMode=useMemo(()=>{const ps=snap?.permissions.filter(p=>GUARDED.includes(p.capability))||[];return !ps.length||ps.every(p=>p.level!=='auto')},[snap])
  async function toggleSafe(next:boolean){if(!snap||saving)return;setSaving(true);try{const level=next?'ask':'auto';const changes=await Promise.all(GUARDED.map(c=>agentApi.updatePermission(c,level)));setSnap({...snap,permissions:snap.permissions.map(p=>changes.find(c=>c.capability===p.capability)||p)})}finally{setSaving(false)}}
  async function signOut(){await clearMobileSession();r.replace('/connect')}
  const go=(section:string)=>r.push({pathname:'/(tabs)/settings',params:{section}} as any)
  return <ScrollView style={{flex:1,backgroundColor:t.paper}} contentContainerStyle={[s.wrap,{paddingTop:i.top+22,paddingBottom:96+i.bottom}]}>
    <View style={s.profile}><Gogo state="calm" size={48}/><View><Text style={[s.name,{color:t.ink}]}>You</Text><Text style={[s.sub,{color:t.ink3}]}>Same Gogo everywhere</Text></View></View>
    <View style={[s.safe,{backgroundColor:t.surface}]}><View style={{flex:1}}><Text style={[s.safeTitle,{color:t.ink}]}>Safe Mode</Text><Text style={[s.safeBody,{color:t.ink2}]}>Gogo asks before it sends, books, buys, shares or cancels.</Text></View><Switch value={safeMode} disabled={!snap||saving} onValueChange={toggleSafe} trackColor={{false:'#D8D2CC',true:'#F26B1D'}} thumbColor="#fff"/></View>
    <View style={s.rows}>
      <SettingRow icon="logo-whatsapp" title="WhatsApp" subtitle="Connected · same brain" trailing="Connected" onPress={()=>go('whatsapp')}/>
      <SettingRow icon="notifications-outline" title="Notifications" subtitle="Approvals and reminders only" onPress={()=>go('notifications')}/>
      <SettingRow icon="key-outline" title="Permissions" subtitle="Calendar, Photos, Contacts" onPress={()=>go('permissions')}/>
      <SettingRow icon="phone-portrait-outline" title="Connected devices" subtitle="This phone · Web dashboard" onPress={()=>go('devices')}/>
      <SettingRow icon="shield-checkmark-outline" title="Privacy" subtitle="What Gogo remembers, and how to forget" onPress={()=>go('privacy')}/>
      <SettingRow icon="sunny-outline" title="Appearance" subtitle="Light" onPress={()=>go('appearance')}/>
      <SettingRow icon="person-circle-outline" title="Account" subtitle="Plan and account settings" onPress={()=>go('account')}/>
    </View>
    <Pressable onPress={signOut}><Text style={[s.footer,{color:t.ink3}]}>AskGogo 2.0 · Sign out</Text></Pressable>
  </ScrollView>
}
const s=StyleSheet.create({wrap:{paddingHorizontal:20},profile:{flexDirection:'row',alignItems:'center',gap:12,marginBottom:24},name:{fontSize:24,fontWeight:'700'},sub:{fontSize:11,marginTop:2},safe:{borderRadius:16,padding:14,flexDirection:'row',alignItems:'center',gap:12},safeTitle:{fontSize:15,fontWeight:'700'},safeBody:{fontSize:11,lineHeight:16,marginTop:3,maxWidth:250},rows:{marginTop:24},footer:{fontSize:10,textAlign:'center',marginTop:26,paddingVertical:14}})
