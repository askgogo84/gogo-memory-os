import { useEffect, useState } from 'react'
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { useTheme } from '../src/theme'

export default function BootScreen() {
  const router = useRouter()
  const t = useTheme()
  const [status, setStatus] = useState('Starting AskGogo…')

  useEffect(()=>{void route()},[])

  async function route() {
    setStatus('Checking secure session…')
    try {
      const { hasMobileSession } = await import('../src/auth/session')
      const linked = await hasMobileSession()
      setStatus(linked ? 'Same Gogo found. Opening…' : 'Ready to connect WhatsApp…')
      setTimeout(() => router.replace(linked ? '/(tabs)/gogo' : '/connect'), 180)
    } catch (error: any) {
      setStatus(`Startup check failed: ${String(error?.message || error || 'unknown error')}`)
    }
  }

  return <SafeAreaView style={[s.safe,{backgroundColor:t.paper}]}><View style={s.wrap}><View style={s.logo}><Text style={s.logoText}>G</Text></View><ActivityIndicator color="#F26B1D" size="large"/><Text style={[s.title,{color:t.ink}]}>AskGogo</Text><Text style={[s.status,{color:t.ink2}]}>{status}</Text></View></SafeAreaView>
}

const s=StyleSheet.create({safe:{flex:1},wrap:{flex:1,alignItems:'center',justifyContent:'center',padding:26},logo:{width:68,height:68,borderRadius:23,backgroundColor:'#F26B1D',alignItems:'center',justifyContent:'center',marginBottom:24},logoText:{color:'#FFF',fontSize:32,fontWeight:'900'},title:{fontSize:26,fontWeight:'900',marginTop:18},status:{fontSize:13,marginTop:8,textAlign:'center'}})
