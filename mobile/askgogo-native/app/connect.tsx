import { useState } from 'react'
import { Platform, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native'
import { useRouter } from 'expo-router'
import { Ionicons } from '@expo/vector-icons'
import * as Haptics from 'expo-haptics'
import { exchangeWhatsAppLink, startWhatsAppOtp, verifyWhatsAppOtp, type WhatsAppOtpLink } from '../src/auth/link'
import { registerForGogoNotifications } from '../src/native/notifications'

const C = { bg:'#F6F0E8', paper:'#FFFDF9', ink:'#3A2418', muted:'#8C7769', line:'rgba(58,36,24,.11)', orange:'#F47B20', green:'#2E9B67' }

export default function ConnectAskGogo() {
  const router = useRouter()
  const [phone, setPhone] = useState('')
  const [code, setCode] = useState('')
  const [link, setLink] = useState<WhatsAppOtpLink | null>(null)
  const [state, setState] = useState<'phone'|'sending'|'code'|'verifying'|'linked'|'error'>('phone')
  const [error, setError] = useState('')

  async function sendCode() {
    const value = phone.trim()
    if (value.replace(/\D/g,'').length < 10) { setError('Enter the WhatsApp number you use with AskGogo.'); return }
    setError(''); setState('sending')
    try {
      const next = await startWhatsAppOtp({ whatsappNumber:value, deviceName:`${Platform.OS} AskGogo` })
      setLink(next); setState('code')
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
    } catch (e:any) {
      setState('error'); setError(e?.message === 'too_many_codes' ? 'Too many codes requested. Try again later.' : 'Could not send a code right now. Try again.')
    }
  }

  async function verify() {
    if (!link) return
    const clean = code.replace(/\D/g,'')
    if (clean.length !== 6) { setError('Enter the 6-digit code Gogo sent on WhatsApp.'); return }
    setError(''); setState('verifying')
    try {
      await verifyWhatsAppOtp({ pollToken:link.pollToken, code:clean })
      const session = await exchangeWhatsAppLink({ pollToken:link.pollToken, deviceName:`${Platform.OS} AskGogo` })
      if (!session.accessToken) throw new Error('session_failed')
      // The mobile bearer session is now stored. Register this installation for
      // Background Gogo notifications immediately; notification failure must not
      // undo a successful WhatsApp identity link.
      registerForGogoNotifications().catch((err:any)=>console.log('GOGO_NOTIFICATION_LINK_REGISTRATION_SKIPPED',String(err?.message||err)))
      setState('linked')
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      setTimeout(()=>router.replace('/agent'),700)
    } catch (e:any) {
      setState('code')
      setError(e?.message === 'invalid_or_expired_code' ? 'That code is wrong or expired. Check WhatsApp and try again.' : 'Could not verify this device. Try again.')
    }
  }

  function restart() {
    setLink(null); setCode(''); setError(''); setState('phone')
  }

  return <SafeAreaView style={s.safe}><View style={s.wrap}>
    <View style={s.icon}><Ionicons name="logo-whatsapp" size={34} color={C.green}/></View>
    <Text style={s.kicker}>ONE GOGO · SAME ACCOUNT</Text>
    <Text style={s.title}>Connect the app to your AskGogo WhatsApp.</Text>
    <Text style={s.body}>Use the same WhatsApp number you already use with Gogo. We’ll send a one-time code there, then this device gets its own revocable session.</Text>

    {(state==='phone'||state==='sending'||state==='error') && !link && <View style={s.card}>
      <Text style={s.label}>YOUR ASKGOGO WHATSAPP NUMBER</Text>
      <TextInput value={phone} onChangeText={setPhone} placeholder="+91 98xxxxxx" keyboardType="phone-pad" autoComplete="tel" style={s.input}/>
      <Pressable onPress={sendCode} disabled={state==='sending'} style={s.primary}><Ionicons name="logo-whatsapp" size={18} color="white"/><Text style={s.primaryText}>{state==='sending'?'Sending securely…':'Send code on WhatsApp'}</Text></Pressable>
      <Text style={s.small}>For privacy, the server gives the same response even if a number is not linked to AskGogo.</Text>
    </View>}

    {link && state!=='linked' && <View style={s.card}>
      <Text style={s.label}>CHECK WHATSAPP</Text>
      <Text style={s.cardTitle}>Gogo sent a 6-digit code.</Text>
      <Text style={s.small}>{link.message} It expires in 10 minutes.</Text>
      <TextInput value={code} onChangeText={setCode} placeholder="000000" keyboardType="number-pad" maxLength={6} style={[s.input,s.codeInput]}/>
      <Pressable onPress={verify} disabled={state==='verifying'} style={s.primary}><Text style={s.primaryText}>{state==='verifying'?'Linking this device…':'Verify & connect'}</Text></Pressable>
      <Pressable onPress={restart} style={s.textButton}><Text style={s.textButtonText}>Use another WhatsApp number</Text></Pressable>
    </View>}

    {state==='linked' && <View style={s.success}><Ionicons name="checkmark-circle" size={30} color={C.green}/><View style={{flex:1}}><Text style={s.successTitle}>Same Gogo connected.</Text><Text style={s.small}>Opening your live Agent Hub…</Text></View></View>}
    {!!error && <Text style={s.error}>{error}</Text>}

    <View style={s.privacy}><Ionicons name="lock-closed-outline" size={17} color={C.muted}/><Text style={s.privacyText}>Your WhatsApp password or credentials never enter the app. AskGogo only verifies possession of your existing WhatsApp identity and stores an opaque device token in secure storage.</Text></View>
  </View></SafeAreaView>
}

const s=StyleSheet.create({
  safe:{flex:1,backgroundColor:C.bg},wrap:{flex:1,padding:24,justifyContent:'center'},icon:{width:64,height:64,borderRadius:22,backgroundColor:'#E9F9EF',alignItems:'center',justifyContent:'center',marginBottom:22},kicker:{fontSize:10,fontWeight:'800',letterSpacing:1.6,color:C.orange},title:{fontFamily:'serif',fontSize:34,lineHeight:39,fontWeight:'700',color:C.ink,marginTop:9},body:{fontSize:14,lineHeight:21,color:C.muted,marginTop:13,marginBottom:24},card:{backgroundColor:C.paper,borderWidth:1,borderColor:C.line,borderRadius:26,padding:20,gap:12},label:{fontSize:9,fontWeight:'800',letterSpacing:1.4,color:C.orange},cardTitle:{fontFamily:'serif',fontSize:20,fontWeight:'700',color:C.ink},input:{height:52,borderWidth:1,borderColor:C.line,backgroundColor:'#FFFCF8',borderRadius:16,paddingHorizontal:15,fontSize:16,color:C.ink},codeInput:{fontSize:28,fontWeight:'800',letterSpacing:8,textAlign:'center'},primary:{minHeight:52,borderRadius:18,backgroundColor:C.ink,alignItems:'center',justifyContent:'center',flexDirection:'row',gap:9,paddingHorizontal:16},primaryText:{color:'white',fontSize:14,fontWeight:'800'},small:{fontSize:11,lineHeight:16,color:C.muted},textButton:{paddingVertical:5,alignItems:'center'},textButtonText:{fontSize:11,fontWeight:'700',color:C.orange},success:{backgroundColor:'#ECF9F1',borderRadius:20,padding:16,flexDirection:'row',gap:11,alignItems:'center'},successTitle:{fontSize:14,fontWeight:'800',color:C.ink},error:{marginTop:14,color:'#B8493C',fontSize:12,lineHeight:17},privacy:{flexDirection:'row',gap:9,marginTop:22,paddingHorizontal:4},privacyText:{flex:1,fontSize:10.5,lineHeight:16,color:C.muted}
})
