import { useState } from 'react'
import { Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'

export default function BootScreen() {
  const router = useRouter()
  const [status, setStatus] = useState('App startup completed successfully.')

  async function checkSession() {
    setStatus('Checking secure session…')
    try {
      const { hasMobileSession } = await import('../src/auth/session')
      const linked = await hasMobileSession()
      setStatus(linked ? 'Secure session OK. Opening Gogo Agent…' : 'Secure storage OK. No linked account yet.')
      setTimeout(() => router.push(linked ? '/agent' : '/connect'), 350)
    } catch (error: any) {
      setStatus(`Secure session check failed: ${String(error?.message || error || 'unknown error')}`)
    }
  }

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.wrap}>
        <View style={s.logo}><Text style={s.logoText}>G</Text></View>
        <Text style={s.kicker}>ASKGOGO DEVICE TEST</Text>
        <Text style={s.title}>AskGogo started successfully.</Text>
        <Text style={s.body}>
          This launch screen intentionally uses only core React Native. If you can see it, the APK itself is starting correctly.
        </Text>

        <View style={s.statusCard}>
          <Text style={s.statusLabel}>STARTUP STATUS</Text>
          <Text style={s.statusText}>{status}</Text>
        </View>

        <Pressable style={s.primary} onPress={checkSession}>
          <Text style={s.primaryText}>Continue to AskGogo</Text>
        </Pressable>

        <Pressable style={s.secondary} onPress={() => router.push('/connect')}>
          <Text style={s.secondaryText}>Open WhatsApp connection screen directly</Text>
        </Pressable>

        <Text style={s.note}>
          If the app closes before this screen appears, the problem is native Android startup. If it closes only after Continue, the status above tells us which module is failing.
        </Text>
      </View>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#F6F0E8' },
  wrap: { flex: 1, justifyContent: 'center', padding: 26 },
  logo: { width: 64, height: 64, borderRadius: 22, backgroundColor: '#F47B20', alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  logoText: { color: '#FFFFFF', fontSize: 30, fontWeight: '900' },
  kicker: { color: '#F47B20', fontSize: 10, fontWeight: '900', letterSpacing: 1.4 },
  title: { color: '#3A2418', fontSize: 31, lineHeight: 36, fontWeight: '800', marginTop: 10 },
  body: { color: '#806D61', fontSize: 14, lineHeight: 21, marginTop: 12 },
  statusCard: { backgroundColor: '#FFFDF9', borderWidth: 1, borderColor: '#E7DDD3', borderRadius: 20, padding: 17, marginTop: 24 },
  statusLabel: { color: '#F47B20', fontSize: 9, fontWeight: '900', letterSpacing: 1.2 },
  statusText: { color: '#3A2418', fontSize: 13, lineHeight: 19, marginTop: 8 },
  primary: { minHeight: 54, borderRadius: 18, backgroundColor: '#3A2519', alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  primaryText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  secondary: { minHeight: 48, borderRadius: 16, borderWidth: 1, borderColor: '#DCCFC4', alignItems: 'center', justifyContent: 'center', marginTop: 10, paddingHorizontal: 14 },
  secondaryText: { color: '#6D584B', fontSize: 12, fontWeight: '800', textAlign: 'center' },
  note: { color: '#9A887B', fontSize: 10.5, lineHeight: 16, marginTop: 18 },
})
