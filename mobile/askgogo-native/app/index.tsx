import { useEffect, useState } from 'react'
import { ActivityIndicator, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

export default function BootScreen() {
  const router = useRouter()
  const [status, setStatus] = useState('Starting AskGogo…')

  useEffect(()=>{void route()},[])

  async function route() {
    setStatus('Checking secure session…')
    try {
      const { hasMobileSession } = await import('../src/auth/session')
      const linked = await hasMobileSession()
      setStatus(linked ? 'Same Gogo found. Opening…' : 'Ready to connect WhatsApp…')
      setTimeout(() => router.replace(linked ? '/agent-safe' : '/connect'), 180)
    } catch (error: any) {
      setStatus(`Startup check failed: ${String(error?.message || error || 'unknown error')}`)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.wrap}>
        <View style={s.logo}><Text style={s.logoText}>G</Text></View>
        <ActivityIndicator color="#F47B20" size="large" />
        <Text style={s.title}>AskGogo</Text>
        <Text style={s.status}>{status}</Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F0E8' },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 26 },
  logo: { width: 68, height: 68, borderRadius: 23, backgroundColor: '#F47B20', alignItems: 'center', justifyContent: 'center', marginBottom: 24 },
  logoText: { color: '#FFFFFF', fontSize: 32, fontWeight: '900' },
  title: { color: '#3A2418', fontSize: 26, fontWeight: '900', marginTop: 18 },
  status: { color: '#806D61', fontSize: 13, marginTop: 8, textAlign: 'center' },
})
