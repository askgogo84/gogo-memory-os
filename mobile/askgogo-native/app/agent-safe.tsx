import { useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { getMobileAccessToken } from '../src/auth/session'

const API_BASE = process.env.EXPO_PUBLIC_ASKGOGO_API_BASE_URL || 'https://app.askgogo.in'

export default function AgentSafeEntry(){
  const router=useRouter()
  const [phase,setPhase]=useState<'checking'|'ready'|'no-session'|'error'>('checking')
  const [detail,setDetail]=useState('Checking your linked AskGogo session…')
  const [notificationState,setNotificationState]=useState<'idle'|'working'|'done'|'error'>('idle')

  useEffect(()=>{void validate()},[])

  async function validate(){
    try{
      const token=await getMobileAccessToken()
      if(!token){setPhase('no-session');setDetail('No linked mobile session was found on this device.');return}
      setDetail('Secure session found. Checking the Agent API…')
      const response=await fetch(`${API_BASE}/api/agent/snapshot`,{headers:{Accept:'application/json',Authorization:`Bearer ${token}`}})
      if(response.status===401){setPhase('no-session');setDetail('Your saved session is no longer accepted. Reconnect WhatsApp.');return}
      if(!response.ok){setPhase('error');setDetail(`Agent API returned ${response.status}. The app stayed open so we can diagnose it safely.`);return}
      const body=await response.json().catch(()=>({})) as any
      const runCount=Array.isArray(body?.runs)?body.runs.length:0
      setPhase('ready');setDetail(`Same Gogo is connected. Agent API is live${runCount?` with ${runCount} recent run${runCount===1?'':'s'}`:''}.`)
    }catch(e:any){setPhase('error');setDetail(`Agent API check failed: ${String(e?.message||e||'unknown error')}`)}
  }

  async function enableNotifications(){
    if(notificationState==='working')return
    setNotificationState('working')
    try{
      const {registerForGogoNotifications}=await import('../src/native/notifications')
      const result=await registerForGogoNotifications()
      setNotificationState(result?.registered?'done':'error')
    }catch(e:any){
      console.log('GOGO_NOTIFICATION_MANUAL_ENABLE_FAILED',String(e?.message||e))
      setNotificationState('error')
    }
  }

  return <SafeAreaView style={s.safe}><View style={s.wrap}>
    <View style={s.logo}><Text style={s.logoText}>G</Text></View>
    <Text style={s.kicker}>ONE GOGO · SAME BRAIN</Text>
    <Text style={s.title}>{phase==='ready'?'You’re connected.':'Opening your Gogo…'}</Text>
    <View style={s.card}>
      {phase==='checking'?<ActivityIndicator color="#F47B20"/>:<View style={[s.dot,phase==='ready'?s.good:phase==='error'?s.bad:s.warn]}/>} 
      <Text style={s.detail}>{detail}</Text>
    </View>

    {phase==='ready'&&<>
      <Pressable style={s.primary} onPress={()=>router.replace('/agent')}><Text style={s.primaryText}>Open Gogo Agent Hub</Text></Pressable>
      <Pressable style={s.secondary} onPress={enableNotifications} disabled={notificationState==='working'}>
        <Text style={s.secondaryText}>{notificationState==='working'?'Enabling notifications…':notificationState==='done'?'Notifications enabled ✓':notificationState==='error'?'Try notification setup again':'Enable notifications'}</Text>
      </Pressable>
      <Text style={s.note}>This screen is a temporary crash-safe bridge for device testing. If the full Agent Hub closes, this screen tells us the linked session and API are already healthy.</Text>
    </>}

    {phase==='no-session'&&<Pressable style={s.primary} onPress={()=>router.replace('/connect')}><Text style={s.primaryText}>Reconnect WhatsApp</Text></Pressable>}
    {phase==='error'&&<Pressable style={s.secondary} onPress={validate}><Text style={s.secondaryText}>Retry Agent API check</Text></Pressable>}
  </View></SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:'#F6F0E8'},wrap:{flex:1,justifyContent:'center',padding:26},logo:{width:64,height:64,borderRadius:22,backgroundColor:'#F47B20',alignItems:'center',justifyContent:'center',marginBottom:22},logoText:{color:'#fff',fontSize:30,fontWeight:'900'},kicker:{color:'#F47B20',fontSize:10,fontWeight:'900',letterSpacing:1.5},title:{color:'#3A2418',fontSize:34,lineHeight:39,fontWeight:'800',marginTop:10},card:{marginTop:24,borderRadius:22,borderWidth:1,borderColor:'#E5D8CD',backgroundColor:'#FFFDF9',padding:18,flexDirection:'row',gap:12,alignItems:'center'},dot:{width:14,height:14,borderRadius:7},good:{backgroundColor:'#2E9B67'},bad:{backgroundColor:'#B8493C'},warn:{backgroundColor:'#F47B20'},detail:{flex:1,color:'#5B473B',fontSize:14,lineHeight:21},primary:{minHeight:54,borderRadius:18,backgroundColor:'#3A2519',alignItems:'center',justifyContent:'center',marginTop:18},primaryText:{color:'#fff',fontSize:14,fontWeight:'900'},secondary:{minHeight:50,borderRadius:17,borderWidth:1,borderColor:'#DCCFC4',alignItems:'center',justifyContent:'center',marginTop:10,paddingHorizontal:14},secondaryText:{color:'#6D584B',fontSize:13,fontWeight:'800',textAlign:'center'},note:{color:'#968277',fontSize:11,lineHeight:17,marginTop:15}
})
