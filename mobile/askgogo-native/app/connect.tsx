import { useEffect, useRef, useState } from 'react'
import { Linking, Platform, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { exchangeWhatsAppLink, getWhatsAppLinkStatus, startWhatsAppLink, type MobileLinkRequest } from '../src/auth/link'

const C = { bg:'#F6F0E8', paper:'#FFFDF9', ink:'#3A2418', muted:'#8C7769', line:'rgba(58,36,24,.11)', orange:'#F47B20', orangeSoft:'#FFF0E4', green:'#2E9B67' }
const WHATSAPP_TARGET = process.env.EXPO_PUBLIC_ASKGOGO_WHATSAPP_URL || ''

export default function ConnectAskGogo() {
  const router = useRouter()
  const [link, setLink] = useState<MobileLinkRequest | null>(null)
  const [state, setState] = useState<'idle'|'starting'|'waiting'|'approved'|'linked'|'error'>('idle')
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopPolling = () => { if (timer.current) clearInterval(timer.current); timer.current = null }
  useEffect(() => () => stopPolling(), [])

  async function start() {
    setError(''); setState('starting'); stopPolling()
    try {
      const next = await startWhatsAppLink({ deviceName: `${Platform.OS} AskGogo` })
      setLink(next); setState('waiting')
      timer.current = setInterval(async () => {
        try {
          const status = await getWhatsAppLinkStatus(next.pollToken)
          if (status.status === 'approved') {
            stopPolling(); setState('approved')
            const session = await exchangeWhatsAppLink({ pollToken: next.pollToken, deviceName: `${Platform.OS} AskGogo` })
            if (session.accessToken) {
              setState('linked')
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
              setTimeout(() => router.replace('/'), 650)
            }
          } else if (status.status === 'expired' || status.status === 'exchanged') {
            stopPolling(); setState('error'); setError(status.status === 'expired' ? 'This code expired. Create a new one.' : 'This code was already used. Create a new one if this device is not linked.')
          }
        } catch {}
      }, 1800)
    } catch (e:any) {
      setState('error'); setError(e?.message || 'Could not start linking. Try again.')
    }
  }

  async function openWhatsApp() {
    if (!link) return
    const text = encodeURIComponent(link.whatsappMessage)
    const url = WHATSAPP_TARGET
      ? `${WHATSAPP_TARGET}${WHATSAPP_TARGET.includes('?') ? '&' : '?'}text=${text}`
      : `whatsapp://send?text=${text}`
    const supported = await Linking.canOpenURL(url)
    if (!supported) { setError('WhatsApp is not available on this device. Send the code to AskGogo from WhatsApp manually.'); return }
    await Linking.openURL(url)
  }

  return <SafeAreaView style={s.safe}>
    <View style={s.wrap}>
      <View style={s.icon}><Ionicons name="logo-whatsapp" size={34} color={C.green}/></View>
      <Text style={s.kicker}>ONE GOGO · SAME ACCOUNT</Text>
      <Text style={s.title}>Connect with your AskGogo WhatsApp.</Text>
      <Text style={s.body}>This links the app to the same memory, reminders, lists, calendar and Gogo you already use on WhatsApp. No second account.</Text>

      {!link && <Pressable onPress={start} disabled={state==='starting'} style={s.primary}><Text style={s.primaryText}>{state==='starting'?'Creating secure code…':'Create linking code'}</Text></Pressable>}

      {link && state!=='linked' && <View style={s.card}>
        <Text style={s.cardLabel}>SEND THIS TO ASKGOGO ON WHATSAPP</Text>
        <Text style={s.code}>{link.code}</Text>
        <Text style={s.command}>{link.whatsappMessage}</Text>
        <Text style={s.small}>The code expires in 10 minutes and can be used once.</Text>
        <Pressable onPress={openWhatsApp} style={s.primary}><Ionicons name="logo-whatsapp" size={18} color="white"/><Text style={s.primaryText}>Open WhatsApp</Text></Pressable>
        <View style={s.waiting}><View style={[s.dot, state==='approved' && {backgroundColor:C.green}]}/><Text style={s.waitText}>{state==='approved'?'Approved — securing this device…':'Waiting for your WhatsApp confirmation…'}</Text></View>
      </View>}

      {state==='linked' && <View style={s.success}><Ionicons name="checkmark-circle" size={27} color={C.green}/><View><Text style={s.successTitle}>Same Gogo connected.</Text><Text style={s.small}>Opening your native second brain…</Text></View></View>}
      {!!error && <Text style={s.error}>{error}</Text>}
      {state==='error' && <Pressable onPress={start} style={s.secondary}><Text style={s.secondaryText}>Create a new code</Text></Pressable>}

      <View style={s.privacy}><Ionicons name="lock-closed-outline" size={17} color={C.muted}/><Text style={s.privacyText}>The app receives a revocable device session. Your WhatsApp credentials are never copied into the app.</Text></View>
    </View>
  </SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},wrap:{flex:1,padding:24,justifyContent:'center'},icon:{width:64,height:64,borderRadius:22,backgroundColor:'#E9F9EF',alignItems:'center',justifyContent:'center',marginBottom:22},kicker:{fontSize:10,fontWeight:'800',letterSpacing:1.6,color:C.orange},title:{fontFamily:'serif',fontSize:35,lineHeight:40,fontWeight:'700',color:C.ink,marginTop:9},body:{fontSize:14,lineHeight:21,color:C.muted,marginTop:13,marginBottom:24},primary:{minHeight:52,borderRadius:18,backgroundColor:C.ink,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9,paddingHorizontal:16},primaryText:{color:'white',fontSize:14,fontWeight:'800'},card:{backgroundColor:C.paper,borderWidth:1,borderColor:C.line,borderRadius:26,padding:20,gap:12},cardLabel:{fontSize:9,fontWeight:'800',letterSpacing:1.4,color:C.orange},code:{fontSize:37,fontWeight:'800',letterSpacing:4,color:C.ink,textAlign:'center',marginTop:4},command:{fontSize:13,fontWeight:'700',color:C.muted,textAlign:'center'},small:{fontSize:11,lineHeight:16,color:C.muted},waiting:{flexDirection:'row',alignItems:'center',gap:8,justifyContent:'center',paddingTop:4},dot:{width:8,height:8,borderRadius:4,backgroundColor:C.orange},waitText:{fontSize:11,color:C.muted,fontWeight:'600'},success:{backgroundColor:'#ECF9F1',borderRadius:20,padding:16,flexDirection:'row',gap:11,alignItems:'center'},successTitle:{fontSize:14,fontWeight:'800',color:C.ink},error:{marginTop:14,color:'#B8493C',fontSize:12,lineHeight:17},secondary:{minHeight:46,borderRadius:16,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center',marginTop:12},secondaryText:{fontSize:13,fontWeight:'700',color:C.ink},privacy:{flexDirection:'row',gap:9,marginTop:22,paddingHorizontal:4},privacyText:{flex:1,fontSize:10.5,lineHeight:16,color:C.muted}
})
